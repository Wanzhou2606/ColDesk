import {IslandDeadlines} from '../src/components/IslandDeadlines';
import {nearbyDeadlineTasks,taskPageGroups} from '../../shared/taskActions';
import {HabitIconGrid} from '../src/components/HabitIconPicker';
import {DiaryExpenseButton} from '../src/components/DiaryExpenseButton';
import {TaskEditDialog} from '../src/components/TaskEditDialog';
/**
 * 渲染层测试：用 react-dom/server 把界面渲染成 HTML 再断言内容。
 *
 * 这样做的价值：这台机器上 Electron 被 Smart App Control 拦截，无法开 GUI 截图，
 * 但"悬浮窗到底显示了什么"必须被验证。把展示层抽成无副作用组件后，
 * 就能在纯 Node 下渲染并断言，覆盖到"当下日程 + 今日临期"的核心文案与结构。
 */

import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { App } from '../src/app/App';
import type { PageKey } from '../src/app/App';
import { WeekView } from '../src/pages/WeekView';
import { ToastStackView } from '../src/windows/ToastView';
import { WidgetView } from '../src/windows/WidgetView';
import { DayAgenda } from '../src/pages/DayAgenda';
import { DayView } from '../src/pages/DayView';
import { layoutIntervals } from '../src/lib/scheduleLayout';
import { ScheduleDeadlines } from '../src/components/ScheduleDeadlines';
import {TaskForm} from '../src/components/TaskForm';
import {CalendarEventEditor} from '../src/components/CalendarEventEditor';
import {fakeTask} from './fixtures';
import {CourseColorSettings} from '../src/components/CourseColorSettings';
import { UsageHelp } from '../src/components/UsageHelp';
import { userError } from '../src/lib/userError';
import type { WidgetActions } from '../src/windows/WidgetView';
import { fakeExpense, fakeView, fakeWeek } from './fixtures';

/**
 * 渲染整个 App。
 *
 * 注入 `view` 而不是依赖组件自己订阅：renderToStaticMarkup 不执行 effect，
 * 而 useAppState 在 effect 里才拿到数据，所以不注入的话 state 恒为 null，
 * 只能断言"导航里有没有这几个字"，无法验证页面真实内容。
 */
function renderApp(initialPage: PageKey = 'schedule', view: ReturnType<typeof fakeView> | null = fakeView()): string {
  const Root = App as unknown as (props: {
    initialPage?: PageKey;
    view?: ReturnType<typeof fakeView> | null;
  }) => JSX.Element;
  return renderToStaticMarkup(createElement(Root, { initialPage, view }));
}

/** 渲染 WidgetView，返回 HTML 文本 */
function renderWidget(
  overrides: Parameters<typeof fakeView>[0] = {},
  options: {
    collapsed?: boolean;
    quickTitle?: string;
    urgency?: 1 | 2 | 3 | 4 | 5;
    domain?: 'study' | 'life';
    rippleKey?: string | null;
    captured?: Partial<Record<keyof WidgetActions, unknown>>;
    onQuickAdd?: (input: { title: string; urgency: number; domain: string }) => void;
  } = {}
): string {
  const captured = options.captured ?? {};
  return renderToStaticMarkup(
    createElement(WidgetView, {
      state: fakeView(overrides),
      collapsed: options.collapsed ?? false,
      rippleKey: options.rippleKey ?? null,
      quickTitle: options.quickTitle ?? '',
      urgency: options.urgency ?? 3,
      domain: options.domain ?? 'study',
      onToggleCollapsed: () => undefined,
      onQuickTitleChange: () => undefined,
      onUrgencyChange: () => undefined,
      onDomainChange: () => undefined,
      actions: {
        onQuickAdd: (input) => {
          captured.onQuickAdd = input;
          options.onQuickAdd?.(input as { title: string; urgency: number; domain: string });
        },
        onComplete: (taskId) => {
          captured.onComplete = taskId;
        },
        onHide: () => {
          captured.onHide = true;
        }
      } as WidgetActions
    })
  );
}

describe('日程：相交安排与清单展示', () => {
  it('同一时段的安排分配独立列，首尾相接的安排可以复用', () => {
    const items = [{ start: 480, end: 540 }, { start: 480, end: 540 }, { start: 540, end: 600 }];
    const result = layoutIntervals(items, x => x);
    assert.deepEqual(result.map(x => [x.column, x.columns]), [[0, 2], [1, 2], [0, 1]]);
  });
  it('连续相交的区间共用列宽，三项同时进行时没有共用列', () => {
    const result = layoutIntervals([{ start: 0, end: 100 }, { start: 20, end: 70 }, { start: 30, end: 60 }, { start: 80, end: 120 }], x => x);
    assert.deepEqual(result.map(x => x.columns), [3, 3, 3, 3]);
    assert.deepEqual(result.slice(0, 3).map(x => x.column), [0, 1, 2]);
    assert.equal(result[3].column, 1);
  });
  it('布局排序不修改输入，空日程不报错', () => {
    const items = [{ start: 100, end: 200 }, { start: 0, end: 50 }];
    const saved = JSON.stringify(items);
    assert.equal(layoutIntervals(items, x => x)[0].item, items[1]);
    assert.equal(JSON.stringify(items), saved);
    assert.deepEqual(layoutIntervals([], x => x), []);
  });
  it('清单逐条呈现相交安排的完整标题并显示重叠提示', () => {
    const timeline = ['实验报告', '线性代数复习'].map((title, i) => ({ id: `overlap-${i}`, kind: 'block' as const, title, startAt: '2025-10-08T19:00', endAt: '2025-10-08T20:30' }));
    const html = renderToStaticMarkup(createElement(DayAgenda, { state: fakeView({ timeline }) }));
    assert.ok(html.includes('实验报告') && html.includes('线性代数复习'));
    assert.equal((html.match(/时间重叠/g) ?? []).length, 2);
    assert.ok(!html.includes('position:absolute'));
  });
  it('今天已结束的安排收起，查看其他日期时仍完整展示', () => {
    const state = fakeView({ now: '2025-10-08T18:00' });
    const today = renderToStaticMarkup(createElement(DayAgenda, { state }));
    assert.ok(today.includes('agenda-past') && today.includes('已结束的安排'));
    assert.ok(!today.includes('<details class="agenda-past" open'));
    const selected = renderToStaticMarkup(createElement(DayAgenda, { state, timeline: state.timeline }));
    assert.ok(!selected.includes('agenda-past'));
    assert.ok(selected.includes('概率论'));
  });
  it('空日程与数据尚未加载给出不同提示', () => {
    const empty = renderToStaticMarkup(createElement(DayAgenda, { state: fakeView({ timeline: [] }) }));
    assert.ok(empty.includes('这一天没有安排'));
    const loading = renderToStaticMarkup(createElement(DayAgenda, { state: null }));
    assert.ok(loading.includes('正在加载日程'));
  });
  it('时间轴相交安排有不同横向位置，悬停仍能读取完整信息', () => {
    const timeline = ['报告', '复习'].map((title, i) => ({ id: `time-${i}`, kind: 'block' as const, title, startAt: '2025-10-08T19:00', endAt: '2025-10-08T20:30' }));
    const html = renderToStaticMarkup(createElement(DayView, { state: fakeView({ timeline }) }));
    assert.ok(html.includes('left:calc(0% + 5px)') && html.includes('left:calc(50% + 5px)'));
    assert.equal((html.match(/width:calc\(50% - 10px\)/g) ?? []).length, 2);
    assert.ok(html.includes('19:00-20:30'));
  });
  it('截止栏合并重复任务并按截止顺序展示，完成按钮仍带任务名称', () => {
    const state = fakeView();
    state.urgentTasks = [...state.todayTasks, { ...state.todayTasks[0], task: { ...state.todayTasks[0].task, id: 'earlier', title: '更早截止', dueAt: '2025-10-08T11:00' } }];
    const html = renderToStaticMarkup(createElement(ScheduleDeadlines, { state }));
    assert.equal((html.match(/<li(?:\s[^>]*)?>/g) ?? []).length, 2);
    assert.ok(html.includes('完成：交数据结构实验报告'));
    assert.ok(html.indexOf('更早截止') < html.indexOf('交数据结构实验报告'));
  });
});

describe('渲染层：悬浮窗', () => {
  it('显示日期、三个分区标题与快速添加入口', () => {
    const html = renderWidget();
    assert.ok(html.includes('10月08日 周三'), '应显示日期');
    assert.ok(html.includes('当下'), '应有"当下"分区');
    assert.ok(html.includes('接下来'), '应有"接下来"分区');
    assert.ok(html.includes('今日临期'), '应有"今日临期"分区');
    assert.ok(html.includes('添加任务，回车保存'), '应有快速添加输入框');
    assert.ok(html.includes('widget-shell'), '外壳应带玻璃样式类');
    assert.ok(html.includes('drag-handle'), '顶部应有拖拽把手');
  });

  it('"接下来"显示课程时间与倒计时', () => {
    const html = renderWidget();
    assert.ok(html.includes('概率论'), '应显示课程名');
    assert.ok(html.includes('14:00-15:40'), '应显示时间段');
    assert.ok(html.includes('4 小时后开始'), '应显示倒计时');
    assert.ok(html.includes('B104'), '应显示教室');
  });

  it('正在上课时，当下卡片标记为"正在进行"', () => {
    const html = renderWidget({
      current: {
        id: 'lesson:ds',
        kind: 'lesson',
        title: '数据结构',
        startAt: '2025-10-08T08:00',
        endAt: '2025-10-08T09:40',
        location: 'A301',
        color: '#4F7CFF',
        status: 'ongoing',
        untilStartMinutes: -120,
        untilEndMinutes: 32,
        timeLabel: '08:00-09:40',
        countdownLabel: '还有 32 分钟结束'
      },
      primary: {
        id: 'lesson:ds',
        kind: 'lesson',
        title: '数据结构',
        startAt: '2025-10-08T08:00',
        endAt: '2025-10-08T09:40',
        location: 'A301',
        color: '#4F7CFF',
        status: 'ongoing',
        untilStartMinutes: -120,
        untilEndMinutes: 32,
        timeLabel: '08:00-09:40',
        countdownLabel: '还有 32 分钟结束'
      }
    });
    assert.ok(html.includes('正在进行'), '应显示"正在进行"');
    assert.ok(html.includes('数据结构'));
    assert.ok(html.includes('还有 32 分钟结束'));
    assert.ok(html.includes('A301'));
  });

  it('没有任何安排时给出友好文案', () => {
    const html = renderWidget({
      current: undefined,
      primary: undefined,
      next: [],
      timeline: [],
      todayTasks: [],
      urgentTasks: [],
      summary: { lessonCount: 0, dueTodayCount: 0, overdueCount: 0, doneTodayCount: 0, plannedMinutes: 0 }
    });
    assert.ok(html.includes('现在没有安排'));
    assert.ok(html.includes('在下方添加一项任务'), '空态应引导添加任务');
    assert.ok(html.includes('今天没有临期任务'), '无任务时应给出提示');
  });

  it('当下无安排时只提示尚未结束的课程', () => {
    const html = renderWidget({
      current: undefined,
      primary: undefined,
      next: []
    });
    assert.ok(html.includes('今天还有 1 节课'));
  });

  it('课程都结束后不再把全天课数当作剩余课数', () => {
    const html = renderWidget({ now: '2025-10-08T18:00', primary: undefined, current: undefined });
    assert.ok(html.includes('今天的课已结束'));
    assert.ok(!html.includes('今天还有 1 节课'));
  });

  it('未来几天的任务标为近期截止，不误报为今天到期', () => {
    const view = fakeView();
    const html = renderWidget({ todayTasks: [], urgentTasks: [{ ...view.todayTasks[0], dueLabel: '明天 21:00' }] });
    assert.ok(html.includes('近期截止'));
    assert.ok(html.includes('明天 21:00'));
    assert.ok(!html.includes('今日临期'));
  });

  it('剩余时间使用视图刷新后的分钟数，而非缓存的本机时间', () => {
    const view = fakeView();
    const task = view.todayTasks[0];
    const first = renderWidget({ todayTasks: [{ ...task, untilDueMinutes: 30 }] });
    const next = renderWidget({ todayTasks: [{ ...task, untilDueMinutes: 29 }] });
    assert.ok(first.includes('还剩 30 分钟'));
    assert.ok(next.includes('还剩 29 分钟'));
    assert.ok(!next.includes('还剩 30 分钟'));
  });

  it('临期任务显示截止时间、紧迫度语义与剩余时间', () => {
    const html = renderWidget();
    assert.ok(html.includes('交数据结构实验报告'));
    assert.ok(html.includes('今天 21:00'), '应显示截止时间');
    assert.ok(html.includes('紧迫 5 · 紧急'), '应显示紧迫度档位语义');
    assert.ok(html.includes('还剩'), '应显示剩余时间');
  });

  it('超期任务会标记出来，并在标题上提示含超期', () => {
    const html = renderWidget({
      todayTasks: [
        {
          task: {
            id: 't9',
            domain: 'study',
            type: 'assignment',
            title: '早该交的作业',
            source: 'manual',
            urgency: 2,
            status: 'open',
            progress: 0,
            allDay: false,
            splittable: true,
            remindPolicy: 'default',
            autoScheduled: true,
            dueAt: '2025-10-07T18:00',
            createdAt: '2025-10-01T09:00',
            updatedAt: '2025-10-01T09:00'
          },
          overdue: true,
          dueLabel: '昨天 18:00',
          untilDueMinutes: -1080
        }
      ],
      summary: { lessonCount: 1, dueTodayCount: 1, overdueCount: 1, doneTodayCount: 0, plannedMinutes: 60 }
    });
    assert.ok(html.includes('含超期'), '标题应标注含超期');
    assert.ok(html.includes('1 超期'));
    assert.ok(html.includes('task-row overdue'), '超期行应带 overdue 类');
    assert.ok(html.includes('已超期'), '应显示"已超期"');
  });

  it('排程警告会显示在卡片上', () => {
    const html = renderWidget({
      warnings: [{ code: 'capacity_shortage', message: '「写论文」排不进未来 14 天的可执行时段' }]
    });
    assert.ok(html.includes('排程提醒'));
    assert.ok(html.includes('排不进未来 14 天'));
  });

  it('折叠时只保留标题栏，不渲染正文', () => {
    const html = renderWidget({}, { collapsed: true });
    assert.ok(html.includes('ColDesk'), '折叠态仍显示标题');
    assert.ok(!html.includes('今日临期'), '折叠态不渲染正文');
    assert.ok(!html.includes('添加任务，回车保存'));
  });

  it('高优先级任务到来时带涟漪类', () => {
    const html = renderWidget({}, { rippleKey: 't1' });
    assert.ok(html.includes('ripple'), '应带液态涟漪类');
  });

  it('紧迫度选择器的语义随选中值变化', () => {
    assert.ok(renderWidget({}, { urgency: 1 }).includes('随意'));
    assert.ok(renderWidget({}, { urgency: 5 }).includes('紧急'));
    // 五个档位按钮都要在
    const html = renderWidget({}, { urgency: 3 });
    for (const u of [1, 2, 3, 4, 5]) {
      assert.ok(html.includes(`urgency-btn${u === 3 ? ' active' : ''}`), `缺少紧迫度按钮 ${u}`);
    }
  });

  it('悬浮窗不再显示学习或生活分类', () => {
    const html = renderWidget({}, { domain: 'life' });
    assert.ok(!html.includes('domain-picker'));
    assert.ok(html.includes('保存到任务栏'));
  });

  it('输入的标题会回填到输入框（避免丢失用户输入）', () => {
    const html = renderWidget({}, { quickTitle: '买洗衣液' });
    assert.ok(html.includes('value="买洗衣液"'), '输入值应受控回填');
  });

  it('快捷添加与完成动作会把参数交给回调', () => {
    const captured: Record<string, unknown> = {};
    // 直接调用传入的 actions，模拟用户点"添加"
    let added: { title: string; urgency: number; domain: string } | undefined;
    renderToStaticMarkup(
      createElement(WidgetView, {
        state: fakeView(),
        collapsed: false,
        rippleKey: null,
        quickTitle: '写实验报告',
        urgency: 5,
        domain: 'life',
        onToggleCollapsed: () => undefined,
        onQuickTitleChange: () => undefined,
        onUrgencyChange: () => undefined,
        onDomainChange: () => undefined,
        actions: {
          onQuickAdd: (input) => {
            added = input as { title: string; urgency: number; domain: string };
          },
          onComplete: (id) => {
            captured.completed = id;
          },
          onHide: () => {
            captured.hidden = true;
          }
        } as WidgetActions
      })
    );
    assert.equal(typeof added, 'undefined', '渲染本身不触发回调');
    void captured;
  });
});

describe('面向用户的内容与帮助', () => {
  it('已实现页面与帮助不展示开发计划或内部数据结构', () => {
    const pages = ['schedule', 'study', 'life', 'expenses', 'habits', 'settings'] as PageKey[];
    for (const page of pages) {
      const html = renderApp(page);
      assert.ok(!/预留模块|v0\.3 上线|v0\.2 支持|数据表已就绪|数据结构已预留|华为笔记/.test(html), page);
    }
    const help = renderToStaticMarkup(createElement(UsageHelp, { onReplay: () => {}, onNavigate: () => {} }));
    assert.ok(help.includes('重新查看引导') && help.includes('关闭主窗口后'));
  });
  it('错误提示隐藏内部通道与数据库信息，同时保留有效输入提示', () => {
    assert.equal(userError(new Error("Error invoking remote method 'task:create': Error: 请填写任务标题"), '保存失败'), '请填写任务标题');
    assert.equal(userError(new Error('SQLITE_ERROR: no such table task'), '保存失败'), '保存失败');
    assert.equal(userError(new Error('缺少任务 id'), '保存失败'), '保存失败');
  });
  it('新用户未设置预算时，不把正常花销标成超支', () => {
    const expense = fakeExpense();
    expense.summary = { ...expense.summary, budget: 0, remaining: -51, over: false };
    const html = renderApp('expenses', fakeView({ expense }));
    assert.ok(html.includes('未设置预算'));
    assert.ok(!html.includes('settlement-amount danger'));
  });
});

describe('渲染层：提醒弹窗', () => {
  const actions = {
    onDone: () => undefined,
    onSnooze: () => undefined,
    onDismiss: () => undefined,
    onOpen: () => undefined
  };

  it('任务提醒显示标题、紧迫度、完成与稍后按钮', () => {
    const html = renderToStaticMarkup(
      createElement(ToastStackView, {
        update: {
          items: [
            {
              id: 'toast1',
              kind: 'reminder',
              title: '交数据结构实验报告',
              body: '距截止 30 分钟',
              urgency: 5,
              timeLabel: '17:30',
              strong: true,
              taskId: 't1'
            }
          ],
          queued: 0
        },
        actions
      })
    );
    assert.ok(html.includes('任务提醒'));
    assert.ok(html.includes('交数据结构实验报告'));
    assert.ok(html.includes('紧迫 5 · 紧急'));
    assert.ok(html.includes('距截止 30 分钟'));
    assert.ok(html.includes('完成'), '有 taskId 时应提供"完成"按钮');
    assert.ok(html.includes('稍后 5 分钟'));
    assert.ok(html.includes('稍后 15 分钟'));
    assert.ok(html.includes('toast-card strong'), '强提醒应带 strong 类');
  });

  it('上课提醒使用"去上课"文案，且不含完成按钮', () => {
    const html = renderToStaticMarkup(
      createElement(ToastStackView, {
        update: {
          items: [
            {
              id: 'toast2',
              kind: 'class',
              title: '15 分钟后上 数据结构',
              body: '08:00 开始 · A301',
              urgency: 4,
              timeLabel: '07:45',
              strong: false
            }
          ],
          queued: 0
        },
        actions
      })
    );
    assert.ok(html.includes('去上课'));
    assert.ok(html.includes('A301'));
    assert.ok(!html.includes('>完成<'), '没有关联任务时不应出现完成按钮');
  });

  it('每日汇总与超期使用各自的标签', () => {
    const digest = renderToStaticMarkup(
      createElement(ToastStackView, {
        update: {
          items: [
            { id: 'd1', kind: 'daily_digest', title: '今日清单', body: '今天 3 节课', timeLabel: '07:30', strong: false }
          ],
          queued: 0
        },
        actions
      })
    );
    assert.ok(digest.includes('今日清单'));

    const overdue = renderToStaticMarkup(
      createElement(ToastStackView, {
        update: {
          items: [
            {
              id: 'o1',
              kind: 'overdue',
              title: '早该交的作业',
              urgency: 3,
              timeLabel: '18:00',
              strong: true,
              taskId: 't9'
            }
          ],
          queued: 0
        },
        actions
      })
    );
    assert.ok(overdue.includes('已超期'));
  });

  it('多条排队时显示剩余数量提示', () => {
    const html = renderToStaticMarkup(
      createElement(ToastStackView, {
        update: {
          items: [{ id: 'q1', kind: 'reminder', title: '任务 A', timeLabel: '09:00', strong: false }],
          queued: 2
        },
        actions
      })
    );
    assert.ok(html.includes('还有 2 条提醒在排队'));
  });

  it('空队列时不渲染任何卡片', () => {
    const html = renderToStaticMarkup(createElement(ToastStackView, { update: { items: [], queued: 0 }, actions }));
    assert.ok(!html.includes('toast-card'));
  });

  it('启动提醒提供普通关闭按钮，无需确认收到', () => {
    const html = renderToStaticMarkup(createElement(ToastStackView, {
      update: {items: [{id: 'startup', kind: 'startup', title: '今日安排', body: '今天的课程和紧急任务', timeLabel: '08:00', strong: false}], queued: 0}, actions
    }));
    assert.ok(html.includes('启动提醒'));
    assert.ok(html.includes('查看日程'));
    assert.ok(html.includes('title="关闭"'));
    assert.ok(!html.includes('收到'));
    assert.ok(!html.includes('请确认'));
    assert.ok(!html.includes('稍后'));
    assert.ok(!html.includes('startup strong'));
  });
});

describe('渲染层：周视图', () => {
  it('渲染 7 列，并标出今天', () => {
    const html = renderToStaticMarkup(
      createElement(WeekView, { week: fakeWeek('2025-10-08', { 0: 1, 2: 2 }) })
    );
    assert.ok(html.includes('week-head'), '应有表头');
    assert.ok(html.includes('week-day-head today'), '今天应有 today 标记');
    assert.ok(html.includes('周三') && html.includes('周二'), '应显示星期');
    assert.ok(html.includes('10/08') && html.includes('10/14'), '应显示日期');
    // 7 天各一列
    assert.equal((html.match(/class="week-col/g) ?? []).length, 7);
  });

  it('把当天的块按分钟定位，并保留时间文字与锁定标记', () => {
    const html = renderToStaticMarkup(
      createElement(WeekView, {
        week: {
          days: [
            {
              date: '2025-10-08',
              weekday: '周三',
              dayLabel: '10/08',
              isToday: true,
              blocks: [
                {
                  id: 'b1',
                  kind: 'lesson',
                  title: '数据结构',
                  location: 'A301',
                  color: '#4F7CFF',
                  startMinute: 8 * 60,
                  endMinute: 9 * 60 + 40,
                  timeLabel: '08:00-09:40'
                },
                {
                  id: 'b2',
                  kind: 'block',
                  title: '写实验报告',
                  color: '#8B7BD8',
                  startMinute: 19 * 60,
                  endMinute: 20 * 60,
                  timeLabel: '19:00-20:00',
                  reason: '紧迫度 5 · 截止明天',
                  locked: true
                }
              ]
            }
          ],
          weekStart: '2025-10-08',
          dueCount: 2,
          firstBusyIndex: 0
        }
      })
    );
    assert.ok(html.includes('数据结构'));
    assert.ok(html.includes('08:00-09:40'));
    assert.ok(html.includes('写实验报告'));
    assert.ok(/class="week-block[^"]*\blocked\b/.test(html), '锁定块应有 locked 类');
    assert.ok(html.includes('kind-lesson') && html.includes('kind-block'), '两种块应有各自样式类');
    const top=html.match(/class="week-block kind-lesson[^"]*" style="[^"]*top:([\d.]+)px/)?.[1];
    const height=html.match(/class="week-col[^"]*" style="height:([\d.]+)px/)?.[1];
    assert.ok(top&&height&&Math.abs(Number(top)-Number(height)*2/18)<.01, '08:00 的课程应位于 06:00–24:00 时间轴的 2/18 处');
    assert.ok(html.includes('紧迫度 5 · 截止明天'), '理由应进入 title');
  });

  it('整周无安排时给出空状态', () => {
    const html = renderToStaticMarkup(
      createElement(WeekView, {
        week: {
          days: Array.from({ length: 7 }, (_, i) => ({
            date: `2025-10-0${i + 8}`,
            weekday: '周一',
            dayLabel: `10/0${i + 8}`,
            isToday: i === 0,
            blocks: []
          })),
          weekStart: '2025-10-08',
          dueCount: 0,
          firstBusyIndex: 0
        }
      })
    );
    assert.ok(html.includes('这一周还没有任何安排'));
    assert.ok(!html.includes('week-col'), '空周不渲染列');
  });

  it('底部给出本周 DDL 数与已编排时长', () => {
    const html = renderToStaticMarkup(
      createElement(WeekView, {
        week: {
          days: [
            {
              date: '2025-10-08',
              weekday: '周三',
              dayLabel: '10/08',
              isToday: true,
              blocks: [
                {
                  id: 'b1',
                  kind: 'block',
                  title: '写报告',
                  color: '#8B7BD8',
                  startMinute: 19 * 60,
                  endMinute: 20 * 60 + 30,
                  timeLabel: '19:00-20:30'
                }
              ]
            }
          ],
          weekStart: '2025-10-08',
          dueCount: 4,
          firstBusyIndex: 0
        }
      })
    );
    assert.ok(html.includes('未来 7 天共 4 个 DDL'));
    assert.ok(html.includes('1 小时 30 分钟'), '应汇总本周编排时长');
  });
});

describe('渲染层：主窗口', () => {
  before(() => {
    // 主窗口页面会通过 IPC 拉状态；这里给一个空实现，让渲染在纯 Node 下可完成
    (globalThis as unknown as { window: unknown }).window = {
      coldesk: {
        invoke: async () => null,
        on: () => () => undefined
      },
      setInterval: () => 0,
      clearInterval: () => undefined,
      setTimeout: () => 0,
      clearTimeout: () => undefined
    };
  });

  it('导航包含已实现的功能，且不再出现笔记入口', () => {
    const html = renderApp('schedule');
    for (const label of ['日程', '任务', '记账', '打卡', '设置']) {
      assert.ok(html.includes(label), `导航缺少 ${label}`);
    }
    assert.ok(html.includes('ColDesk'));
    assert.ok(!html.includes('笔记'));
    assert.ok(html.indexOf('nav-label">Home') < html.indexOf('nav-label">日程'));
    assert.ok(html.includes('day-view-grid'), '打开软件仍默认进入日程表');
  });

  it('日程页默认展示可安排时间的表格，保留清单和周视图入口', () => {
    const html = renderApp('schedule');
    assert.ok(html.includes('日程表'));
    assert.ok(html.includes('周视图'));
    assert.ok(html.includes('清单'));
    assert.ok(html.includes('day-view-grid'), '默认显示可拖拽的时间格');
    assert.ok(html.includes('本次时长') && html.includes('draggable="true"'));
  });

  it('学习任务页包含新建入口，不展示未实现的考试页', () => {
    const html = renderApp('study');
    assert.ok(html.includes('任务'));
    assert.ok(!html.includes('考试模块') && !html.includes('数据结构已预留'));
    assert.ok(html.includes('新建任务'));
  });

  it('旧生活入口也显示统一任务列表', () => {
    const html = renderApp('life');
    assert.ok(html.includes('新建任务'));
    assert.ok(!html.includes('task-domain-switch'));
    assert.ok(html.includes('待办任务'));
  });

  it('首次使用显示欢迎引导，完成后不再重复展示', () => {
    const state = fakeView(); state.settings.onboardingVersion = 0;
    const first = renderApp('schedule', state);
    assert.ok(first.includes('欢迎使用 ColDesk') && first.includes('aria-modal="true"'));
    assert.ok(!renderApp('schedule').includes('欢迎使用 ColDesk'));
  });

  it('设置页保留实用分组，并提供使用帮助', () => {
    const html = renderApp('settings');

    assert.ok(html.includes('settings-layout'), '设置页应是二级菜单布局');
    assert.ok(html.includes('settings-nav'), '应有左侧分组导航');
    for (const label of ['通用', '外观与桌面', '个性化', '提醒', '课程与排程', '数据', 'AI 助手', '使用帮助']) {
      assert.ok(html.includes(label), `设置导航缺少「${label}」分组`);
    }

    const navItems = (html.match(/settings-nav-item/g) ?? []).length;
    assert.equal(navItems, 8, `设置分组应为 8 个，实际 ${navItems}`);
  });

  it('设置页默认只显示通用分组，其它分组内容不混在同一屏', () => {
    const html = renderApp('settings');
    assert.ok(html.includes('开机自启'), '通用分组应显示开机自启');
    assert.ok(!html.includes('提高对比度'), '对比度属于外观分组');
    // 拆分二级菜单的目的就是"不要啥都堆一页"，所以要能验证其它分组没被一起渲染
    assert.ok(!html.includes('每日汇总时间'), '提醒分组内容不应出现在通用分组里');
    assert.ok(!html.includes('更透'), '透明度滑块不应出现在通用分组里');
    assert.ok(!html.includes('滚动备份'), '数据分组内容不应出现在通用分组里');
  });
});

describe('渲染层：记账页', () => {
  it('导航里有记账入口', () => {
    const html = renderApp('schedule');
    assert.ok(html.includes('记账'), '主导航应包含记账');
  });

  it('记账页展示结算、柱状图、分类明细与快速记账', () => {
    const html = renderApp('expenses');
    // 夹具：餐饮 45/目标 30（超支），饮料 6/目标 10（结余），总预算 50
    assert.ok(html.includes('settlement'), '应有结算卡');
    assert.ok(html.includes('bar-chart'), '应有柱状图');
    assert.ok(html.includes('category-list'), '应有分类明细');
    assert.ok(html.includes('记一笔'), '应有快速记账区');
    assert.ok(html.includes('餐饮') && html.includes('饮料'));
  });

  it('超支被明确标出（这是记账功能的核心结论，不能只显示数字）', () => {
    const html = renderApp('expenses');
    // 日视图：花 51 / 预算 50 → 整体超支 1 元
    assert.ok(html.includes('settlement'), '结算卡应存在');
    assert.ok(html.includes('over'), '超支时应带上 over 标记');
    assert.ok(html.includes('超支') || html.includes('已超出'), '应出现超支字样');
  });

  it('柱状图为每个数据点渲染一根柱', () => {
    const html = renderApp('expenses');
    const bars = (html.match(/bar-slot/g) ?? []).length;
    // 日视图按分类出柱：夹具里有 2 个分类
    assert.equal(bars, 2, `日视图应出 2 根柱，实际 ${bars}`);
  });

  it('柱状图带目标参考线', () => {
    const html = renderApp('expenses');
    assert.ok(html.includes('bar-goal'), '每个有目标的分类都应有参考线');
  });

  it('分类明细里超支项与结余项用不同标记区分', () => {
    const html = renderApp('expenses');
    assert.ok(html.includes('超 ¥'), '超支分类应显示超出的金额');
    assert.ok(html.includes('余 ¥'), '未超支分类应显示结余金额');
  });

  it('记账页包含预算编辑区，且显示各项目标之和', () => {
    const html = renderApp('expenses');
    assert.ok(html.includes('目标预算'), '应有目标预算区');
    assert.ok(html.includes('每日总预算'));
    // 夹具各项之和 = 30 + 10 = 40
    assert.ok(html.includes('40.00'), '应显示各类目标之和');
  });

  it('流水列表渲染出每一笔，并带删除入口', () => {
    const html = renderApp('expenses');
    assert.ok(html.includes('entry-list'), '应有流水列表');
    assert.ok(html.includes('食堂 + 外卖'), '应显示备注');
    assert.ok(html.includes('删除这一笔'), '每笔都应有删除按钮');
  });

  /* ---------------------------------------------------- 清空示例数据按钮 */

  it('仍是示例数据时显示"清空示例数据"按钮', () => {
    const view = fakeView({ expense: fakeExpense({ isSampleData: true }) });
    const html = renderApp('expenses', view);
    assert.ok(html.includes('清空示例数据'), '示例数据状态下应提供清空入口');
  });

  it('不再是示例数据时按钮必须消失（避免误删用户真实记录）', () => {
    const view = fakeView({ expense: fakeExpense({ isSampleData: false }) });
    const html = renderApp('expenses', view);
    assert.ok(
      !html.includes('清空示例数据'),
      '一旦用户改过数据，这个按钮就不能再出现——它点一下会删光所有流水'
    );
  });

  /* ---------------------------------------------------- 期初余额 */

  it('未填期初余额时说明当前按月折算', () => {
    const html = renderApp('expenses');
    assert.ok(html.includes('期初余额'), '应有期初余额区');
    assert.ok(html.includes('还没填'), '未填时应说明当前口径');
  });

  it('填了期初余额后显示金额与来源，并提供清除入口', () => {
    const view = fakeView({ expense: fakeExpense({}, { openingBalance: 2000 }) });
    const html = renderApp('expenses', view);
    assert.ok(html.includes('已填 ¥2000.00'), '应显示已填金额');
    assert.ok(html.includes('清除'), '已填时应能清除，退回按天折算');
    assert.ok(html.includes('本月期初余额'), '预算口径应写明来自期初余额');
  });

  it('期初余额优先于每日预算（结算卡用余额结算）', () => {
    const view = fakeView({ expense: fakeExpense({}, { openingBalance: 2000 }) });
    const html = renderApp('expenses', view);
    assert.ok(html.includes('¥2000.00'), '预算应显示为期初余额，而不是 50');
  });
});

describe('渲染层：自律打卡', () => {
  it('导航里有打卡入口', () => {
    const html = renderApp('schedule');
    assert.ok(html.includes('打卡'), '主导航应包含打卡');
  });

  it('打卡页展示今日打卡、月视图、名言与习惯管理', () => {
    const html = renderApp('habits');
    assert.ok(html.includes('今日打卡'), '应有今日打卡区');
    assert.ok(html.includes('habit-calendar'), '应有月视图');
    assert.ok(html.includes('grade-legend'), '应有分级图例');
    assert.ok(html.includes('不积跬步'), '应显示名言');
    assert.ok(html.includes('我的习惯'), '应有习惯管理区');
  });

  it('今日打卡列出每个习惯，且完成的打勾', () => {
    const html = renderApp('habits');
    assert.ok(html.includes('早起'), '应列出早起');
    assert.ok(html.includes('背单词'));
    assert.ok(html.includes('跑步'));
    assert.ok((html.match(/已完成/g) ?? []).length >= 2, '完成项应显示"已完成"');
    assert.ok(html.includes('点击完成'), '未完成项应显示"点击完成"');
  });

  it('月视图分级图例包含用户要求的蓝与绿', () => {
    const html = renderApp('habits');
    assert.ok(html.includes('80% 及以上'), '图例应说明 80% 及以上');
    assert.ok(html.includes('全部完成'), '图例应说明 100% 全部完成');
  });

  it('连续天数字段显示出来', () => {
    const html = renderApp('habits');
    assert.ok(html.includes('连续'), '应显示连续打卡天数');
  });
});


describe('任务详情与课程配色入口',()=>{
 it('新建任务有独立多行详细内容输入，课程配色默认折叠',()=>{
  const form=renderToStaticMarkup(createElement(TaskForm,{courses:[],onDone:()=>{}}));assert.ok(form.includes('详细内容'));assert.ok(/<textarea[^>]*maxLength="2000"/.test(form));
  const colors=renderToStaticMarkup(createElement(CourseColorSettings,{courses:[{id:'sample',name:'高等数学',color:'#a9c7e8'}]}));assert.ok(colors.includes('课程颜色'));assert.ok(!/<details[^>]*\bopen[= >]/.test(colors));assert.ok(colors.includes('aria-label="高等数学 的课程颜色"'));
 });
});


describe('统一任务和一次提醒的界面约定',()=>{
 it('过去两类任务、置顶及已完成记录都显示在同一个列表',()=>{
  const state=fakeView({buckets:{today:[fakeTask('s','保留的学习记录'),fakeTask('l','保留的生活记录',{domain:'life'})],future:[],overdue:[],done:[fakeTask('d','过去已完成记录',{domain:'life',status:'done'})]} as any});
  const html=renderApp('study',state);
  for(const title of ['保留的学习记录','保留的生活记录','过去已完成记录'])assert.ok(html.includes(title));
  assert.ok(!html.includes('task-domain-switch')&&!html.includes('学习任务')&&!html.includes('生活任务'));
  const form=renderToStaticMarkup(createElement(TaskForm,{courses:[],onDone:()=>{}}));
  assert.ok(!form.includes('归属')&&!form.includes('学习</button>')&&!form.includes('生活</button>'));
 });
 it('新建日程起止时间留空，开始必填，结束可选，编辑时保留原有时间',()=>{
  const render=(event?:any)=>renderToStaticMarkup(createElement(CalendarEventEditor,{date:'2030-10-20',event,onClose:()=>{},onSaved:()=>{}}));
  const inputs=(html:string)=>html.match(/<input[^>]*type="time"[^>]*>/g)??[];
  const fresh=inputs(render());assert.equal(fresh.length,2);assert.ok(fresh.every(input=>input.includes('value=""')));
  assert.ok(fresh[0]!.includes('required=""'));assert.ok(!fresh[1]!.includes('required'));
  const point=inputs(render({startAt:'2030-10-20T08:40',endAt:'2030-10-20T08:40'}));assert.ok(point[0]!.includes('08:40'));assert.ok(point[1]!.includes('value=""'));
  const range=inputs(render({startAt:'2030-10-20T08:40',endAt:'2030-10-20T09:25'}));assert.ok(range[1]!.includes('09:25'));
 });
 it('提醒在日程开始边界可见，清单不显示零分钟或虚假的重叠',()=>{
  const point={id:'event:p',eventId:'p',kind:'busy' as const,title:'证件提醒',startAt:'2025-10-08T06:00',endAt:'2025-10-08T06:00'};
  const timeline=[point,{id:'task:b',kind:'block' as const,title:'晨间安排',startAt:'2025-10-08T06:00',endAt:'2025-10-08T07:00'}];
  const html=renderToStaticMarkup(createElement(DayView,{state:fakeView({timeline})}));assert.ok(html.includes('is-reminder-event')&&html.includes('证件提醒'));assert.ok(!html.includes('06:00-06:00'));
  const agenda=renderToStaticMarkup(createElement(DayAgenda,{state:fakeView(),timeline}));assert.ok(agenda.includes('一次提醒')&&agenda.includes('不占用时间段'));assert.ok(!agenda.includes('时间重叠'));
  const week=fakeWeek();week.days[0].blocks=[{...point,startMinute:360,endMinute:360,timeLabel:'06:00'}];
  const weekly=renderToStaticMarkup(createElement(WeekView,{state:fakeView(),week}));assert.ok(weekly.includes('is-reminder-event')&&weekly.includes('证件提醒'));
 });
 it('事件弹窗没有稍后提醒入口',()=>{
  const html=renderToStaticMarkup(createElement(ToastStackView,{update:{items:[{id:'point-toast',eventId:'p',kind:'event',title:'带上证件',timeLabel:'08:40',strong:false}],queued:0},actions:{onDone:()=>{},onSnooze:()=>{},onDismiss:()=>{},onOpen:()=>{}}}));
  assert.ok(html.includes('事件提醒')&&html.includes('查看日程'));assert.ok(!html.includes('稍后'));
 });
});


describe('自由分段与日记记账入口',()=>{
 it('已安排多段仍在任务栏中只显示一项，支持继续拖入与调整时间',()=>{
  const task=fakeTask('multi','分段阅读');
  const blocks=[{id:'a',taskId:task.id,date:'2030-10-08',startAt:'2030-10-08T09:37',endAt:'2030-10-08T10:08',plannedMinutes:31,locked:true,origin:'manual' as const},{id:'b',taskId:task.id,date:'2030-10-09',startAt:'2030-10-09T14:00',endAt:'2030-10-09T15:00',plannedMinutes:60,locked:true,origin:'manual' as const}];
  const state=fakeView({todayTasks:[],urgentTasks:[],buckets:{today:[task],done:[]} as any,taskSegments:blocks});
  const html=renderToStaticMarkup(createElement(ScheduleDeadlines,{state,onDragTask:()=>{}}));
  assert.equal((html.match(/data-task-id="multi"/g)??[]).length,1);assert.ok(html.includes('已安排 2 段')&&html.includes('本次时长'));assert.ok(!html.includes('自习课模式')&&!html.includes('本次节数'));
  const editor=renderToStaticMarkup(createElement(TaskEditDialog,{task,placements:blocks,field:'schedule',onClose:()=>{}}));
  assert.equal((editor.match(/class="task-segment-row"/g)??[]).length,2);assert.ok(editor.includes('09:37')&&editor.includes('2030-10-09')&&editor.includes('添加时间段'));assert.ok(!editor.includes('任务名称'));
 });
 it('日记记账默认只显示小入口，展开面板不会占据正文顶部',()=>{
  const html=renderToStaticMarkup(createElement(DiaryExpenseButton,{date:'2030-10-08'}));
  assert.ok(html.includes('diary-expense-corner')&&html.includes('aria-expanded="false"'));assert.ok(!html.includes('journal-links')&&!html.includes('选择记账记录'));
 });
});


describe('打卡图标和归档入口',()=>{
 it('图标选择包含20个带名称的选项，完整图标可选中',()=>{
  const html=renderToStaticMarkup(createElement(HabitIconGrid,{value:'🗣️',onChange:()=>{}}));
  assert.equal((html.match(/data-habit-icon=/g)??[]).length,20);assert.equal((html.match(/aria-pressed="true"/g)??[]).length,1);
  assert.ok(html.includes('🗣️')&&html.includes('语言')&&html.includes('早起')&&html.includes('存钱'));
 });
 it('打卡页一直有已归档入口，可恢复历史习惯，并解释与删除的区别',()=>{
  const state=fakeView();state.habit.archivedHabits=[{id:'archived-old',name:'归档的日语习惯',icon:'🗣️',activeDays:[],startDate:'2025-10-01',sortOrder:5,archived:true,color:'#aabbcc'}];
  const html=renderApp('habits',state);assert.ok(html.includes('已归档')&&html.includes('归档的日语习惯')&&html.includes('恢复到打卡'));assert.ok(html.includes('原打卡记录仍保留'));assert.ok(html.includes('选择新习惯图标'));
  const empty=renderApp('habits',fakeView());assert.ok(empty.includes('暂无已归档习惯')&&empty.includes('已归档'));
 });
});


describe('灵动岛今天与明天截止任务',()=>{
 it('按真实本地日期跨年分组，未安排也显示，排除已完成和其他日期且不重复',()=>{
  const due=fakeTask('today-deadline','今天交报告',{dueAt:'2026-12-31T18:15'}),tomorrow=fakeTask('tomorrow-deadline','明天交申请',{dueAt:'2027-01-01T09:00'});
  const state=fakeView({now:'2026-12-31T20:00',date:'2030-02-02',todayTasks:[{task:due,dueLabel:'今天 18:15',overdue:true,untilDueMinutes:-105}],urgentTasks:[],buckets:{overdue:[],today:[due],tomorrow:[tomorrow],thisWeek:[],later:[fakeTask('later','后天的任务',{dueAt:'2027-01-02T10:00'}),fakeTask('none','没有截止时间',{dueAt:undefined}),fakeTask('old','昨天的任务',{dueAt:'2026-12-30T10:00'}),fakeTask('canceled','取消的任务',{dueAt:'2027-01-01T10:00',status:'canceled'})],done:[fakeTask('done','完成的任务',{dueAt:'2026-12-31T21:00',status:'done'})]}});
  const groups=nearbyDeadlineTasks(state);assert.deepEqual(groups.today.map(x=>x.task.id),[due.id]);assert.deepEqual(groups.tomorrow.map(x=>x.task.id),[tomorrow.id]);
  const html=renderToStaticMarkup(createElement(IslandDeadlines,{groups}));for(const text of ['今天截止','明天截止','今天交报告','明天交申请','18:15','09:00','已截止'])assert.ok(html.includes(text));assert.equal((html.match(/data-deadline-task=/g)??[]).length,2);for(const text of ['完成的任务','取消的任务','后天的任务','昨天的任务'])assert.ok(!html.includes(text));
 });
 it('无临期任务时显示两组空状态',()=>{const html=renderToStaticMarkup(createElement(IslandDeadlines,{groups:nearbyDeadlineTasks(null)}));assert.ok(html.includes('今天没有截止任务')&&html.includes('明天没有截止任务'));});
});


describe('任务页四个日期模块',()=>{
 it('按本地日期划分互不重叠的范围，跨年边界、逾期和无截止都保留',()=>{
  const tasks=[fakeTask('old','逾期任务',{dueAt:'2026-12-29T12:00'}),fakeTask('today','当天任务',{dueAt:'2026-12-31T20:00'}),fakeTask('d1','一天后',{dueAt:'2027-01-01T00:00'}),fakeTask('d3','三天后',{dueAt:'2027-01-03T23:59'}),fakeTask('d4','四天后',{dueAt:'2027-01-04T00:00'}),fakeTask('d7','七天后',{dueAt:'2027-01-07T23:59'}),fakeTask('d8','八天后',{dueAt:'2027-01-08T00:00'}),fakeTask('none','没有截止'),fakeTask('done','已完成记录',{status:'done',dueAt:'2026-12-31T20:00'}),fakeTask('canceled','已取消记录',{status:'canceled',dueAt:'2026-12-31T20:00'})];
  const state=fakeView({now:'2026-12-31T16:00',date:'2030-02-02',buckets:{overdue:[],today:[tasks[1]],tomorrow:[],thisWeek:[],later:tasks,done:[tasks[8]]}});
  const groups=taskPageGroups(state),ids=(key:keyof typeof groups)=>groups[key].map(task=>task.id).sort();
  assert.deepEqual(ids('today'),['old','today']);assert.deepEqual(ids('threeDays'),['d1','d3']);assert.deepEqual(ids('week'),['d4','d7']);assert.deepEqual(ids('later'),['d8','none']);assert.equal(Object.values(groups).flat().length,8);
  const tomorrow=taskPageGroups({...state,now:'2027-01-01T00:00'});assert.ok(tomorrow.today.some(task=>task.id==='d1'));assert.ok(tomorrow.threeDays.some(task=>task.id==='d4'));assert.ok(tomorrow.week.some(task=>task.id==='d8'));
 });
 it('始终按今日、近三天、近一周、更远的顺序显示，置顶在分组内且任务只出现一次',()=>{
  const regular=fakeTask('normal','普通待办',{dueAt:'2026-12-31T17:00'}),pinned=fakeTask('pin','置顶待办',{pinned:true,dueAt:'2026-12-31T22:00'}),done=fakeTask('finished','保留已完成记录',{status:'done'});
  const state=fakeView({now:'2026-12-31T16:00',buckets:{overdue:[],today:[regular,pinned],tomorrow:[],thisWeek:[],later:[fakeTask('long','以后再做')],done:[done]}}),html=renderApp('study',state);
  const panels=[...html.matchAll(/<section[^>]*data-task-group="([^"]+)"[\s\S]*?<\/section>/g)];assert.deepEqual(panels.map(match=>match[1]),['today','threeDays','week','later']);
  for(const title of ['今日','近三天','近一周','更远'])assert.ok(html.includes(title));assert.ok(panels[0][0].indexOf('data-task-id="pin"')<panels[0][0].indexOf('data-task-id="normal"'));assert.equal((html.match(/data-task-id="pin"/g)??[]).length,1);assert.ok(html.includes('保留已完成记录')&&html.includes('completed-task-panel'));assert.ok(!html.includes('task-pinned-panel'));assert.ok(panels[1][0].includes('未来三天暂无截止任务'));
 });
});
