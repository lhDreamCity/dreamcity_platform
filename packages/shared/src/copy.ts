/**
 * 平台文案（唯一来源）
 *
 * 合规口径（硬约束 C1）：对外表述只走「AI 素养 / 科技素养」，
 * 避开学科类培训表述。全部文案集中在这里，
 * `tools/check-constraints` 的 C1 检查只扫这一个文件 + 三端源码。
 *
 * 另外两条相关红线：
 *  - C12 错误反馈不用红叉，儿童产品只给正向引导
 *  - C8  学生端不出现任何量化人气数字
 */

/** ❌ 禁止出现在任何对外文案里的词（C1）。改文案前先看这张表。 */
export const FORBIDDEN_COPY = [
  '提分',
  '补课',
  '学科辅导',
  '学科培训',
  '辅导班',
  '奥数',
  '同步辅导',
  '刷题',
  '押题',
  '升学班',
] as const;

/* ── 品牌 ──────────────────────────────────────────────────── */

export const BRAND = {
  company: '深圳领航梦之城科技有限公司',
  alias: '梦之城 AI 赋能中心',
  product: '梦之城综合教学平台',
  tagline: '让每个孩子成为 AI 的驾驶员——握得住方向盘，也懂得踩刹车。',
  /** 对外合规表述 */
  positioning: '中小学 AI 素养与科技素养 · 线下 90 分钟课堂',
  mascot: '小梦',
} as const;

/* ── 三端通用 ──────────────────────────────────────────────── */

export const COMMON = {
  loading: '正在准备…',
  empty: '这里还什么都没有，上完课就会有了',
  retry: '再试一次',
  back: '返回',
  cancel: '取消',
  confirm: '确定',
  save: '保存',
  cancelChanges: '放弃修改',
  /** 未定稿的商业数据一律显式占位，不编造（C13） */
  pending: '待定',
  notSetYet: '待定 · 尚未定稿',
  networkLost: '网络断了，已存在本机，恢复后会自动补传',
  networkRestored: '网络恢复，正在补传',
  close: '关闭',
  more: '更多',
} as const;

/* ── 讲师端 ────────────────────────────────────────────────── */

export const TEACHER = {
  loginTitle: '后台登录',
  loginSubtitle: '梦之城 · 课堂操作系统',
  /** 账号可以是邮箱，也可以是账号名 —— 服务端两种都认 */
  usernamePlaceholder: '账号',
  passwordPlaceholder: '密码',
  login: '登录',
  logout: '退出',
  nav: {
    lessons: '课次库',
    plan: '备课编排',
    plugins: '插件库',
    sessions: '上课记录',
    students: '学员名册',
    help: '备课帮助',
  },
  lessonsTitle: '课次库',
  lessonsSubtitle: '48 节课已入库。按级别筛选，点进一节开始编排。',
  levelAll: '全部级别',
  openPlan: '编排这节课',
  planTitle: '备课编排',
  planSubtitle: '拖模式卡排 90 分钟。时长、插件、课件页都能改。',
  recipeLabel: '课型配方',
  phaseLabel: '环节',
  modeLabel: '模式卡',
  atomLabel: '交互原子',
  durationLabel: '时长（分钟）',
  pluginLabel: '插件',
  resourceLabel: '课件页',
  addActivity: '加一个环节',
  removeActivity: '移除',
  savePlan: '保存编排',
  savedPlan: '已保存',
  openClass: '开课',
  openClassSubtitle: '点开课后生成 6 位课堂码，学生扫码即可进入。',
  classCodeLabel: '课堂码',
  cockpitTitle: '上课驾驶舱',
  timeline: '90 分钟时间轴',
  projector: '投屏 / 控制',
  roster: '名单与采集',
  planned: '计划',
  actual: '实耗',
  current: '进行中',
  nextUp: '下一环节',
  offlineFallback: '断网兜底',
  captureDone: '完成',
  captureStuck: '卡住',
  captureAsked: '已单独问过',
  captureHint: '点一下就好，时间和环节会自动记上。',
  askedAlready: '已单独问过',
  notAskedYet: '本节还没单独问过',
  launchActivity: '拉起',
  fullscreen: '全屏',
  closeClass: '结课',
  closeClassConfirm: '结课后课堂码立刻失效，产出自动归档。要现在结课吗？',
  summaryTitle: '结课摘要',
  summaryGenerated: '摘要已生成，确认后发给家长。',
  confirmAndSend: '确认并发送',
  sessionsTitle: '上课记录',
  sessionsSubtitle: '每一次真实上课都指向当时的教案版本快照。',

  /* ── 名单点名 ─────────────────────────────────────────── */
  addStudent: '加一个学员',
  addStudentHint: '从名册里挑。上课前的名单由你点名确定。',
  pickStudent: '挑一个孩子',
  addedStudent: '已加入本班',
  removedStudent: '已移出本班',
  removeStudent: '移出',
  studentsTitle: '学员名册',
  studentsSubtitle: '家长端添加孩子后，这里就会出现。',
  studentsEmpty: '还没有学员。家长在家长端添加孩子后，这里会自动出现。',
  searchStudents: '搜名字、家长或手机号后四位',
  guardianOf: '家长',
  notInAnyClass: '还没进过班',
  inClass: '在班',
} as const;

/* ── 家长端 ────────────────────────────────────────────────── */

export const GUARDIAN = {
  loginTitle: '家长登录',
  loginSubtitle: '用报名时留的手机号登录',
  phonePlaceholder: '手机号',
  codePlaceholder: '验证码',
  sendCode: '获取验证码',
  resendIn: '秒后重发',
  login: '登录',
  logout: '退出',
  timelineTitle: '孩子的课堂时间线',
  timelineSubtitle: '按最新一节课倒序。每一件都是孩子真的做出来的东西。',
  teacherComment: '老师点评',
  progress: '比上次进步',
  remaining: '剩余课时',
  noCommentYet: '老师还没写点评',
  profileTitle: '成长档案',
  badgeTitle: '获得的徽章',
  feedbackTitle: '课堂反馈',
  everyFourLessons: '每 4 节课一条反馈',
  grantsTitle: '可见范围与授权',
  grantsSubtitle: '默认只有你和老师能看到。可以随时收回。',
  grantL1: '给同班同学和家长看',
  grantL2: '给往期和往后的同学和家长看',
  grantL3: '生成对外分享链接',
  grantL1Desc: '报名时的一次授权，用于同伴互评和当期作品墙。',
  grantL2Desc: '需要单独同意。往期作品会当作「虚拟同伴」给学弟学妹看。',
  grantL3Desc: '逐件单独授权，带水印，可随时撤回。用于招生与转发。',
  revoked: '已撤回',
  revoke: '撤回',
  granted: '已开启',
  grant: '开启',
  notesTitle: '孩子收到的留言',
  notesSubtitle: '只有三类正向留言，没有打分，没有评论。',
  exportTitle: '导出孩子的全部数据',
  exportDesc: '作品、评语、留言、授权记录，一份文件带走。',
  export: '导出',
  deleteTitle: '注销账号',
  deleteDesc: '账号不因结业注销。若要注销，请联系机构并由监护人确认。',
  deleteRequest: '申请注销',
  /** 家长看的是「我的孩子」，不是功能宫格 */
  childSwitch: '切换孩子',

  /* ── 添加孩子（监护人完成注册）─────────────────────────── */
  addChildTitle: '添加孩子',
  addChildSubtitle: '填个昵称就好，不用写真实姓名。',
  addChildName: '孩子的昵称',
  addChildNameHint: '最多 10 个字',
  addChildGrade: '年级',
  addChildAvatar: '挑个头像',
  addChildConsentTitle: '监护人知情同意',
  addChildConsentSubtitle: '以下每一项都可以随时撤回。不同意也能上课，只是不公开。',
  addChildSubmit: '添加',
  addChildCancel: '取消',
  consentWall: '作品上墙',
  consentWallDesc: '孩子的作品可以放在班级的作品墙上，同班同学和家长能看到。',
  consentMedia: '影像与照片',
  consentMediaDesc: '课堂照片与视频可以用于机构内部的学习记录。不用于对外宣传。',
  consentData: '学习数据',
  consentDataDesc: '课堂表现、测评结果、作品与评语会被记录下来，用来生成成长档案。',
  consentCrossTerm: '跨期互评',
  consentCrossTermDesc: '往期学员可以看到孩子的作品并留一句话。仅在监护人单独同意时开启。',
  addChildDone: '加好了',
  addChildDoneHint: 'ta 已经有一个自己的展位了。上课时用课堂码就能进来。',
  noChildrenTitle: '还没有添加孩子',
  noChildrenHint: '添加孩子后，上课时的课堂码就能用上，作品也会自动进成长档案。',
} as const;

/* ── 学生端 ────────────────────────────────────────────────── */

export const STUDENT = {
  enterTitle: '输入课堂码',
  enterSubtitle: '问老师要今天的 6 位数字',
  codePlaceholder: '6 位数字',
  enter: '进入',
  pickTitle: '你是谁？',
  pickSubtitle: '点一下你的头像就行，不用记密码',
  confirmIdentity: '我是这个',
  sessionTitle: '今天的课',
  activitiesTitle: '要一起做的事',
  launch: '开始',
  submit: '交上去',
  submitted: '交好啦！',
  submittedHint: '去我的展位看看吧',
  showcaseTitle: '我的展位',
  showcaseSubtitle: '每个同学都有一份，按时间排，不分好坏。',
  notesTitle: '留给同伴的话',
  notesHint: '只能选下面三种写法',
  noteTypes: ['注意到', '喜欢', '想问'] as const,
  notePlaceholder: '写一句你的话',
  noteSend: '送出去',
  noteSent: '送到了',
  /** C8：不显示任何数字，所以这里没有「有多少人看过」 */
  viewedBy: '看过这里的人',
  /** C12：正向引导，不用红叉 */
  tryAgain: '再试一次，你可以的',
  needHelp: '需要帮忙的话，举手叫老师',
  noWorkYet: '第一节课的作品还没做好，等你哦',

  /* ── 当堂进入的引导 ──────────────────────────────────── */
  notOnListTitle: '今天这节课你还没被排进来',
  notOnListHint: '这不是你的问题 —— 让老师把你加进这节课，再试一次就行。',
  notOnListAskTeacher: '跟老师说一声：我今天来上课',
  rosterEmptyTitle: '这节课老师还在点名',
  rosterEmptyHint: '等老师把你加进来，页面会自动出现你的名字。',
} as const;

/* ── 展位 / 被看见 ─────────────────────────────────────────── */

export const SHOWCASE = {
  title: '作品展位',
  wallTitle: '本期作品墙',
  wallSubtitle: '同班同学做的，给他们留句话',
  itemTitle: '作品',
  leaveNote: '留句话',
  noteSent: '谢谢你的话',
  emptyWall: '作品墙还是空的，下节课就会有啦',
} as const;

/* ── 错误（正向引导，C12）─────────────────────────────────── */

export const ERRORS = {
  notFound: '没找到这个内容',
  notFoundHint: '它可能已经被收起来了',
  forbidden: '这个内容现在还看不到',
  forbiddenHint: '可以让老师帮你打开',
  network: '网络好像断了一下',
  networkHint: '已经帮你记下来了',
  codeInvalid: '这个课堂码好像不对',
  codeInvalidHint: '再问老师要一次吧',
  codeExpired: '这个课堂码已经用完了',
  codeExpiredHint: '下节课会有新的',
  generic: '出了点小状况',
  genericHint: '再试一次，不行就问老师',
} as const;
