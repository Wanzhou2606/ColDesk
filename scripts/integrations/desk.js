// ColDesk CLI（读写 %APPDATA%\ColDesk\coldesk.db）
// 用 node:sqlite（Node >= 22.5），不需要 better-sqlite3 原生模块。
// 覆盖：任务 / 日程(calendar_event) / 课表 / 记账 / 打卡
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID } from 'node:crypto'
import {createRequire} from 'node:module'
import {join} from 'node:path'
const require=createRequire(import.meta.url)
function timetableReader(){
  const file=process.env.QQ_DESK_READER||join(process.env.LOCALAPPDATA,'Programs','ColDesk','resources','assistant-reader.cjs')
  return require(file).readAssistantCourses
}

const DEFAULT_DB = join(process.env.APPDATA,'coldesk','coldesk.db')
const DB_PATH = process.env.QQ_DESK_DB || DEFAULT_DB
const TASK_TYPES = ['assignment', 'experiment', 'paper', 'exam_prep', 'todo']
const EVENT_TYPES = ['activity', 'lecture', 'class']

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) { out[key] = true } else { out[key] = next; i++ }
    } else out._.push(a)
  }
  return out
}

const pad = (n) => String(n).padStart(2, '0')
function nowLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function nowIso() { return new Date().toISOString() }
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function newId(prefix) { return `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}` }

function open(readOnly=false) {
  const db = new DatabaseSync(DB_PATH,{readOnly})
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

function normDue(v) {
  if (!v || v === true) return null
  const s = String(v).trim().replace(' ', 'T')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/)
  if (!m) throw new Error(`时间格式不对（要 YYYY-MM-DDTHH:mm）: ${v}`)
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4] ?? '23')}:${m[5] ?? '00'}`
}
function normDate(v) {
  if (!v || v === true) return today()
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) throw new Error(`日期格式不对（要 YYYY-MM-DD）: ${v}`)
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
}
function normClock(v, name) {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) throw new Error(`${name} 要写成 HH:mm，如 16:00`)
  return `${pad(m[1])}:${m[2]}`
}
function clampUrgency(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, Math.round(n)))
}
function weekdayOf(dateStr) { return ((new Date(dateStr + 'T00:00:00').getDay() + 6) % 7) + 1 }

/* ---------------- 任务 ---------------- */

function addTask(a) {
  const title = typeof a.title === 'string' ? a.title.trim() : ''
  if (!title) throw new Error('title 必填')
  const type = TASK_TYPES.includes(a.type) ? a.type : 'todo'
  const db = open()
  try {
    const id = newId('task')
    const ts = nowLocal()
    db.prepare(
      `INSERT INTO task (id, domain, type, title, detail, source, course_id, urgency, status,
                         due_at, est_minutes, splittable, earliest_start, remind_policy,
                         remind_offsets, auto_scheduled, created_at, updated_at)
       VALUES (?, 'study', ?, ?, ?, 'qq', NULL, ?, 'open', ?, ?, 1, NULL, 'default', NULL, 1, ?, ?)`
    ).run(id, type, title, typeof a.detail === 'string' ? a.detail : null, clampUrgency(a.urgency), normDue(a.due),
      a.est ? Number(a.est) : null, ts, ts)
    const row = db.prepare('SELECT id,title,type,urgency,status,due_at FROM task WHERE id = ?').get(id)
    return { ok: true, action: 'add-task', task: row }
  } finally { db.close() }
}

function listTasks(a) {
  const status = a.status && a.status !== true ? String(a.status) : 'open'
  const limit = Math.min(100, Math.max(1, Number(a.limit) || 20))
  const db = open()
  try {
    const where = ['deleted_at IS NULL']
    const params = []
    if (status !== 'all') { where.push('status = ?'); params.push(status) }
    const rows = db.prepare(
      `SELECT id,title,type,urgency,status,due_at,est_minutes,detail FROM task
       WHERE ${where.join(' AND ')}
       ORDER BY (due_at IS NULL), due_at ASC, urgency DESC LIMIT ${limit}`
    ).all(...params)
    return { ok: true, action: 'list-tasks', count: rows.length, tasks: rows }
  } finally { db.close() }
}

function findTask(db, a) {
  if (a.id && a.id !== true) {
    const r = db.prepare('SELECT * FROM task WHERE id = ? AND deleted_at IS NULL').get(String(a.id))
    if (r) return r
  }
  const key = a.match || a.title
  if (key && key !== true) {
    const r = db.prepare(
      `SELECT * FROM task WHERE deleted_at IS NULL AND title LIKE ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(`%${String(key)}%`)
    if (r) return r
  }
  throw new Error('没找到对应任务（给 --id 或 --title 关键字）')
}

function doneTask(a) {
  const db = open()
  try {
    const t = findTask(db, a)
    db.prepare('UPDATE task SET status = ?, done_at = ?, updated_at = ? WHERE id = ?')
      .run('done', nowLocal(), nowLocal(), t.id)
    return { ok: true, action: 'done-task', task: { id: t.id, title: t.title } }
  } finally { db.close() }
}

function deleteTask(a) {
  const db = open()
  try {
    const t = findTask(db, a)
    const ts = nowLocal()
    db.prepare('UPDATE task SET deleted_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, t.id)
    db.prepare('UPDATE schedule_block SET deleted_at = ?, updated_at = ? WHERE task_id = ?').run(ts, ts, t.id)
    db.prepare('DELETE FROM reminder WHERE task_id = ?').run(t.id)
    return { ok: true, action: 'delete-task', task: { id: t.id, title: t.title } }
  } finally { db.close() }
}

function updateTask(a) {
  const db = open()
  try {
    const t = findTask(db, { id: a.id, match: a.match })
    const sets = []
    const params = []
    if (a.new_title && a.new_title !== true) { sets.push('title = ?'); params.push(String(a.new_title)) }
    if (a.due !== undefined) { sets.push('due_at = ?'); params.push(normDue(a.due)) }
    if (a.urgency !== undefined) { sets.push('urgency = ?'); params.push(clampUrgency(a.urgency)) }
    if (a.type && a.type !== true && TASK_TYPES.includes(String(a.type))) { sets.push('type = ?'); params.push(String(a.type)) }
    if (a.detail !== undefined) { sets.push('detail = ?'); params.push(a.detail === true ? null : String(a.detail)) }
    if (a.status && a.status !== true) { sets.push('status = ?'); params.push(String(a.status)) }
    if (!sets.length) throw new Error('没有要改的字段')
    sets.push('updated_at = ?'); params.push(nowLocal())
    params.push(t.id)
    db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return { ok: true, action: 'update-task', task: { id: t.id, title: t.title } }
  } finally { db.close() }
}

/* ---------------- 日程（calendar_event，与 App 的「新建日程」同一张表） ---------------- */

function listEvents(db, date, from = date, to = date) {
  return db.prepare(
    `SELECT id, title, detail, type, start_at AS startAt, end_at AS endAt
     FROM calendar_event WHERE substr(start_at,1,10) BETWEEN ? AND ? ORDER BY start_at`
  ).all(from, to)
}

function addEvent(a) {
  const title = typeof a.title === 'string' ? a.title.trim() : ''
  if (!title) throw new Error('title 必填')
  const date = normDate(a.date)
  const start = normClock(a.start, 'start')
  const end = normClock(a.end, 'end')
  if (end <= start) throw new Error('结束时间要晚于开始时间')
  const type = EVENT_TYPES.includes(a.type) ? a.type : 'activity'
  const db = open()
  try {
    const id = randomUUID()
    const ts = nowIso()
    db.prepare(
      'INSERT INTO calendar_event (id,title,detail,type,start_at,end_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(id, title, typeof a.detail === 'string' ? a.detail : '', type, `${date}T${start}`, `${date}T${end}`, ts, ts)
    return { ok: true, action: 'add-schedule', schedule: { id, date, start, end, title, type } }
  } finally { db.close() }
}

function findEvent(db, a) {
  if (a.id && a.id !== true) {
    const r = db.prepare('SELECT * FROM calendar_event WHERE id = ?').get(String(a.id))
    if (r) return r
  }
  const key = a.match || a.title
  if (key && key !== true) {
    const r = db.prepare('SELECT * FROM calendar_event WHERE title LIKE ? ORDER BY start_at DESC LIMIT 1').get(`%${String(key)}%`)
    if (r) return r
  }
  throw new Error('没找到对应日程（给 --id 或 --title 关键字）')
}

function moveEvent(a) {
  const db = open()
  try {
    const e = findEvent(db, a)
    const date = a.date && a.date !== true ? normDate(a.date) : String(e.start_at).slice(0, 10)
    const start = a.start && a.start !== true ? normClock(a.start, 'start') : String(e.start_at).slice(11, 16)
    const end = a.end && a.end !== true ? normClock(a.end, 'end') : String(e.end_at).slice(11, 16)
    if (end <= start) throw new Error('结束时间要晚于开始时间')
    db.prepare('UPDATE calendar_event SET start_at = ?, end_at = ?, updated_at = ? WHERE id = ?')
      .run(`${date}T${start}`, `${date}T${end}`, nowIso(), e.id)
    return { ok: true, action: 'move-schedule', schedule: { id: e.id, date, start, end, title: e.title } }
  } finally { db.close() }
}

function deleteEvent(a) {
  const db = open()
  try {
    const e = findEvent(db, a)
    db.prepare('DELETE FROM calendar_event WHERE id = ?').run(e.id)
    return { ok: true, action: 'delete-schedule', schedule: { id: e.id, title: e.title } }
  } finally { db.close() }
}

/* ---------------- 课表 ---------------- */

// Use the shipped reader: current semester/campus, actual dates, teaching weeks and overrides.
function courseRows(db,date=today()) {
  return timetableReader()(db,{date}).courses
}

function course(a) {
  const db=open(true)
  try {
    const weekday=a.weekday&&a.weekday!==true?Number(a.weekday):undefined
    const result=timetableReader()(db,{date:normDate(a.date),week:true,weekday})
    return {ok:true,action:'course',...result,count:result.courses.length}
  } finally {db.close()}
}

/* ---------------- 一天的总览 ---------------- */

function day(a) {
  const date = normDate(a.date)
  const wd = weekdayOf(date)
  const db = open(true)
  try {
    const events = listEvents(db, date)
    const blocks = db.prepare(
      `SELECT b.start_at, b.end_at, t.title, b.locked, b.origin
       FROM schedule_block b JOIN task t ON t.id = b.task_id
       WHERE b.date = ? AND b.deleted_at IS NULL AND t.deleted_at IS NULL
       ORDER BY b.start_at`
    ).all(date)
    const busy = db.prepare(
      `SELECT title, start_at, end_at FROM busy_block
       WHERE deleted_at IS NULL AND (date = ? OR (weekday IS NOT NULL AND weekday = ?))
       ORDER BY start_at`
    ).all(date, wd)
    const lessons = courseRows(db,date)
    const due = db.prepare(
      `SELECT id,title,due_at,urgency FROM task
       WHERE deleted_at IS NULL AND status = 'open' AND substr(due_at,1,10) = ? ORDER BY due_at`
    ).all(date)
    return {
      ok: true, action: 'day', date, weekday: wd,
      lessons, events, busy, blocks, tasksDue: due,
      empty: lessons.length + events.length + busy.length + blocks.length + due.length === 0,
    }
  } finally { db.close() }
}

/* ---------------- 记账 ---------------- */

function resolveCategory(db, name) {
  if (!name || name === true) return null
  const s = String(name).trim()
  const exact = db.prepare('SELECT * FROM expense_category WHERE name = ?').get(s)
  if (exact) return exact
  const like = db.prepare('SELECT * FROM expense_category WHERE name LIKE ? ORDER BY sort_order LIMIT 1').get(`%${s}%`)
  return like || null
}

function addExpense(a) {
  const amount = Number(a.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount 要是正数，如 12.5')
  const db = open()
  try {
    const cat = resolveCategory(db, a.category)
    if (!cat) throw new Error(`没找到分类「${a.category || ''}」，可用的有：` + db.prepare('SELECT name FROM expense_category ORDER BY sort_order').all().map((r) => r.name).join('、'))
    const id = newId('exp')
    const occurred = normDate(a.date)
    db.prepare('INSERT INTO expense_entry (id, category_id, amount, note, occurred_on, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, cat.id, amount, typeof a.note === 'string' ? a.note : '', occurred, nowIso())
    const month = occurred.slice(0, 7)
    const total = db.prepare("SELECT SUM(amount) AS s FROM expense_entry WHERE substr(occurred_on,1,7) = ?").get(month).s
    return { ok: true, action: 'add-expense', expense: { id, amount, category: cat.name, note: a.note || '', date: occurred }, monthTotal: total }
  } finally { db.close() }
}

function listExpense(a) {
  const month = a.month && a.month !== true ? String(a.month) : today().slice(0, 7)
  const db = open()
  try {
    const rows = db.prepare(
      `SELECT e.amount, e.note, e.occurred_on AS date, c.name AS category
       FROM expense_entry e JOIN expense_category c ON c.id = e.category_id
       WHERE substr(e.occurred_on,1,7) = ? ORDER BY e.occurred_on DESC, e.created_at DESC`
    ).all(month)
    const total = rows.reduce((s, r) => s + r.amount, 0)
    const byCat = {}
    for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + r.amount
    return { ok: true, action: 'list-expense', month, total: Math.round(total * 100) / 100, byCategory: byCat, count: rows.length, recent: rows.slice(0, 20) }
  } finally { db.close() }
}

/* ---------------- 打卡 ---------------- */

function listHabits() {
  const db = open()
  try {
    const todayStr = today()
    const rows = db.prepare('SELECT id,name,archived FROM habit WHERE archived = 0 ORDER BY sort_order').all()
    const checked = new Set(
      db.prepare('SELECT habit_id FROM habit_checkin WHERE checked_on = ?').all(todayStr).map((r) => r.habit_id)
    )
    return { ok: true, action: 'list-habits', date: todayStr, habits: rows.map((h) => ({ id: h.id, name: h.name, checkedToday: checked.has(h.id) })) }
  } finally { db.close() }
}

function findHabit(db, name) {
  if (!name || name === true) throw new Error('要给 --name')
  const r = db.prepare('SELECT * FROM habit WHERE name LIKE ? AND archived = 0 ORDER BY sort_order LIMIT 1').get(`%${String(name)}%`)
  if (!r) throw new Error(`没找到习惯「${name}」，可用的有：` + db.prepare('SELECT name FROM habit WHERE archived = 0').all().map((x) => x.name).join('、'))
  return r
}

function checkHabit(a) {
  const db = open()
  try {
    const h = findHabit(db, a.name)
    const day = normDate(a.date)
    db.prepare('INSERT OR IGNORE INTO habit_checkin (habit_id, checked_on, created_at) VALUES (?,?,?)').run(h.id, day, nowIso())
    const streak = db.prepare('SELECT COUNT(*) AS c FROM habit_checkin WHERE habit_id = ? AND checked_on = ?').get(h.id, day).c
    return { ok: true, action: 'check-habit', habit: h.name, date: day, checked: streak > 0 }
  } finally { db.close() }
}

function uncheckHabit(a) {
  const db = open()
  try {
    const h = findHabit(db, a.name)
    const day = normDate(a.date)
    db.prepare('DELETE FROM habit_checkin WHERE habit_id = ? AND checked_on = ?').run(h.id, day)
    return { ok: true, action: 'uncheck-habit', habit: h.name, date: day }
  } finally { db.close() }
}

/* ---------------- 入口 ---------------- */

const COMMANDS = {
  add: addTask,
  list: listTasks,
  done: doneTask,
  delete: deleteTask,
  update: updateTask,
  course,
  day,
  'ls-schedule': (a) => {
    const date = normDate(a.date)
    const db = open()
    try { return { ok: true, action: 'ls-schedule', date, events: listEvents(db, date) } } finally { db.close() }
  },
  'add-schedule': addEvent,
  'move-schedule': moveEvent,
  'del-schedule': deleteEvent,
  'add-expense': addExpense,
  'ls-expense': listExpense,
  'ls-habits': listHabits,
  'check-habit': checkHabit,
  'uncheck-habit': uncheckHabit,
}

function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const fn = COMMANDS[cmd]
  try {
    if (!fn) throw new Error('用法: ' + Object.keys(COMMANDS).join(' | '))
    const result = fn(parseArgs(argv.slice(1)))
    process.stdout.write(JSON.stringify(result, null, 2))
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.message || err) }))
    process.exitCode = 1
  }
}

main()
