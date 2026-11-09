# syntax=docker/dockerfile:1
# 梦之城综合教学平台 · 生产镜像
#
# 与主机上其它服务一致：一个镜像、一个容器、一次部署。
# 前端在构建阶段打包，由后端直接托管（少一层 Nginx location）。
#
# 用 node:24-bookworm（完整版）而不是 -slim：
#   slim 镜像里没有系统 CA 证书，apt 走 HTTPS 会验签失败
#   （想装 ca-certificates，恰恰得先有 ca-certificates 才能装）。
#   完整版自带 ca-certificates，这个坑就不用踩了。
#   镜像大一点，换来构建可复现、无需 apt、也无需关掉任何 TLS 校验。

# ── 构建阶段：装依赖 + 打包前端 ──────────────────────────
FROM node:24-bookworm AS build
WORKDIR /app
ENV NODE_ENV=development

# 先只拷 package.json，让依赖层可以被缓存
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/seed/package.json packages/seed/
RUN npm ci

COPY . .

# 打包前端 → packages/web/dist
RUN npm run build

# 裁掉开发依赖（tsx 是生产依赖，服务端直接跑 TypeScript）
RUN npm prune --omit=dev

# ── 运行阶段 ─────────────────────────────────────────────
FROM node:24-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SERVER_PORT=8787 \
    PGLITE_DATA_DIR=/app/var/pgdata

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/activities ./activities
COPY --from=build /app/content ./content
COPY --from=build /app/tools ./tools

COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/var/objects

EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
