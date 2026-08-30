// ============================================================================
// 解读文稿 · 提示词构建与轻量 markdown 渲染
// ============================================================================

export const READER_SYSTEM = `你是一位深谙韦特塔罗（Rider-Waite-Smith）传统的资深塔罗师，主持一次正式占卜。
你将收到：求问者的问题、所选牌阵及每个牌位的传统语义、以及已抽出的每张牌的正/逆位与传统牌义。

解读铁律：
- 一切解读必须严格建立在所提供给你的传统牌义与牌位语义之上，不得虚构牌义、牌位或牌面内容。
- 将传统牌义与问题语境结合，给出具体、诚实、有洞察的解读；牌面所示之挑战应直言，不迎合、不空泛。
- 多张牌之间要彼此呼应：找出主题、冲突、时间线与转折。
- 涉及健康、法律、财务等议题时，明确说明塔罗是心灵层面的参照，不能替代专业意见。
- 结尾给出具体可执行的建议。
- 全程使用简体中文；不得使用任何 emoji；语气沉静、专业、有仪式感。

输出结构（markdown）：
### 牌阵总览
（两三句：整体氛围、主导元素与核心张力）
### 逐位解读
（按牌位顺序，每张牌以「**牌位名 · 牌名（正位/逆位）**」起头，先述牌义如何落于牌位，再连回问题）
### 综合信息
（牌与牌之间的呼应与冲突、整体脉络与关键转折）
### 建议
（不超过三条，具体可行动，每条一行）`;

export function buildReadingMessages({ question, spread, placed, note }) {
  const lines = [];
  lines.push(`【求问者的问题】${question || '（未言明，求问者愿牌语直指当下最需要看见之事）'}`);
  lines.push(`【牌阵】${spread.zh}（${spread.en}）共 ${spread.count} 张`);
  lines.push(`【牌位语义】${spread.desc}`);
  lines.push('【抽牌结果】');
  placed.forEach((p, i) => {
    const c = p.card;
    lines.push(`${i + 1}. 牌位「${p.slot.label}」（${p.slot.hint}）：${c.zh} / ${c.en}${p.reversed ? '【逆位】' : '【正位】'}`);
    lines.push(`   传统牌义：正位关键词 ${c.k_up}；逆位关键词 ${c.k_rev}`);
    lines.push(`   正位：${c.up}`);
    lines.push(`   逆位：${c.rev}`);
    lines.push(`   牌面意象（韦特图像志）：${c.sym || '—'}；对应：${c.astro || '—'}`);
  });
  if (note) lines.push(`【补充说明】${note}`);
  lines.push('请依上述铁律，给出完整的正式解读。');
  return [
    { role: 'system', content: READER_SYSTEM },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function buildIdentifyMessages(dataUrl) {
  return [
    {
      role: 'system',
      content: '你是塔罗牌鉴定专家。用户会给出一张实拍塔罗牌照片。请识别牌名与正逆位，只输出一个 JSON 对象，格式：{"en":"标准英文名","zh":"标准中文名","reversed":false,"confidence":0.0}。牌名使用韦特（Rider-Waite-Smith）体系 78 张的标准名称，例如 "The Fool"、"Ten of Cups"、"Queen of Swords"；牌面文字上下颠倒时 reversed 为 true。若照片中不是一张可辨认的塔罗牌，只输出 {"en":null,"zh":null,"reversed":false,"confidence":0}。不要输出任何其他文字。',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: '这是求问者亲手抽出的塔罗牌实拍照片，请识别。' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

// ---- 轻量 markdown（标题/加粗/列表/段落） ---------------------------------------
export function mdToHtml(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } };
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const level = Math.min(h[1].length + 2, 5);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.、]\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
  function inline(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/「([^」]*)」/g, '「<span class="q">$1</span>」');
    return s;
  }
}
