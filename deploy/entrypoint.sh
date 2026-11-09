#!/bin/sh
# 容器启动脚本：先保证库结构与内容就位，再起服务。
# 迁移与入库都是幂等的，重复跑不会出问题。
set -e

echo "▸ 等待数据库…"
i=0
until node -e "
import('pg').then(async ({default: pg}) => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.end();
  process.exit(0);
}).catch(() => process.exit(1));
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "✗ 数据库连不上，等了 60 次（约 2 分钟）" >&2
    exit 1
  fi
  sleep 2
done
echo "✓ 数据库就绪"

# seed.ts 自带迁移（幂等），跑一次就够
echo "▸ 迁移 + 灌入 48 节课内容…"
/app/node_modules/.bin/tsx /app/packages/seed/src/seed.ts --no-demo

echo "▸ 启动服务…"
cd /app
exec /app/node_modules/.bin/tsx /app/packages/server/src/server.ts
