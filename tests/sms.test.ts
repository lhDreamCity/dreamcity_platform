/**
 * 短信链路的自动化检查
 *
 * 短信这条链路的特点是「失败得很安静」：
 * 腾讯云在多数失败场景下不抛异常，而是把失败写在返回体里。
 * 不检查这层 = 短信没发出去，家长端却显示「验证码已发送」，问题会一路拖到
 * 真实家长登录不了才暴露 —— 那时候已经约好了课。
 *
 * 这里覆盖三件容易回退的事：
 *  1. 返回体里的失败状态必须被识别出来（不能当成功）
 *  2. 模板参数个数必须跟着模板类型走（腾讯云会因个数不符拒发）
 *  3. SDK 的导出形状不能写错（写错了是运行时才崩）
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertSendSucceeded,
  buildTemplateParams,
  SmsSendError,
} from '../packages/server/src/lib/sms';

const ROOT = resolve(import.meta.dirname, '..');

describe('腾讯云返回的发送状态必须被识别', () => {
  it('Code=Ok 才算发成功', () => {
    expect(() =>
      assertSendSucceeded({ SendStatusSet: [{ Code: 'Ok', Message: 'send success' }] }),
    ).not.toThrow();
  });

  it('逐条状态是失败时必须抛错 —— 这是最容易被静默吞掉的一环', () => {
    // 腾讯云对这类失败不抛异常，只在返回体里写一句。
    expect(() =>
      assertSendSucceeded({
        SendStatusSet: [
          { Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: '手机号日发送量超限' },
        ],
      }),
    ).toThrow(SmsSendError);
  });

  it('失败时要带上腾讯云的错误码，否则没法查', () => {
    try {
      assertSendSucceeded({
        SendStatusSet: [{ Code: 'FailedOperation.TemplateIncorrectOrUnapproved' }],
      });
      expect.unreachable('应该抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(SmsSendError);
      expect((err as SmsSendError).providerCode).toBe(
        'FailedOperation.TemplateIncorrectOrUnapproved',
      );
    }
  });

  it('没有返回状态时也要当成失败（不能默认成功）', () => {
    expect(() => assertSendSucceeded({})).toThrow(SmsSendError);
    expect(() => assertSendSucceeded({ SendStatusSet: [] })).toThrow(SmsSendError);
  });
});

describe('模板参数个数跟着模板类型走', () => {
  it('验证码类模板只有一个参数（{1}=验证码）', () => {
    expect(buildTemplateParams('12345', 1, 5)).toEqual(['12345']);
  });

  it('通用类模板两个参数（{1}=验证码 {2}=有效期）', () => {
    expect(buildTemplateParams('12345', 2, 5)).toEqual(['12345', '5']);
  });

  it('有效期数字跟配置走，不写死', () => {
    expect(buildTemplateParams('12345', 2, 10)).toEqual(['12345', '10']);
  });
});

describe('腾讯云 SDK 的用法', () => {
  const sms = readFileSync(
    resolve(ROOT, 'packages/server/src/lib/sms.ts'),
    'utf8',
  );

  it('导出形状是 sms.v20210111.Client —— 不是 SmsClient', () => {
    // 这个包没有名为 SmsClient 的具名导出，只有 sms.v20210111.Client。
    // 写成 mod.SmsClient 的话，第一次真实发送就崩（undefined 不是构造函数）。
    expect(sms).toContain('sms?.v20210111?.Client');
    expect(sms).not.toMatch(/mod\.SmsClient/);
    expect(sms).not.toMatch(/\{ *SmsClient *\} *= *await import/);
  });

  it('依赖已装进 server 包', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, 'packages/server/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['tencentcloud-sdk-nodejs-sms']).toBeTruthy();
  });

  it('锁文件里也有它（否则 npm ci 装不上，容器里 import 直接失败）', () => {
    const lock = readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8');
    expect(lock).toContain('tencentcloud-sdk-nodejs-sms');
  });
});

describe('短信配置的自检', () => {
  it('driver=tencent 时，缺配置要能列出来', () => {
    const envSrc = readFileSync(resolve(ROOT, 'packages/server/src/env.ts'), 'utf8');
    for (const key of [
      'SMS_APP_ID',
      'SMS_SECRET_ID',
      'SMS_SECRET_KEY',
      'SMS_SIGN_NAME',
      'SMS_TEMPLATE_CODE',
    ]) {
      expect(envSrc).toContain(key);
    }
  });

  it('容器里要显式透传 SMS_* —— 容器读不到主机的 .env', () => {
    const compose = readFileSync(resolve(ROOT, 'deploy/docker-compose.yml'), 'utf8');
    for (const key of [
      'SMS_DRIVER',
      'SMS_APP_ID',
      'SMS_SECRET_ID',
      'SMS_SECRET_KEY',
      'SMS_SIGN_NAME',
      'SMS_TEMPLATE_CODE',
    ]) {
      expect(compose).toContain(key);
    }
  });
});
