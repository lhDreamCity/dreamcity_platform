-- ══════════════════════════════════════════════════════════════════════
-- 梦之城综合教学平台 · 初始迁移
-- 三层分离（设计方案 §4.2）：
--   模板层  level → unit → lesson → lesson_plan_version
--   实例层  lesson + plan_version → class_session → session_activity → session_record
--   价值层  guardian → student → enrollment → artifact / assessment / observation
--
-- ⚠️ 本文件与 packages/server/src/db/schema.ts 必须保持一致。
--    一致性由 tools/check-constraints 的「schema ↔ SQL 列名一致性」检查保证。
-- ══════════════════════════════════════════════════════════════════════

-- ── 模板层 ─────────────────────────────────────────────────────────

CREATE TABLE level (
  id          text PRIMARY KEY,
  code        text NOT NULL,
  name        text NOT NULL,
  grade_range text NOT NULL,
  theme       text NOT NULL,
  seq         integer NOT NULL,
  goals       jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE unit (
  id       text PRIMARY KEY,
  level_id text NOT NULL REFERENCES level(id),
  seq      integer NOT NULL,
  name     text NOT NULL
);
CREATE UNIQUE INDEX unit_level_seq_uq ON unit(level_id, seq);

CREATE TABLE lesson (
  id                 text PRIMARY KEY,
  unit_id            text NOT NULL REFERENCES unit(id),
  level_id           text NOT NULL REFERENCES level(id),
  seq                integer NOT NULL,
  title              text NOT NULL,
  output             text NOT NULL DEFAULT '',
  default_recipe     text,
  current_version_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lesson_level_seq_uq ON lesson(level_id, seq);

CREATE TABLE lesson_plan_version (
  id          text PRIMARY KEY,
  lesson_id   text NOT NULL REFERENCES lesson(id),
  version     integer NOT NULL,
  content_json jsonb NOT NULL,
  note        text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lesson_plan_version_uq ON lesson_plan_version(lesson_id, version);
ALTER TABLE lesson
  ADD CONSTRAINT lesson_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES lesson_plan_version(id);

CREATE TABLE activity_plugin (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  version       text NOT NULL,
  entry         text NOT NULL,
  manifest_json jsonb NOT NULL,
  result_schema jsonb NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── 实例层 ─────────────────────────────────────────────────────────

CREATE TABLE staff_user (
  id            text PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_user_email_uq ON staff_user(email);

CREATE TABLE term (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  level_id   text NOT NULL REFERENCES level(id),
  start_date date,
  end_date   date,
  status     text NOT NULL DEFAULT 'PLANNED'
);

-- 家长账号：手机号是家长端的唯一登录主体。
-- 先于 student 建表，因为 student.guardian_id 引用它。
CREATE TABLE guardian (
  id              text PRIMARY KEY,
  phone           text NOT NULL,
  name            text NOT NULL,
  sms_verified_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX guardian_phone_uq ON guardian(phone);

-- 一次真实上课 —— 数据模型的主键。
-- plan_version_id 指向「当时的」教案快照：改细案不影响往期记录（C5）。
CREATE TABLE class_session (
  id                text PRIMARY KEY,
  lesson_id         text NOT NULL REFERENCES lesson(id),
  plan_version_id   text NOT NULL REFERENCES lesson_plan_version(id),
  term_id           text REFERENCES term(id),
  class_code        text,
  teacher_id        text NOT NULL REFERENCES staff_user(id),
  room_name         text,
  class_type        text NOT NULL DEFAULT 'SMALL_GROUP',
  participant_count integer NOT NULL,
  state             text NOT NULL DEFAULT 'DRAFT',
  started_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- 班型下限 ≥2 人：不设计 1 对 1，也不为该边界状态做适配（开发上下文 §4.4）
  CONSTRAINT class_session_participant_count_check CHECK (participant_count >= 2)
);
CREATE INDEX class_session_lesson_idx ON class_session(lesson_id);
CREATE INDEX class_session_state_idx ON class_session(state);
CREATE INDEX class_session_code_idx ON class_session(class_code);

CREATE TABLE student (
  id           text PRIMARY KEY,
  guardian_id  text NOT NULL REFERENCES guardian(id),
  display_name text NOT NULL,
  avatar_key   text NOT NULL,
  avatar_stage integer NOT NULL DEFAULT 1,
  grade        integer NOT NULL,
  level_id     text REFERENCES level(id),
  badge        jsonb NOT NULL DEFAULT '[]'::jsonb,
  state        text NOT NULL DEFAULT 'ACTIVE',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_guardian_idx ON student(guardian_id);

CREATE TABLE class_session_participant (
  id         text PRIMARY KEY,
  session_id text NOT NULL REFERENCES class_session(id) ON DELETE CASCADE,
  student_id text NOT NULL REFERENCES student(id),
  joined_at  timestamptz,
  left_at    timestamptz
);
CREATE UNIQUE INDEX class_session_participant_uq ON class_session_participant(session_id, student_id);

-- 课堂编排的最小颗粒。
-- 设计方案里的表名叫 `activity`，与 `activity_plugin` 语义冲突，这里改名 session_activity。
CREATE TABLE session_activity (
  id             text PRIMARY KEY,
  session_id     text NOT NULL REFERENCES class_session(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  phase          text NOT NULL,
  mode_card      text,
  atom           text,
  title          text NOT NULL,
  duration_min   integer NOT NULL,
  plugin_id      text REFERENCES activity_plugin(id),
  resource_id    text,
  activity_kind  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_activity_session_idx ON session_activity(session_id, seq);

CREATE TABLE session_record (
  id                  text PRIMARY KEY,
  session_id          text NOT NULL REFERENCES class_session(id) ON DELETE CASCADE,
  session_activity_id text REFERENCES session_activity(id),
  record_type         text NOT NULL,
  student_id          text,
  actual_min          numeric(6,2),
  event_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_record_session_idx ON session_record(session_id, occurred_at);

-- 课堂模式手册 8.1 的六指标落库
CREATE TABLE observation (
  id               text PRIMARY KEY,
  session_id       text NOT NULL REFERENCES class_session(id) ON DELETE CASCADE,
  student_id       text NOT NULL,
  speak_count      integer NOT NULL DEFAULT 0,
  patrol_count     integer NOT NULL DEFAULT 0,
  stuck_count      integer NOT NULL DEFAULT 0,
  task_completion  numeric(4,3),
  captured_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX observation_session_student_uq ON observation(session_id, student_id);

-- ── 价值层 ─────────────────────────────────────────────────────────

CREATE TABLE enrollment (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES student(id),
  term_id       text REFERENCES term(id),
  package_type  text,
  total_lessons integer,
  used_lessons  integer NOT NULL DEFAULT 0,
  -- 报价按 ≥2 人小班重定 —— 未定稿前为 NULL，不沿用旧价也不自行推算（C13）
  price         numeric(10,2),
  status        text NOT NULL DEFAULT 'ACTIVE',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollment_student_idx ON enrollment(student_id);

CREATE TABLE artifact (
  id            text PRIMARY KEY,
  session_id    text REFERENCES class_session(id),
  student_id    text NOT NULL REFERENCES student(id),
  lesson_id     text REFERENCES lesson(id),
  artifact_type text NOT NULL,
  title         text NOT NULL,
  content_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_key   text,
  visibility    text NOT NULL DEFAULT 'VIS_L0',
  wall_approved boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifact_student_idx ON artifact(student_id, created_at);
CREATE INDEX artifact_session_idx ON artifact(session_id);

-- 「谁看过」—— 一行一次访问，只记人与关系。
-- ⚠️ 刻意没有 view_count 列：孩子能看到「谁看过」但不显示任何数字（C8）。
CREATE TABLE artifact_view (
  id                text PRIMARY KEY,
  artifact_id       text NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
  viewer_student_id text,
  viewer_guardian_id text,
  relation          text NOT NULL,
  viewed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifact_view_artifact_idx ON artifact_view(artifact_id, viewed_at);

CREATE TABLE showcase (
  id            text PRIMARY KEY,
  student_id    text NOT NULL REFERENCES student(id),
  session_id    text REFERENCES class_session(id),
  artifact_id   text REFERENCES artifact(id),
  title         text NOT NULL,
  visibility    text NOT NULL DEFAULT 'VIS_L0',
  wall_approved boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX showcase_student_idx ON showcase(student_id, created_at);

-- 跨期正向留言 —— 只准三类句式
CREATE TABLE peer_note (
  id              text PRIMARY KEY,
  showcase_id     text NOT NULL REFERENCES showcase(id) ON DELETE CASCADE,
  from_student_id text NOT NULL REFERENCES student(id),
  note_type       text NOT NULL,
  content         text NOT NULL,
  review_state    text NOT NULL DEFAULT 'PENDING',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX peer_note_showcase_idx ON peer_note(showcase_id, created_at);

-- 授权留痕 —— 逐件可撤回（C10）
CREATE TABLE visibility_grant (
  id          text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES guardian(id),
  student_id  text NOT NULL REFERENCES student(id),
  scope       text NOT NULL,
  artifact_id text REFERENCES artifact(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX visibility_grant_student_idx ON visibility_grant(student_id, scope);

-- 知情同意 —— 可撤回（C11）
CREATE TABLE consent (
  id          text PRIMARY KEY,
  guardian_id text NOT NULL REFERENCES guardian(id),
  student_id  text REFERENCES student(id),
  scope       text NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE INDEX consent_guardian_idx ON consent(guardian_id);

-- 每 4 节课的家长反馈 + 结课摘要
CREATE TABLE student_feedback (
  id              text PRIMARY KEY,
  session_id      text NOT NULL REFERENCES class_session(id) ON DELETE CASCADE,
  student_id      text NOT NULL REFERENCES student(id),
  content         text NOT NULL,
  teacher_comment text,
  next_step       text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_feedback_student_idx ON student_feedback(student_id, created_at);
