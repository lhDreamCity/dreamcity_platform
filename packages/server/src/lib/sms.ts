/**
 * 短信服务 —— 家长登录验证码
 *
 * 只用于「登录验证码」与「上课提醒」，不用于营销群发（设计方案 §8）。
 * 本地开发用 log 驱动：验证码直接打到服务端控制台，不发真实短信。
 */

import { env } from '../env.js';

export interface SmsSender {
  sendVerificationCode(phone: string, code: string): Promise<void>;
}

class LogSmsSender implements SmsSender {
  async sendVerificationCode(phone: string, code: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`\n  ┌─ 短信验证码（开发模式，未真实发送）\n  │ 手机号：${phone}\n  │ 验证码：${code}\n  └─\n`);
  }
}

class TencentSmsSender implements SmsSender {
  async sendVerificationCode(phone: string, code: string): Promise<void> {
    // SDK 是可选依赖：用变量 specifier 动态引入，缺失时给出清晰提示而不是编译失败
    const specifier = 'tencentcloud-sdk-nodejs-sms';
    let SmsClient: new (config: Record<string, unknown>) => {
      SendSms(input: Record<string, unknown>): Promise<unknown>;
    };
    try {
      const mod = (await import(specifier)) as {
        SmsClient: new (config: Record<string, unknown>) => {
          SendSms(input: Record<string, unknown>): Promise<unknown>;
        };
      };
      SmsClient = mod.SmsClient;
    } catch {
      throw new Error(
        '短信驱动为 tencent，但未安装 tencentcloud-sdk-nodejs-sms。请安装该依赖，或把 SMS_DRIVER 改回 log。',
      );
    }
    const client = new SmsClient({
      credential: { secretId: env.sms.secretId, secretKey: process.env.SMS_SECRET_KEY ?? '' },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
    });
    await client.SendSms({
      SmsSdkAppId: env.sms.appId,
      SignName: env.sms.signName,
      TemplateId: env.sms.templateCode,
      PhoneNumberSet: [`+86${phone}`],
      TemplateParamSet: [code, '5'],
    });
  }
}

let sender: SmsSender | null = null;

export function getSmsSender(): SmsSender {
  if (!sender) {
    sender = env.sms.driver === 'tencent' ? new TencentSmsSender() : new LogSmsSender();
  }
  return sender;
}
