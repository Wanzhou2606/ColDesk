/**
 * SQLite 表结构（设计文档 3.2 的落地版本）。
 * 所有表都带 deleted_at / updated_at，为 v0.4 的局域网同步预留。
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS home_entry (
  date TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS home_asset (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES home_entry(date) ON DELETE CASCADE,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_home_asset_date ON home_asset(date);
CREATE TABLE IF NOT EXISTS semester (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  total_weeks INTEGER NOT NULL DEFAULT 20,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS course (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semester(id),
  name TEXT NOT NULL,
  teacher TEXT,
  color TEXT NOT NULL DEFAULT '#4F7CFF',
  credit REAL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS course_session (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_slot INTEGER NOT NULL,
  end_slot INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  room TEXT,
  week_mode TEXT NOT NULL DEFAULT 'all',
  week_list TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS course_session_override (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES course_session(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  new_date TEXT,
  new_start_slot INTEGER,
  new_end_slot INTEGER,
  new_room TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS time_slot (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semester(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  period TEXT NOT NULL DEFAULT 'am',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  campus TEXT NOT NULL DEFAULT '本部',
  is_prepare_bell INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL DEFAULT 'study',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_raw TEXT,
  course_id TEXT REFERENCES course(id) ON DELETE SET NULL,
  exam_id TEXT,
  parent_id TEXT,
  urgency INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  progress INTEGER NOT NULL DEFAULT 0,
  start_at TEXT,
  due_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  est_minutes INTEGER,
  splittable INTEGER NOT NULL DEFAULT 1,
  earliest_start TEXT,
  fixed_at TEXT,
  remind_policy TEXT NOT NULL DEFAULT 'default',
  remind_offsets TEXT,
  auto_scheduled INTEGER NOT NULL DEFAULT 1,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_due ON task(domain, status, due_at);
CREATE INDEX IF NOT EXISTS idx_task_urgency ON task(status, urgency);

CREATE TABLE IF NOT EXISTS schedule_block (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  planned_minutes INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'auto',
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_block_time ON schedule_block(date, start_at);

CREATE TABLE IF NOT EXISTS exam (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES course(id) ON DELETE SET NULL,
  semester_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  exam_at TEXT NOT NULL,
  duration_minutes INTEGER,
  location TEXT,
  seat TEXT,
  format TEXT,
  difficulty INTEGER NOT NULL DEFAULT 3,
  confidence INTEGER NOT NULL DEFAULT 3,
  credit_weight REAL,
  review_progress INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS busy_block (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  weekday INTEGER,
  date TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'life',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS reminder (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  exam_id TEXT,
  fire_at TEXT NOT NULL,
  level TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  snooze_until TEXT,
  title TEXT,
  body TEXT,
  urgency INTEGER,
  strong INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminder_fire ON reminder(state, fire_at);

CREATE TABLE IF NOT EXISTS notify_log (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  exam_id TEXT,
  reminder_id TEXT,
  kind TEXT NOT NULL,
  dedupe_key TEXT,
  fired_at TEXT NOT NULL,
  action TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_dedupe ON notify_log(dedupe_key);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 预留：笔记模块（v0.5 才实现）
CREATE TABLE IF NOT EXISTS note (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL DEFAULT '',
  course_id TEXT REFERENCES course(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'local',
  source_ref TEXT,
  external_id TEXT,
  external_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- 预留：局域网同步（v0.4）
CREATE TABLE IF NOT EXISTS sync_oplog (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL,
  payload TEXT,
  rev INTEGER NOT NULL DEFAULT 1,
  lamport INTEGER NOT NULL DEFAULT 0,
  device_id TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_peer (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  last_seen_at TEXT,
  last_pull_seq INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0
);

-- 记账：分类（含每日目标额度）
--
-- 这里**没有** deleted_at：分类是低频、少量（十来个）的数据，
-- 用户要删就直接删；而历史流水的 category_id 用 ON DELETE RESTRICT 挡住，
-- 于是"删掉分类导致历史账目失去归属"这种情况在数据库层面就不可能发生。
--
-- daily_target 是**每日**目标，周/月预算是它在区间上的折算（见 shared/expense.ts）。
-- 存 0 表示这一类不设目标，只统计不比较。
CREATE TABLE IF NOT EXISTS expense_category (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#4F7CFF',
  daily_target REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 记账：流水（只记支出）
--
-- amount 恒为正数：这个模块只记支出，方向由语义决定，不需要正负号，
-- 于是所有求和都是简单的加法，不会出现"忘了取绝对值"这类错。
-- occurred_on 用 YYYY-MM-DD（本地日期，不存时间）：
-- 记账按天看就够了，存时间会引入时区问题却没有实际收益。
CREATE TABLE IF NOT EXISTS expense_entry (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES expense_category(id) ON DELETE RESTRICT,
  amount REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  occurred_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_date ON expense_entry(occurred_on);
CREATE INDEX IF NOT EXISTS idx_expense_category ON expense_entry(category_id, occurred_on);

-- 记账：每月期初余额
--
-- 用户每月初自己填一次（例如"这个月生活费 2000"），于是"月预算"就是他真正可动用的钱，
-- 比"每日总预算 × 当月天数"更贴近实际。按 YYYY-MM 存，一月一行。
--
-- 与 expense_daily_budget 的关系：**期初余额优先**。
-- 某个月填了就用它当月预算；没填则退回"每日总预算 × 当月天数"，
-- 这样既能按月精确控制，也不会因为忘了填就完全没有预算。
CREATE TABLE IF NOT EXISTS expense_month_budget (
  month TEXT PRIMARY KEY,
  opening_balance REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- 自律打卡：习惯定义
--
-- active_days 用逗号分隔的 ISO 星期（1=周一 … 7=周日），空串表示每天都要做。
-- 为什么不单独建一张"习惯-星期"关联表：打卡的习惯通常就几个，
-- 一串数字足够，省掉一张表与一次 join，读取时 split 一下即可。
-- start_date 之前的日子不参与统计：否则"今天新建的习惯"会让过去的日子变成未完成，
-- 给用户一种"我一直在欠债"的错觉。
CREATE TABLE IF NOT EXISTS habit (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '⭐',
  color TEXT NOT NULL DEFAULT '#4F7CFF',
  active_days TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 自律打卡：签到
--
-- 同一习惯同一天只允许一条：用 UNIQUE 约束在数据库层保证，
-- 这样"重复点击"最多触发一次冲突，不会记出两份完成。
CREATE TABLE IF NOT EXISTS habit_checkin (
  habit_id TEXT NOT NULL REFERENCES habit(id) ON DELETE CASCADE,
  checked_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (habit_id, checked_on)
);
CREATE INDEX IF NOT EXISTS idx_checkin_date ON habit_checkin(checked_on);
-- 关联只存标识和日期，日记内容仍经过私密存储读取。
CREATE TABLE IF NOT EXISTS journal_link (
 source_kind TEXT NOT NULL, source_id TEXT NOT NULL, diary_date TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(source_kind,source_id,diary_date)
);
CREATE INDEX IF NOT EXISTS idx_journal_link_date ON journal_link(diary_date);
-- Adjacency list: no fixed depth, step count, or recursive cascade limit.
CREATE TABLE IF NOT EXISTS goal_node (
 id TEXT PRIMARY KEY,root_id TEXT NOT NULL,parent_id TEXT,
 title TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',completed_at TEXT,last_completed_at TEXT,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goal_root ON goal_node(root_id);
CREATE INDEX IF NOT EXISTS idx_goal_parent ON goal_node(parent_id,sort_order);
CREATE TABLE IF NOT EXISTS goal_event (
 id TEXT PRIMARY KEY,node_id TEXT NOT NULL,action TEXT NOT NULL,occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_event_node ON goal_event(node_id,occurred_at);
CREATE TABLE IF NOT EXISTS goal_progress (
 id TEXT PRIMARY KEY,node_id TEXT NOT NULL,progress_date TEXT NOT NULL,delta REAL NOT NULL,
 value_after REAL NOT NULL,unit TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_progress_date ON goal_progress(node_id,progress_date,created_at);
CREATE TABLE IF NOT EXISTS goal_preference (slot INTEGER PRIMARY KEY CHECK(slot=1),root_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_event(id TEXT PRIMARY KEY,title TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',type TEXT NOT NULL,start_at TEXT NOT NULL,end_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_calendar_event_date ON calendar_event(start_at);
`;
