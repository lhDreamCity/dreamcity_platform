/**
 * @dreamcity/server 对外出口
 *
 * 说明：主入口是 src/server.ts（启动 HTTP 服务）。
 * 这里只导出可复用的构建块，供 seed 包与测试使用。
 */

export { buildApp } from './app.js';
export {
  env,
  CLASS_CODE_TTL_SECONDS,
  STUDENT_TOKEN_TTL_MINUTES,
  ADMIN_USING_DEFAULT_PASSWORD,
} from './env.js';
export { getDb, schema, getMigrationClient } from './db/driver.js';
export { runMigrations, splitStatements, createRunner } from './db/migrate.js';
export { ensureAdminAccount, ADMIN_STAFF_ID } from './lib/admin-account.js';
export * from './lib/auth.js';
export * from './lib/cache.js';
export * from './lib/storage.js';
export * from './lib/sms.js';
export * from './modules/visibility/service.js';
export { registerContentRoutes } from './modules/content/routes.js';
export { registerSessionRoutes } from './modules/session/routes.js';
export { registerAuthRoutes } from './modules/auth/routes.js';
export { registerGuardianRoutes } from './modules/guardian/routes.js';
export { registerStudentRoutes } from './modules/student/routes.js';
export { registerOpsRoutes } from './modules/ops/routes.js';
export { registerFileRoutes } from './modules/files/routes.js';
