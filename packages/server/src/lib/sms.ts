/**
 * 短信服务 —— 家长登录验证码
 *
 * 只用于「登录验证码」与「上课提醒」，不用于营销群发（设计方案 §8）。
 * 本地开发用 log 驱动：验证码直接打到服务端控制台，不发真实短信。
 *
 * ⚠ 腾讯云的三条硬规则（踩过才知道）：
 *  1. **签名类型必须与模板类型一致** —— 验证码签名只能配验证码短信模板，
 *     通用签名配通知短信模板，营销签名配推广短信模板。类型不匹配发不出去。
 *  2. **模板参数个数必须与模板变量个数一致** —— 验证码类模板通常只有一个变量
 *     （{1} 是验证码），有效期写死在文案里。所以参数个数是配置项，不是写死的。
 *  3. **返回体有两层错误** —— SDK 遇 `Response.Error` 会抛异常（顶层错误，
 *     比如密钥错、模板不存在）；但「每个号码的发送状态」在 `SendStatusSet[].Code`
 *     里，**不会抛**，必须自己看。漏看这层 = 短信根本没发出去，前端却显示「已发送」。
 */

import { env } from '../env.js';

export interface SmsSender {
  sendVerificationCode(phone: string, code: string): Promise<void>;
}

/**
 * 短信发送失败。
 *
 * 带上腾讯云的错误码与服务端返回的说明，排查时不用去猜。
 */
export class SmsSendError extends Error {
  constructor(
    message: string,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

class LogSmsSender implements SmsSender {
  async sendVerificationCode(phone: string, code: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`\n  ┌─ 短信验证码（开发模式，未真实发送）\n  │ 手机号：${phone}\n  │ 验证码：${code}\n  └─\n`);
  }
}

/**
 * 腾讯云返回的「这个号码发得怎么样」。
 * 只取我们要的字段，避免把整个 SDK 类型拖进来。
 */
export interface SendStatus {
  Code?: string;
  Message?: string;
  PhoneNumber?: string;
}

export interface SendSmsResult {
  SendStatusSet?: SendStatus[];
  RequestId?: string;
}

interface SmsClient {
  SendSms(input: {
    SmsSdkAppId: string;
    SignName: string;
    TemplateId: string;
    PhoneNumberSet: string[];
    TemplateParamSet?: string[];
  }): Promise<SendSmsResult>;
}

/**
 * 腾讯云 SDK 的导出形状是 `sms.v20210111.Client`（见 node_modules/.../services/index.d.ts），
 * 不是 `SmsClient`。这里按两种形状都取一遍，兼容 CJS/ESM 的互操作差异。
 */
function resolveClientConstructor(mod: unknown): new (config: Record<string, unknown>) => SmsClient {
  const m = mod as {
    sms?: { v20210111?: { Client?: new (c: Record<string, unknown>) => SmsClient } };
    default?: { sms?: { v20210111?: { Client?: new (c: Record<string, unknown>) => SmsClient } } };
  };
  const ctor = m.sms?.v20210111?.Client ?? m.default?.sms?.v20210111?.Client;
  if (!ctor) {
    throw new SmsSendError(
      '腾讯云短信 SDK 的导出形状不对：找不到 sms.v20210111.Client。' +
        '通常是 SDK 版本不对，请确认安装的是 tencentcloud-sdk-nodejs-sms。',
    );
  }
  return ctor;
}

class TencentSmsSender implements SmsSender {
  async sendVerificationCode(phone: string, code: string): Promise<void> {
    // SDK 用变量 specifier 动态引入：缺失时给出清晰提示，而不是让整个服务起不来
    const specifier = 'tencentcloud-sdk-nodejs-sms';
    let mod: unknown;
    try {
      mod = await import(specifier);
    } catch {
      throw new SmsSendError(
        '短信驱动为 tencent，但未安装 tencentcloud-sdk-nodejs-sms。' +
          '请安装该依赖，或把 SMS_DRIVER 改回 log。',
      );
    }

    const SmsClient = resolveClientConstructor(mod);
    const client = new SmsClient({
      credential: { secretId: env.sms.secretId, secretKey: env.sms.secretKey },
      region: env.sms.region,
      profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
    });

    let result: SendSmsResult;
    try {
      result = await client.SendSms({
        SmsSdkAppId: env.sms.appId,
        SignName: env.sms.signName,
        TemplateId: env.sms.templateCode,
        PhoneNumberSet: [`+86${phone}`],
        TemplateParamSet: buildTemplateParams(
          code,
          env.sms.templateParamCount,
          env.sms.codeTtlMinutes,
        ),
      });
    } catch (err) {
      // 顶层错误（密钥错、模板不存在、签名没审过…）SDK 会抛异常。
      // 腾讯云 SDK 的异常对象把错误码放在 `code` 上。
      const e = err as { code?: string; message?: string; requestId?: string };
      throw new SmsSendError(
        `腾讯云拒绝了这次发送：${e.message ?? '未知原因'}`,
        e.code,
      );
    }

    // 第二层错误：每个号码的发送状态。SDK 不会为它抛异常 —— 不看就等于把失败当成功。
    assertSendSucceeded(result);
  }
}

/**
 * 模板参数。
 *
 * 腾讯云要求参数个数与模板变量个数一致：
 *  · 验证码类模板通常只有 {1}（验证码），有效期写死在文案里 → 1 个参数
 *  · 通用/通知类模板可以有 {1}{2}（验证码、有效期）→ 2 个参数
 *
 * 用 `SMS_TEMPLATE_PARAM_COUNT` 选，别写死。
 */
export function buildTemplateParams(
  code: string,
  paramCount: number,
  ttlMinutes: number,
): string[] {
  if (paramCount >= 2) return [code, String(ttlMinutes)];
  return [code];
}

/**
 * 校验腾讯云返回的「这个号码发得怎么样」。
 *
 * 这一层**不会抛异常** —— SDK 只对顶层 `Response.Error` 抛。
 * 漏看它 = 短信根本没发出去，前端却显示「验证码已发送」，家长干等。
 *
 * 抽成纯函数是为了能直接测：这是整条链路上最容易静默失败的一环。
 */
export function assertSendSucceeded(result: SendSmsResult): void {
  const status = result.SendStatusSet?.[0];
  if (!status) {
    throw new SmsSendError(
      '腾讯云没有返回发送状态，无法确认是否发送成功。',
      'NO_SEND_STATUS',
    );
  }
  if (status.Code !== 'Ok') {
    throw new SmsSendError(
      `短信未送达：${status.Message ?? status.Code ?? '未知原因'}`,
      status.Code,
    );
  }
}

let sender: SmsSender | null = null;

export function getSmsSender(): SmsSender {
  if (!sender) {
    sender = env.sms.driver === 'tencent' ? new TencentSmsSender() : new LogSmsSender();
  }
  return sender;
}
