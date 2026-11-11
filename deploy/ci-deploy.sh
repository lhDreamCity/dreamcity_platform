#!/bin/bash
# 梦之城平台 · CI 部署脚本（放在服务器上，由 GitHub Actions 通过 SSH 触发）
#
# 为什么是「Actions 推到服务器」而不是「服务器去 GitHub 拉」：
#   193.112.18.222 连 github.com 超时（实测 20s status=000），
#   但连 gitee.com 1.6s 就通。服务器根本拉不动 GitHub，
#   所以代码从 GitHub 流向服务器只能反过来 —— 由 Actions 送过去。
#
# 触发方式：SSH 的 authorized_keys 里给这把受限密钥挂 forced command，
#   command="/home/ubuntu/ci-deploy.sh",no-port-forwarding,no-agent-forwarding,no-pty
# 于是这把密钥只能干「接收代码包并部署」这一件事，跑不了别的命令。
#
# stdin = git archive 生成的 tar.gz（只含仓库里跟踪的文件，.env 不在其中）

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/dreamcity-platform}"
HEALTH_URL="${HEALTH_URL:-https://platform.lhdreamcity.com/api/health}"
STAGE="$(mktemp /tmp/dreamcity-deploy-XXXXXX.tar.gz)"

echo "▸ 接收代码包…"
cat > "$STAGE"

if ! tar -tzf "$STAGE" >/dev/null 2>&1; then
  echo "✗ 收到的不是合法的 tar 包，部署中止" >&2
  rm -f "$STAGE"
  exit 1
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo "✗ $APP_DIR/.env 不存在 —— 部署中止（.env 不在仓库里，需先在服务器上备好）" >&2
  rm -f "$STAGE"
  exit 1
fi

echo "▸ 解压到暂存目录…"
STAGE_DIR="$(mktemp -d /tmp/dreamcity-stage-XXXXXX)"
tar -xzf "$STAGE" -C "$STAGE_DIR"

# 有 rsync 就用 rsync 覆盖，顺手删掉仓库里已经删掉的文件；
# .env / var / node_modules 受保护，不会被动。没有 rsync 就退回覆盖式解压。
if command -v rsync >/dev/null 2>&1; then
  echo "▸ 同步到 $APP_DIR …"
  rsync -a --delete \
    --exclude='.env' --exclude='var/' --exclude='node_modules/' --exclude='.git/' \
    "$STAGE_DIR"/ "$APP_DIR"/
else
  echo "▸ 覆盖式解压到 $APP_DIR …"
  tar -xzf "$STAGE" -C "$APP_DIR"
fi
rm -f "$STAGE"
rm -rf "$STAGE_DIR"

echo "▸ 重建并启动…"
cd "$APP_DIR"
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build

echo "▸ 等健康检查…"
for i in $(seq 1 60); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "✓ 部署完成：$HEALTH_URL"
    exit 0
  fi
  sleep 5
done

echo "✗ 部署后 5 分钟内健康检查没通过" >&2
docker ps -a --filter name=dreamcity-platform >&2 || true
docker logs --tail 60 dreamcity-platform >&2 || true
exit 1
