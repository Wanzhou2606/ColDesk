import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, getDb } from './db';
import { getActiveSemester, getCourses } from './db/repositories';
import { nowLocal } from '@shared/time';

export function currentTimetable() {
  const semester = getActiveSemester();
  return { semester: semester ?? null, count: semester ? getCourses(semester.id).length : 0 };
}

/** A dedicated, complete backup is required before deleting a real timetable. */
export function backupTimetable(): string | undefined {
  const databases = getDb().prepare('PRAGMA database_list').all() as Array<{name:string;file:string}>;
  if (!databases.find(row => row.name === 'main')?.file) return undefined;
  const directory = join(getDataDir(), 'backup');
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `timetable-before-delete-${Date.now()}-${randomUUID().slice(0,8)}.db`);
  try { getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`); }
  catch { throw Error('备份未能完成，课表没有删除。请检查磁盘空间后重试。'); }
  return target;
}

/** Keep the empty active semester and bell times so an older timetable cannot reappear. */
export function clearTimetableRows(semesterId: string): void {
  const db = getDb(), ts = nowLocal();
  db.prepare(`UPDATE course_session_override SET deleted_at=?,updated_at=? WHERE deleted_at IS NULL AND session_id IN
    (SELECT s.id FROM course_session s JOIN course c ON c.id=s.course_id WHERE c.semester_id=?)`).run(ts,ts,semesterId);
  db.prepare('UPDATE course_session SET deleted_at=?,updated_at=? WHERE deleted_at IS NULL AND course_id IN (SELECT id FROM course WHERE semester_id=?)').run(ts,ts,semesterId);
  db.prepare('UPDATE course SET deleted_at=?,updated_at=? WHERE deleted_at IS NULL AND semester_id=?').run(ts,ts,semesterId);
}

export function deleteCurrentTimetable(expectedId: unknown) {
  const current = currentTimetable();
  if (!current.semester || typeof expectedId !== 'string' || expectedId !== current.semester.id)
    throw Error('当前课表已变化，请重新打开后再删除');
  const backup = backupTimetable(); // Failure must stop the deletion.
  getDb().transaction(() => clearTimetableRows(current.semester!.id))();
  return { count: current.count, backup };
}
