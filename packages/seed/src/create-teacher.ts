/**
 * 创建讲师账号 —— 生产用
 *
 * 生产不跑演示数据（那里面是公开的演示密码），
 * 用这个脚本建真实账号。密码随机生成，只打印一次。
 *
 *   npx tsx packages/seed/src/create-teacher.ts --email you@company.cn --name 你的名字
 *   npx tsx packages/seed/src/create-teacher.ts --email you@company.cn --name 你的名字 --password '自己定'
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@dreamcity/server';
import { hashPassword } from '@dreamcity/server';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.trim().toLowerCase();
  const name = arg('name')?.trim();
  const role = (arg('role') ?? 'TEACHER').toUpperCase();

  if (!email || !email.includes('@')) {
    console.error('用法：--email you@company.cn --name 你的名字 [--role TEACHER|OPS|ADMIN] [--password …]');
    process.exit(1);
  }
  if (!['TEACHER', 'OPS', 'ADMIN'].includes(role)) {
    console.error(`role 只能是 TEACHER / OPS / ADMIN，收到的是 ${role}`);
    process.exit(1);
  }

  const password = arg('password') ?? randomBytes(9).toString('base64url');
  const db = getDb();

  const existing = await db
    .select()
    .from(schema.staffUser)
    .where(eq(schema.staffUser.email, email))
    .limit(1);

  if (existing.length > 0) {
    // 已存在就改密码
    await db
      .update(schema.staffUser)
      .set({ passwordHash: hashPassword(password), name: name ?? existing[0]!.name, role })
      .where(eq(schema.staffUser.email, email));
    console.log(`✓ 已重置 ${email} 的密码`);
  } else {
    await db.insert(schema.staffUser).values({
      id: `stf_${randomBytes(8).toString('hex')}`,
      email,
      name: name ?? email,
      role,
      passwordHash: hashPassword(password),
    });
    console.log(`✓ 已创建 ${email}`);
  }

  console.log('');
  console.log('  登录信息（只显示这一次，请立刻保存）：');
  console.log(`    邮箱：${email}`);
  console.log(`    密码：${password}`);
  console.log(`    角色：${role}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
