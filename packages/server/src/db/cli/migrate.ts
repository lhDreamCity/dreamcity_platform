import { runMigrations } from '../migrate.js';

const applied = await runMigrations();
if (applied.length === 0) {
  console.log('数据库已是最新，没有需要执行的迁移。');
} else {
  console.log(`已执行 ${applied.length} 个迁移：\n${applied.map((f) => `  · ${f}`).join('\n')}`);
}
process.exit(0);
