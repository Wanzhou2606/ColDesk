import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  DEFAULT_PREFS,
  type PlanInput,
  type PlannerTaskInput,
  busyIntervalsOfDay,
  freeSlotsOfDay,
  mergeIntervals,
  planSchedule,
  selectPlannableTasks,
  subtractIntervals,
  toPlannerTask
} from '../planner';
import { SEMESTER, TIME_SLOTS, block, course, session, task } from './fixtures';

const NOW = '2025-10-08T12:00'; // 周三中午

const LESSON = session('s1', 'c1', 3, 1, 2, { room: 'A301' }); // 周三 08:00-09:40
const COURSE = course('c1', '数据结构');

function baseInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    semester: SEMESTER,
    courses: [COURSE],
    sessions: [LESSON],
    overrides: [],
    timeSlots: TIME_SLOTS,
    exams: [],
    busy: [],
    lockedBlocks: [],
    tasks: [],
    ...overrides
  };
}

function plannerTask(id: string, overrides: Partial<PlannerTaskInput> = {}): PlannerTaskInput {
  return {
    id,
    title: id,
    domain: 'study',
    type: 'assignment',
    urgency: 3,
    priorityScore: 0,
    estMinutes: 60,
    splittable: true,
    ...overrides
  };
}

describe('planner: 区间运算', () => {
  it('合并重叠与相邻区间', () => {
    assert.deepEqual(
      mergeIntervals([
        { start: 480, end: 540 },
        { start: 520, end: 600 },
        { start: 700, end: 720 }
      ]),
      [
        { start: 480, end: 600 },
        { start: 700, end: 720 }
      ]
    );
  });

  it('扣除占用区间，支持一个区间被切成两段', () => {
    assert.deepEqual(subtractIntervals([{ start: 480, end: 720 }], [{ start: 540, end: 600 }]), [
      { start: 480, end: 540 },
      { start: 600, end: 720 }
    ]);
  });

  it('没有任何占用时保持原样', () => {
    assert.deepEqual(subtractIntervals([{ start: 480, end: 720 }], []), [{ start: 480, end: 720 }]);
  });
});

describe('planner: 可用时段计算', () => {
  it('课程时间被扣掉，剩下的空闲从 09:40 开始', () => {
    const busy = busyIntervalsOfDay({
      date: '2025-10-08',
      semester: SEMESTER,
      courses: [COURSE],
      sessions: [LESSON],
      overrides: [],
      timeSlots: TIME_SLOTS,
      exams: [],
      busy: [],
      lockedBlocks: []
    });
    assert.deepEqual(busy, [{ start: 480, end: 580 }]); // 08:00-09:40

    const prefs = { ...DEFAULT_PREFS, nightBufferMinutes: 0 };
    const free = freeSlotsOfDay({
      date: '2025-10-08',
      domain: 'study',
      prefs,
      busyIntervals: busy,
      nowDate: '2025-10-08'
    });
    assert.deepEqual(free, [
      { start: 580, end: 720 }, // 09:40-12:00
      { start: 840, end: 1080 }, // 14:00-18:00
      { start: 1140, end: 1380 } // 19:00-23:00
    ]);
  });

  it('睡前缓冲会裁掉窗口末尾', () => {
    const free = freeSlotsOfDay({
      date: '2025-10-08',
      domain: 'study',
      prefs: DEFAULT_PREFS,
      busyIntervals: [],
      nowDate: '2025-10-08'
    });
    assert.equal(free[free.length - 1].end, 1380 - DEFAULT_PREFS.nightBufferMinutes);
  });
});

describe('planner: 全自动排程', () => {
  it('紧迫任务排进今天剩下的空闲，并给出可解释理由', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('report', {
            title: '交数据结构实验报告',
            urgency: 4,
            priorityScore: 300,
            estMinutes: 100,
            dueAt: '2025-10-09T18:00'
          })
        ]
      })
    );

    assert.equal(result.unscheduled.length, 0);
    assert.equal(result.blocks.length, 1);
    const b = result.blocks[0];
    assert.equal(b.date, '2025-10-08');
    // 12:00 时上午窗口已经结束，13:00 前是午休窗口，因此第一段可用时间从 14:00 开始
    assert.equal(b.startAt, '2025-10-08T14:00');
    assert.equal(b.endAt, '2025-10-08T15:40');
    assert.equal(b.plannedMinutes, 100);
    assert.ok(b.reason.includes('紧迫度 4'));
    assert.ok(b.reason.includes('预估 1 小时 40 分钟'));
  });

  it('拆块：超过单块上限会拆开，块间保持休息，总量不超预估', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('big', {
            title: '写论文',
            urgency: 5,
            priorityScore: 500,
            estMinutes: 200,
            dueAt: '2025-10-10T18:00'
          })
        ]
      })
    );
    assert.ok(result.blocks.length >= 3);
    assert.equal(
      result.blocks.reduce((sum, b) => sum + b.plannedMinutes, 0),
      200,
      '排入的总时长必须等于预估，不能多排'
    );
    // 除收尾的短块外，每块都要达到最小时长
    for (const b of result.blocks.slice(0, -1)) {
      assert.ok(b.plannedMinutes >= DEFAULT_PREFS.minBlockMinutes, `块 ${b.startAt} 只有 ${b.plannedMinutes} 分钟`);
    }
    // 同一天的相邻块之间至少有 breakMinutes 间隔
    const sameDay = result.blocks.filter((b) => b.date === result.blocks[0].date);
    for (let i = 1; i < sameDay.length; i += 1) {
      const prevEnd = Number(sameDay[i - 1].endAt.slice(14, 16)) + Number(sameDay[i - 1].endAt.slice(11, 13)) * 60;
      const curStart = Number(sameDay[i].startAt.slice(14, 16)) + Number(sameDay[i].startAt.slice(11, 13)) * 60;
      assert.ok(curStart - prevEnd >= DEFAULT_PREFS.breakMinutes);
    }
    assert.ok(result.blocks[0].reason.includes('拆为'));
  });

  it('不可拆分的任务会尽量放进一个连续时段；放不下时才跨段并给出提示', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('single', { estMinutes: 200, splittable: false, dueAt: '2025-10-12T18:00' })
        ]
      })
    );
    // 单日额度 180 分钟 < 200 分钟，所以必然跨天
    assert.equal(result.blocks.length, 3);
    assert.equal(
      result.blocks.reduce((sum, b) => sum + b.plannedMinutes, 0),
      200
    );
  });

  it('更紧急的任务先拿到时间', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('later', { urgency: 2, priorityScore: 20, estMinutes: 90, dueAt: '2025-10-12T18:00' }),
          plannerTask('sooner', { urgency: 5, priorityScore: 400, estMinutes: 90, dueAt: '2025-10-09T18:00' })
        ]
      })
    );
    assert.equal(result.blocks[0].taskId, 'sooner');
  });

  it('单日上限会阻止把任务全塞进一天', () => {
    const result = planSchedule(
      baseInput({
        tasks: [plannerTask('huge', { urgency: 5, priorityScore: 600, estMinutes: 600, dueAt: '2025-10-20T18:00' })]
      })
    );
    const byDate = new Map<string, number>();
    for (const b of result.blocks) byDate.set(b.date, (byDate.get(b.date) ?? 0) + b.plannedMinutes);
    for (const [, minutes] of byDate) {
      assert.ok(minutes <= DEFAULT_PREFS.dailyCapMinutes.study, `单日 ${minutes} 分钟超上限`);
    }
  });

  it('已过截止时间的任务不排入并给出警告', () => {
    const result = planSchedule(
      baseInput({
        tasks: [plannerTask('late', { dueAt: '2025-10-08T09:00', estMinutes: 60 })]
      })
    );
    assert.equal(result.blocks.length, 0);
    assert.equal(result.unscheduled[0].reason, '截止时间已过，需要立即处理或延期 DDL');
    assert.equal(result.warnings[0].code, 'past_due');
  });

  it('锁定块不参与重排，且其占用会被避开', () => {
    const locked = block('b1', 'other', '2025-10-08', '2025-10-08T14:00', '2025-10-08T18:00', {
      plannedMinutes: 240,
      locked: true
    });
    const result = planSchedule(
      baseInput({
        lockedBlocks: [locked],
        tasks: [plannerTask('mine', { estMinutes: 60, dueAt: '2025-10-09T18:00' })]
      })
    );
    assert.equal(result.blocks.length, 1);
    assert.ok(result.blocks[0].startAt >= '2025-10-08T19:00');
  });

  it('截止当天为校准缓冲留出时间，排不下时给出 no_window 警告', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('tight', {
            urgency: 5,
            priorityScore: 900,
            estMinutes: 240,
            dueAt: '2025-10-08T15:00' // 今天 15:00 截止，但 14:00-15:00 前后留不出缓冲
          })
        ]
      })
    );
    assert.equal(result.blocks.length, 0);
    assert.equal(result.unscheduled.length, 1);
    assert.ok(result.warnings.some((w) => w.code === 'no_window'));
  });

  it('生活任务使用独立时段与独立容量', () => {
    const result = planSchedule(
      baseInput({
        tasks: [
          plannerTask('shopping', {
            domain: 'life',
            type: 'todo',
            urgency: 3,
            estMinutes: 45,
            dueAt: '2025-10-09T22:00'
          })
        ]
      })
    );
    assert.equal(result.blocks.length, 1);
    const start = result.blocks[0].startAt.slice(11, 16);
    // now 是 12:00，今天最早也只能从 12:05 开始，因此接受 12:00 起始窗口内的时刻
    assert.ok(
      (start >= '12:00' && start <= '13:30') || (start >= '18:00' && start <= '19:00'),
      `生活任务应排在生活时段，实际 ${start}`
    );
  });

  it('未来没有任何可用时段时明确报"排不进"而不是静默丢弃', () => {
    const result = planSchedule(
      baseInput({
        prefs: { horizonDays: 1, windows: { study: [], life: [] } },
        tasks: [plannerTask('nope', { estMinutes: 60, dueAt: '2025-10-09T18:00' })]
      })
    );
    assert.equal(result.blocks.length, 0);
    assert.equal(result.unscheduled.length, 1);
    assert.equal(result.warnings[0].code, 'capacity_shortage');
    assert.ok(result.warnings[0].message.includes('排不进'));
  });
});

describe('planner: 仓储任务转换', () => {
  it('toPlannerTask 复用界面排序分数，并挑选可排任务', () => {
    const t = task('t1', '作业', { urgency: 4, dueAt: '2025-10-09T18:00', estMinutes: 90 });
    const input = toPlannerTask(t, NOW);
    assert.equal(input.estMinutes, 90);
    assert.equal(input.domain, 'study');
    assert.ok(input.priorityScore > 0);

    assert.equal(selectPlannableTasks([t]).length, 1);
    assert.equal(selectPlannableTasks([task('done', 'x', { status: 'done' })]).length, 0);
    assert.equal(selectPlannableTasks([task('off', 'x', { autoScheduled: false })]).length, 0);
    assert.equal(selectPlannableTasks([task('casual', 'x', { urgency: 1 })]).length, 0);
  });
});

describe('手动安排与自动重排的配合', () => {
  it('用户确定手动安排后，不再为同一任务补排自动副本', () => {
    const locked=block('manual','mine','2025-10-08','2025-10-08T14:00','2025-10-08T15:00',{plannedMinutes:60,locked:true});
    const partial=planSchedule(baseInput({lockedBlocks:[locked],tasks:[plannerTask('mine',{estMinutes:90,dueAt:'2025-10-09T18:00'})]}));
    assert.equal(partial.blocks.length,0);
    const full=planSchedule(baseInput({lockedBlocks:[{...locked,plannedMinutes:90}],tasks:[plannerTask('mine',{estMinutes:90,dueAt:'2025-10-09T18:00'})]}));
    assert.equal(full.blocks.length,0); assert.equal(full.unscheduled.length,0);
  });
  it('不同任务自动安排时也不会重叠', () => {
    const result=planSchedule(baseInput({tasks:[plannerTask('first'),plannerTask('second')]}));
    assert.equal(result.blocks.reduce((sum,b)=>sum+b.plannedMinutes,0),120);
    for(let i=0;i<result.blocks.length;i++)for(let j=i+1;j<result.blocks.length;j++){
      const a=result.blocks[i],b=result.blocks[j];
      assert.ok(a.date!==b.date || a.endAt<=b.startAt || b.endAt<=a.startAt);
    }
  });
});
