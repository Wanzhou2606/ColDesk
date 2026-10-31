/**
 * 虚构示例课表，仅用于开发预览和自动化测试。
 * 课程、教师、班级与教室均为演示数据，不代表任何用户的真实安排。
 * 固定日期用于稳定验证周次、校区作息及分周场地；正式用户首次运行不导入示例。
 */

export interface SeedSession {
  weekday: number;
  startSlot: number;
  endSlot: number;
  /** 周次表达式，交给 parseWeekList 解析 */
  weekList: string;
  /** 示例原文的周次写法，保留以便核对 */
  weekPattern?: string;
  room?: string;
  note?: string;
  uncertain?: boolean;
  uncertainReason?: string;
}

export interface SeedCourse {
  key: string;
  name: string;
  teacher: string;
  room: string;
  color: string;
  campus: string;
  credit?: number;
  /** 教务系统里的教学班号，便于和学校系统对照 */
  classNo?: string;
  sessions: SeedSession[];
}

export const SEED_SEMESTER = {
  id: 'sem_2026_1',
  name: '2026-2027 学年第 1 学期',
  /** 第 1 教学周周一 */
  startDate: '2026-09-07',
  totalWeeks: 20,
  className: 'DEMO-001',
  major: '示例专业'
};

const CAMPUS = '绍兴';

export const SEED_COURSES: SeedCourse[] = [
  {
    key: 'modern_history',
    name: '中国近现代史纲要',
    teacher: '林老师',
    room: '示例教学楼A101',
    color: '#4F7CFF',
    campus: CAMPUS,
    credit: 3.0,
    classNo: 'DEMO-001',
    sessions: [
      {
        weekday: 1,
        startSlot: 1,
        endSlot: 3,
        weekList: '2-6,9-17',
        weekPattern: '(1-3节)2-6周,9-17周'
      },
      {
        weekday: 1,
        startSlot: 1,
        endSlot: 3,
        weekList: '7-8',
        weekPattern: '(1-3节)7-8周',
        room: '课外实践不在教室'
      }
    ]
  },
  {
    key: 'linear_algebra',
    name: '线性代数',
    teacher: '周老师',
    room: '示例教学楼A201',
    color: '#12A594',
    campus: CAMPUS,
    credit: 3.0,
    classNo: 'DEMO-002',
    sessions: [
      { weekday: 1, startSlot: 6, endSlot: 8, weekList: '2-17', weekPattern: '(6-8节)2-17周' }
    ]
  },
  {
    key: 'calculus',
    name: '高等数学A1',
    teacher: '陈老师',
    room: '示例教学楼A301',
    color: '#0E8C7F',
    campus: CAMPUS,
    credit: 5.0,
    classNo: 'DEMO-003',
    sessions: [
      { weekday: 2, startSlot: 1, endSlot: 2, weekList: '2-17', weekPattern: '(1-2节)2-17周' },
      { weekday: 4, startSlot: 10, endSlot: 12, weekList: '2-17', weekPattern: '(10-12节)2-17周' }
    ]
  },
  {
    key: 'college_english',
    name: '大学英语A',
    teacher: '李老师',
    room: '示例教学楼A401',
    color: '#E8A33D',
    campus: CAMPUS,
    credit: 3.0,
    classNo: 'DEMO-004',
    sessions: [
      { weekday: 2, startSlot: 3, endSlot: 4, weekList: '2-17', weekPattern: '(3-4节)2-17周' },
      {
        weekday: 4,
        startSlot: 6,
        endSlot: 7,
        weekList: '2-16',
        weekPattern: '(6-7节)2-16周(双)',
        room: '示例实训楼B101',
        note: '示例写"(双)"，此处按连续周次录入，待确认是否只上双周'
      }
    ]
  },
  {
    key: 'c_programming',
    name: 'C语言程序设计（甲）',
    teacher: '王老师',
    room: '示例教学楼A102',
    color: '#8B7BD8',
    campus: CAMPUS,
    credit: 3.0,
    classNo: 'DEMO-005',
    sessions: [
      { weekday: 3, startSlot: 1, endSlot: 3, weekList: '2-17', weekPattern: '(1-3节)2-17周' },
      {
        weekday: 2,
        startSlot: 10,
        endSlot: 12,
        weekList: '2-17',
        weekPattern: '(10-12节)2-17周',
        room: '示例教学楼A103'
      }
    ]
  },
  {
    key: 'situation_policy',
    name: '形势与政策1',
    teacher: '示例教师甲、示例教师乙',
    room: '示例教学楼A302',
    color: '#B0724E',
    campus: CAMPUS,
    credit: 0.25,
    classNo: 'DEMO-006',
    sessions: [
      { weekday: 3, startSlot: 6, endSlot: 7, weekList: '6-9', weekPattern: '(6-7节)6-9周' }
    ]
  },
  {
    key: 'psychology',
    name: '大学生心理健康教育1',
    teacher: '赵老师',
    room: '示例教学楼A303',
    color: '#E5537A',
    campus: CAMPUS,
    credit: 1.0,
    classNo: 'DEMO-007',
    sessions: [
      {
        weekday: 4,
        startSlot: 3,
        endSlot: 4,
        weekList: '2,6-8,12-16',
        weekPattern: '(3-4节)2周,6-8周(双),12-16周(双)'
      },
      {
        weekday: 4,
        startSlot: 3,
        endSlot: 4,
        weekList: '4,10',
        weekPattern: '(3-4节)4周,10周',
        room: '课外实践不在教室'
      }
    ]
  },
  {
    key: 'engineering_drawing',
    name: '工程制图',
    teacher: '示例教师丙、示例教师丁',
    room: '示例教学楼A202',
    color: '#4F7CFF',
    campus: CAMPUS,
    credit: 2.0,
    classNo: 'DEMO-008',
    sessions: [
      { weekday: 5, startSlot: 8, endSlot: 9, weekList: '2-17', weekPattern: '(8-9节)2-17周' }
    ]
  },
  {
    key: 'pe',
    name: '大学板块体育一（板块）',
    teacher: '',
    room: '',
    color: '#5AA469',
    campus: CAMPUS,
    credit: 1.0,
    sessions: [
      {
        weekday: 5,
        startSlot: 3,
        endSlot: 4,
        weekList: '2-17',
        note: '示例该格只有课名，节次/周次/场地/教师都没写，按合并单元格推断为周五 3-4 节',
        uncertain: true,
        uncertainReason: '原文缺节次与周次，节次由合并格跨度推断，周次暂按 2-17 周占位'
      }
    ]
  },
  {
    key: 'electronics_intro',
    name: '电子信息类学科导论',
    teacher: '吴老师',
    room: '示例教学楼A203',
    color: '#8B7BD8',
    campus: CAMPUS,
    credit: 1.0,
    classNo: 'DEMO-009',
    sessions: [
      { weekday: 6, startSlot: 1, endSlot: 4, weekList: '8-11', weekPattern: '(1-4节)8-11周' }
    ]
  }
];

/** 与示例课程关联的示例待办，用来演示"紧迫度 → 自动排程 → 提醒"这条链路 */
export const SEED_TASKS: Array<{
  title: string;
  courseKey: string;
  type: 'assignment' | 'experiment' | 'paper' | 'exam_prep' | 'todo';
  urgency: 1 | 2 | 3 | 4 | 5;
  dueInDays: number;
  dueTime: string;
  estMinutes: number;
  detail?: string;
}> = [
  {
    title: 'C语言实验报告（第 2 次）',
    courseKey: 'c_programming',
    type: 'experiment',
    urgency: 4,
    dueInDays: 2,
    dueTime: '18:00',
    estMinutes: 90,
    detail: '示例任务，可删除'
  },
  {
    title: '工程制图作业：三视图练习',
    courseKey: 'engineering_drawing',
    type: 'assignment',
    urgency: 5,
    dueInDays: 1,
    dueTime: '20:00',
    estMinutes: 60,
    detail: '示例任务，可删除'
  },
  {
    title: '高等数学 A1 习题册 2-3 章',
    courseKey: 'calculus',
    type: 'assignment',
    urgency: 3,
    dueInDays: 4,
    dueTime: '22:00',
    estMinutes: 120,
    detail: '示例任务，可删除'
  },
  {
    title: '线性代数期中复习',
    courseKey: 'linear_algebra',
    type: 'exam_prep',
    urgency: 4,
    dueInDays: 6,
    dueTime: '21:00',
    estMinutes: 150,
    detail: '示例任务，可删除'
  }
];

/**
 * 记账的默认分类与每日目标（元）。共 8 类。
 *
 * 取值思路：面向"在校、吃食堂、偶尔外食"的大学生日常。
 * 各项日目标之和 = 30+8+6+5+5+6+4+2 = 66，略低于每日总预算 70，
 * 故意留一点余量——否则任何一项轻微超出都会直接顶破总预算，
 * 让"总预算"失去预警意义（它应该是"整体还撑得住吗"的判断，而不是等价于各项之和）。
 *
 * 用户可自行改名、改额度、增删；这些只是首次运行的起点。
 */
export const SEED_EXPENSE_CATEGORIES: Array<{
  key: string;
  name: string;
  icon: string;
  color: string;
  dailyTarget: number;
}> = [
  { key: 'meal', name: '餐饮', icon: '🍚', color: '#F2994A', dailyTarget: 30 },
  { key: 'drink', name: '饮料零食', icon: '🧋', color: '#EB5757', dailyTarget: 8 },
  { key: 'transport', name: '交通', icon: '🚌', color: '#4F7CFF', dailyTarget: 6 },
  { key: 'daily', name: '日用品', icon: '🧻', color: '#12A594', dailyTarget: 5 },
  { key: 'study', name: '学习', icon: '📚', color: '#9B51E0', dailyTarget: 5 },
  { key: 'social', name: '社交聚餐', icon: '🍻', color: '#F2C94C', dailyTarget: 6 },
  { key: 'fun', name: '娱乐', icon: '🎮', color: '#56CCF2', dailyTarget: 4 },
  { key: 'other', name: '其它', icon: '📦', color: '#828282', dailyTarget: 2 }
];

/** 每日总预算（元）：各项目标之和为 66，这里留到 70 作为整体预警线 */
export const SEED_TOTAL_DAILY_BUDGET = 70;

/**
 * 示例流水（相对今天的偏移天数），让首次打开就能看到柱状图与结算长什么样。
 * 金额刻意做成有起伏，便于看出柱状图的差异；用户可一键清空。
 */
export const SEED_EXPENSE_ENTRIES: Array<{ dayOffset: number; categoryKey: string; amount: number; note: string }> = [
  { dayOffset: 0, categoryKey: 'meal', amount: 26.5, note: '食堂三餐' },
  { dayOffset: 0, categoryKey: 'drink', amount: 13, note: '奶茶' },
  { dayOffset: 0, categoryKey: 'transport', amount: 4, note: '公交' },
  { dayOffset: -1, categoryKey: 'meal', amount: 31, note: '食堂 + 外卖' },
  { dayOffset: -1, categoryKey: 'study', amount: 18, note: '实验报告打印' },
  { dayOffset: -2, categoryKey: 'meal', amount: 24, note: '食堂' },
  { dayOffset: -2, categoryKey: 'social', amount: 42, note: '同学聚餐' },
  { dayOffset: -3, categoryKey: 'meal', amount: 28.5, note: '食堂' },
  { dayOffset: -3, categoryKey: 'daily', amount: 12, note: '洗漱用品' },
  { dayOffset: -4, categoryKey: 'meal', amount: 22, note: '食堂' },
  { dayOffset: -4, categoryKey: 'fun', amount: 30, note: '电影' },
  { dayOffset: -5, categoryKey: 'meal', amount: 35, note: '食堂 + 夜宵' },
  { dayOffset: -5, categoryKey: 'drink', amount: 9, note: '咖啡' },
  { dayOffset: -6, categoryKey: 'meal', amount: 27, note: '食堂' },
  { dayOffset: -6, categoryKey: 'transport', amount: 16, note: '打车' }
];

/**
 * 示例流水的指纹（分类名|金额|备注），用于判断"当前流水是否还是那批示例数据"。
 *
 * 为什么用指纹而不是给表加标记字段：
 *   · 不需要改表结构
 *   · 用户一旦自己加过、改过、删过任何一笔，指纹立刻对不上，
 *     "清空示例数据"按钮就会自动消失——这正是需求要的行为，且不需要额外维护标志位
 *
 * 日期与 id 故意不参与比对：日期随安装时间变化（种子按"今天 − N 天"生成），
 * id 是随机生成的，两者都比不了。
 *
 * ⚠️ 排序方式必须与 repositories.expenseEntriesFingerprint 完全一致。
 * 那里同样用"字符串比较"排序，而不是交给 SQL 的 `ORDER BY amount`
 * （SQL 按数值排、JS 按字符串排，结果不同会导致指纹永远对不上）。
 *
 * 定义在 SEED_EXPENSE_ENTRIES 之后：它依赖那份数据，放前面会命中 TDZ 报错。
 */
export const SEED_EXPENSE_FINGERPRINT = SEED_EXPENSE_ENTRIES.map((entry) => {
  const category = SEED_EXPENSE_CATEGORIES.find((c) => c.key === entry.categoryKey);
  return `${category?.name ?? entry.categoryKey}|${entry.amount}|${entry.note}`;
})
  .sort()
  .join('\n');

/**
 * 打卡的示例习惯。
 *
 * 两条：一个每天、一个只有工作日（1~5），都是最常见的自律习惯形态。
 * startDate 由种子逻辑写成"今天"，因此过去的日子不会变成未完成——
 * 避免首次打开就给人"这个月已经欠了一堆债"的错觉。
 */
export const SEED_HABITS: Array<{
  key: string;
  name: string;
  icon: string;
  color: string;
  activeDays: number[];
}> = [
  { key: 'early_rise', name: '早起', icon: '🌅', color: '#F2994A', activeDays: [] },
  { key: 'words', name: '背单词', icon: '📖', color: '#4F7CFF', activeDays: [1, 2, 3, 4, 5] }
];
