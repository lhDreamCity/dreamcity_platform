/**
 * 后台占位账号
 *
 * 讲师后台是「隐藏 URL + 账号密码」双闸（方案 §7.3 三端隔离的后台侧）。
 * 这里保证数据库里**至少有一个能进后台的账号**，不依赖任何外部服务 ——
 * 短信还没接上的时候，后台照样能用。
 *
 * 真实讲师账号用 `npm run create:teacher` 建，走 email + 密码；
 * 这个占位账号走「账号名 + 密码」，登录时两者都能当账号用。
 *
 * 幂等：每次启动都对齐一次，所以改 env 里的口令立刻生效，不用重跑脚本。
 * ADMIN_ENABLED=false 时把这个账号**删掉** —— 留着就是留了一扇没锁的门。
 */

import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/driver.js';
import { hashPassword } from './auth.js';
import { env } from '../env.js';

/** 固定 id：只有这个脚本会写它，删掉也不会误伤别人的账号 */
export const ADMIN_STAFF_ID = 'stf_admin';

/**
 * 让数据库里的占位账号与 env 对齐。
 *
 * 口令每次启动都重新对齐到 env 的值 —— 这样「改了 env 就生效」，
 * 不用任何额外的迁移步骤；代价是占位账号的口令不能只存数据库单独改。
 */
export async function ensureAdminAccount(): Promise<void> {
  const db = getDb();

  if (!env.admin.enabled) {
    await db.delete(schema.staffUser).where(eq(schema.staffUser.id, ADMIN_STAFF_ID));
    return;
  }

  const passwordHash = hashPassword(env.admin.password);
  const email = `${env.admin.user}@dreamcity.internal`;

  const rows = await db
    .select()
    .from(schema.staffUser)
    .where(eq(schema.staffUser.id, ADMIN_STAFF_ID))
    .limit(1);

  if (rows.length === 0) {
    await db.insert(schema.staffUser).values({
      id: ADMIN_STAFF_ID,
      email,
      name: env.admin.user,
      role: 'ADMIN',
      passwordHash,
    });
    return;
  }

  await db
    .update(schema.staffUser)
    .set({ email, name: env.admin.user, role: 'ADMIN', passwordHash })
    .where(eq(schema.staffUser.id, ADMIN_STAFF_ID));
}
