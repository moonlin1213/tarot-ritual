// ============================================================================
// 牌阵库 · 经典传统牌阵
// 坐标系：以牌宽为 1 单位，y 向下为正；rot 为绕 z 的旋转（弧度）
// 位置语义均为该牌阵的传统定义。
// ============================================================================

export const SPREADS = [
  {
    id: 'single',
    zh: '每日一牌',
    en: 'One Card',
    count: 1,
    desc: '最古老的抽取方式：一个问题，一张牌，一个直指核心的回应。',
    bestFor: '日常指引、简明问题、聚焦单一事项',
    slots: [
      { x: 0, y: 0, rot: 0, label: '神谕', hint: '当下最需要看见的核心信息' },
    ],
    layout: { w: 2.2, h: 2.4 },
  },
  {
    id: 'three',
    zh: '时间之流',
    en: 'Three Card Spread',
    count: 3,
    desc: '以时间为轴的三张牌：过去之所来，现在之所立，未来之所往。',
    bestFor: '事情走向、时间线问题、简洁的整体脉络',
    slots: [
      { x: -1.55, y: 0, rot: 0, label: '过去', hint: '塑造现状的根源与来路' },
      { x: 0, y: 0, rot: 0, label: '现在', hint: '当下真实的状态与处境' },
      { x: 1.55, y: 0, rot: 0, label: '未来', hint: '现有轨迹的趋势与走向' },
    ],
    layout: { w: 5.4, h: 2.4 },
  },
  {
    id: 'relationship',
    zh: '双子连桥',
    en: 'Five Card Relationship Spread',
    count: 5,
    desc: '经典的关系牌阵：两端是你与对方，中央之桥呈现连接、考验与方向。',
    bestFor: '感情、亲密关系、合作与重要的人际连结',
    slots: [
      { x: -2.1, y: 0.35, rot: 0, label: '我', hint: '你在关系中的状态与位置' },
      { x: 2.1, y: 0.35, rot: 0, label: '对方', hint: '对方在关系中的状态与位置' },
      { x: 0, y: 1.35, rot: 0, label: '连结', hint: '关系的现状与深层纽带' },
      { x: -1.05, y: -1.35, rot: 0, label: '考验', hint: '关系需要面对的挑战' },
      { x: 1.05, y: -1.35, rot: 0, label: '方向', hint: '关系的走向与相处的指引' },
    ],
    layout: { w: 6.4, h: 4.4 },
  },
  {
    id: 'horseshoe',
    zh: '马蹄铁阵',
    en: 'Seven Card Horseshoe',
    count: 7,
    desc: '七张牌沿马蹄铁排布，自过去绕至结果，是传统中兼顾细节与全局的全面牌阵。',
    bestFor: '事业、财务、学业等现实议题的全面透视',
    slots: [
      { x: -2.7, y: 1.3, rot: -0.42, label: '过去', hint: '影响现状的过往因素' },
      { x: -1.8, y: -0.4, rot: -0.28, label: '现状', hint: '目前所处的境地' },
      { x: -0.9, y: -1.55, rot: -0.14, label: '隐匿', hint: '隐藏的影响与未见的因素' },
      { x: 0, y: -2.0, rot: 0, label: '阻碍', hint: '需要跨越的主要障碍' },
      { x: 0.9, y: -1.55, rot: 0.14, label: '环境', hint: '他人与外部环境的态势' },
      { x: 1.8, y: -0.4, rot: 0.28, label: '建议', hint: '此刻最有力的行动建议' },
      { x: 2.7, y: 1.3, rot: 0.42, label: '结果', hint: '顺势而为的最终走向' },
    ],
    layout: { w: 7.2, h: 5.6 },
  },
  {
    id: 'celtic',
    zh: '凯尔特十字',
    en: 'Celtic Cross',
    count: 10,
    desc: '传世最经典的牌阵：十字六牌呈现事之经纬，右侧四牌纵列为心灵阶梯。',
    bestFor: '重大抉择、复杂处境、值得郑重对待的问题',
    slots: [
      { x: 0, y: 0, rot: 0, label: '现状', hint: '问题的核心与当下处境' },
      { x: 0, y: 0, rot: Math.PI / 2, z: 0.06, label: '交叉', hint: '横亘眼前的挑战或助力' },
      { x: 0, y: 1.5, rot: 0, label: '根基', hint: '潜藏的根源与深层动因' },
      { x: -1.45, y: 0, rot: 0, label: '过往', hint: '正在退去的近期过去' },
      { x: 0, y: -1.5, rot: 0, label: '冠冕', hint: '意识层面的目标与理想' },
      { x: 1.45, y: 0, rot: 0, label: '将至', hint: '即将到来的临近未来' },
      { x: 2.9, y: 3.05, rot: 0, label: '自我', hint: '你自身的态度与状态' },
      { x: 2.9, y: 1.5, rot: 0, label: '环境', hint: '周围人与环境的影响' },
      { x: 2.9, y: -0.05, rot: 0, label: '心念', hint: '内在的希望与恐惧' },
      { x: 2.9, y: -1.6, rot: 0, label: '终局', hint: '所有因素汇成的结果' },
    ],
    layout: { w: 7.0, h: 7.4 },
  },
];

// ---------------------------------------------------------------------------
// 自动选阵：按问题语义归类，选择最契合的传统牌阵
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { key: 'love', re: /感情|恋爱|爱情|分手|复合|暗恋|表白|结婚|婚姻|伴侣|对象|喜欢我|暧昧|前任|桃花|脱单|相亲|异地恋|夫妻|男朋友|女朋友|爱人|关系/i },
  { key: 'decision', re: /选择|决定|要不要|该不该|还是|抉择|纠结|犹豫|去还是|留还是|买不买|做不做/i },
  { key: 'career', re: /工作|事业|职业|面试|升职|晋升|跳槽|辞职|创业|项目|同事|领导|老板|offer|转行|职场|绩效|实习/i },
  { key: 'wealth', re: /财|钱|投资|理财|收入|薪资|工资|债务|负债|生意|赚|亏损|股票|基金/i },
  { key: 'study', re: /考试|学业|论文|申校|考研|考公|高考|留学|面试官|复习|成绩|录取/i },
  { key: 'health', re: /健康|身体|疾病|手术|康复|体检|失眠|疲劳|痊愈/i },
  { key: 'daily', re: /今天|今日|日运|每日|最近运势|近期运势|今天运势/i },
];

export function classifyQuestion(q) {
  for (const c of CATEGORIES) {
    if (c.re.test(q)) return c.key;
  }
  return 'general';
}

export function autoSpread(question) {
  const cat = classifyQuestion(question);
  const byId = Object.fromEntries(SPREADS.map(s => [s.id, s]));
  switch (cat) {
    case 'love':
      return { spread: byId.relationship, reason: '问题指向情感的连结——关系牌阵能同时照见你与对方，以及这段连结本身。', category: cat };
    case 'decision':
      return { spread: byId.celtic, reason: '问题是一个需要郑重对待的抉择——凯尔特十字能在决定之前呈现完整的经纬。', category: cat };
    case 'career':
    case 'wealth':
    case 'study':
      return { spread: byId.horseshoe, reason: '问题关乎现实层面的经营——马蹄铁阵自过去至结果逐层展开，适合审视现实的布局。', category: cat };
    case 'health':
      return { spread: byId.horseshoe, reason: '关于身心的问题宜细致审视——马蹄铁阵会呈现现状、隐匿因素与建议。塔罗之见为心灵层面的参照，不能替代医疗诊断。', category: cat };
    case 'daily':
      return { spread: byId.single, reason: '日常的一问，一张牌的指引最是清澈有力。', category: cat };
    default:
      return { spread: byId.three, reason: '问题介于时间与事态之间——时间之流三牌足以勾勒来路与去向。', category: cat };
  }
}
