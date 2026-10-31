/** Read-only local audit: store counts/digests, never diary text, attachments or credentials. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Use before or after');
const folder=path.resolve(__dirname,'../preview/maintenance-audit');fs.mkdirSync(folder,{recursive:true});
let database=path.join(process.env.APPDATA,'coldesk','coldesk.db');
if(phase==='before'&&process.argv.includes('--latest-backup')){
 const backup=path.join(process.env.APPDATA,'coldesk','backup');
 const latest=fs.readdirSync(backup).filter(name=>/^coldesk-.*\.db$/.test(name)).map(name=>({file:path.join(backup,name),time:fs.statSync(path.join(backup,name)).mtimeMs})).sort((a,b)=>b.time-a.time)[0];
 if(!latest)throw Error('没有找到升级前自动备份');database=latest.file;
}
const db=new DatabaseSync(database,{readOnly:true});
const tables=['task','home_entry','home_asset','expense_entry','expense_category','expense_month_budget','habit','habit_checkin','goal_node','goal_event','goal_progress','goal_preference','journal_link','calendar_event','course','course_session','semester','time_slot','manual_schedule'];
const records={};
for(const table of tables){
 const rows=db.prepare(table==='manual_schedule'?"SELECT * FROM schedule_block WHERE origin='manual' OR locked=1":'SELECT * FROM "'+table+'"').all();
 const digest=crypto.createHash('sha256');for(const row of rows.map(row=>JSON.stringify(row)).sort())digest.update(row).update('\n');
 records[table]={count:rows.length,sha256:digest.digest('hex')};
}
const count=sql=>db.prepare(sql).get().n;
const report={phase,source:path.basename(database),at:new Date().toISOString(),quickCheck:db.prepare('PRAGMA quick_check').get().quick_check,foreignKeyIssues:db.prepare('PRAGMA foreign_key_check').all().length,records,
 reminders:count('SELECT count(*) AS n FROM reminder'),
 inactiveReminders:count("SELECT count(*) AS n FROM reminder r LEFT JOIN task t ON t.id=r.task_id WHERE r.task_id IS NOT NULL AND (t.id IS NULL OR t.deleted_at IS NOT NULL OR t.status IN ('done','canceled'))"),
 duplicateReminders:count("SELECT COALESCE(SUM(n-1),0) AS n FROM (SELECT count(*) AS n FROM reminder WHERE level<>'snooze' GROUP BY task_id,fire_at,level HAVING count(*)>1)"),
 obsoleteAutoBlocks:count("SELECT count(*) AS n FROM schedule_block WHERE origin='auto' AND locked=0 AND deleted_at IS NOT NULL")};
db.close();
if(phase==='after'){
 const before=JSON.parse(fs.readFileSync(path.join(folder,'before.json'),'utf8'));
 report.changedRecordTables=tables.filter(table=>before.records[table].sha256!==records[table].sha256);
 report.personalRecordsUnchanged=report.changedRecordTables.length===0;
 report.remindersRemoved=before.reminders-report.reminders;
 report.autoBlocksRemoved=before.obsoleteAutoBlocks-report.obsoleteAutoBlocks;
}
fs.writeFileSync(path.join(folder,phase+'.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({phase,quickCheck:report.quickCheck,foreignKeyIssues:report.foreignKeyIssues,reminders:report.reminders,inactiveReminders:report.inactiveReminders,duplicateReminders:report.duplicateReminders,obsoleteAutoBlocks:report.obsoleteAutoBlocks,personalRecordsUnchanged:report.personalRecordsUnchanged,changedRecordTables:report.changedRecordTables,remindersRemoved:report.remindersRemoved,autoBlocksRemoved:report.autoBlocksRemoved}));
