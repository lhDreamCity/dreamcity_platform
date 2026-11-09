/**
 * HTTP 服务入口
 *
 * 三端同域不同路径：/teacher · /guardian · /student
 * 活动插件与课件走 /activities 与 /files 静态托管。
 *
 * 生产由后端直接托管打包好的前端，也可以放在 Nginx 后面（两者都行）。
 */

import { buildApp } from './app.js';
import { env, assertProductionConfig } from './env.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerContentRoutes } from './modules/content/routes.js';
import { registerFileRoutes } from './modules/files/routes.js';
import { registerGuardianRoutes } from './modules/guardian/routes.js';
import { registerOpsRoutes } from './modules/ops/routes.js';
import { registerSessionRoutes } from './modules/session/routes.js';
import { registerStudentRoutes } from './modules/student/routes.js';

// 上云前的配置自检：缺关键配置就别起来
assertProductionConfig();

const app = await buildApp();

await registerAuthRoutes(app);
await registerContentRoutes(app);
await registerSessionRoutes(app);
await registerGuardianRoutes(app);
await registerStudentRoutes(app);
await registerOpsRoutes(app);
await registerFileRoutes(app);

app.get('/api/health', async () => ({
  ok: true,
  driver: env.db.driver,
  time: new Date().toISOString(),
}));

await app.listen({ port: env.serverPort, host: '0.0.0.0' });
app.log.info(`梦之城综合教学平台已启动 → http://localhost:${env.serverPort}`);

/**
 * 优雅关闭：云主机重启、扩缩容、滚动发布时，
 * 要先把正在跑的请求处理完，再断开数据库与缓存连接，
 * 否则会看到偶发的「连接被重置」。
 */
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`收到 ${signal}，正在优雅关闭…`);
    app
      .close()
      .then(() => {
        app.log.info('已关闭');
        process.exit(0);
      })
      .catch((err) => {
        app.log.error(err);
        process.exit(1);
      });
  });
}
