// ============================================================================
// 星轨塔罗圣仪 · 主编排
// ============================================================================
import { createStage } from './three/stage.js';
import { createRitual } from './three/cards3d.js';
import {
  DECK, byId, SPREADS, autoSpread,
  providerState, initProviderState, loadDsh, importDsh, allProviders, getProvider,
  addCustomProvider, removeCustomProvider, selectProvider, setModel,
  currentModel, fetchModels, chat,
  buildReadingMessages, buildIdentifyMessages, mdToHtml,
} from './core.js';
import { renderCardFace } from './art/cardface.js';

const $ = s => document.querySelector(s);
const CARD_W = 1.6, CARD_H = 2.8;

// ---- 全局状态 ---------------------------------------------------------------
const S = {
  phase: 'question',
  question: '',
  spread: null,
  spreadReason: '',
  autoMode: true,
  placed: [],          // { entry, card, reversed, slot }
  scale: 1,
  readingRaw: '',
  readingAbort: null,
  photoRows: [],       // { dataUrl, status, card, reversed }
  photoSpreadPicked: false,
};

// ---- 工具 -------------------------------------------------------------------
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.6s'; }, 3400);
  setTimeout(() => el.remove(), 4200);
}
function show(el, on) { el.classList.toggle('hidden', !on); }
function setPhase(p) {
  S.phase = p;
  show($('#phase-question'), p === 'question');
  show($('#phase-spread'), p === 'spread');
  show($('#photoPanel'), p === 'photo');
  show($('#ritualBar'), ['shuffle', 'select', 'reveal', 'reading'].includes(p));
}
function hint(text) { $('#ritualHint').textContent = text; }
function actions(...btns) {
  const box = $('#ritualActions');
  box.innerHTML = '';
  btns.filter(Boolean).forEach(b => box.appendChild(b));
}
function mkBtn(label, cls, fn) {
  const b = document.createElement('button');
  b.className = 'btn ' + cls;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// ---- 启动 --------------------------------------------------------------------
async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]); } catch { }

  initProviderState();
  const stage = createStage($('#stage'));
  window.__stage = stage;
  const ritual = createRitual(stage);
  window.__ritual = ritual;
  ritual.onSelect = handleCardClick;
  ritual.onEmptyClick = () => closeCardDetail();
  ritual.build(DECK);
  setTimeout(() => $('#veil').classList.add('lifted'), 400);
  setTimeout(() => ritual.intro(), 700);

  wireQuestion();
  wireSpread();
  wireReading();
  wireSettings();
  wirePhoto();
  refreshProviders();
}

// ---- Provider ----------------------------------------------------------------
function selectedProvider() {
  return getProvider(providerState.selectedId);
}

async function refreshProviders(imported = null) {
  const dsh = imported || await loadDsh().catch(() => ({ found: false, enabled: false, providers: [] }));
  const banner = $('#dshBanner');
  $('#dshConsentNote').textContent = dsh.oauthRefreshEnabled
    ? '本机已启用 Codex 自动续期：由 DSH 共享凭据管理器在需要时更新登录凭据。密钥不返回页面；失效的授权仍需在 DSH 中重新登录。'
    : '点击后授权本次服务只读导入本机 DSH 配置；页面不接收密钥，不改动 DSH 登录态。重启服务后可再次点击导入。';
  if (dsh.found && dsh.providers.length) {
    banner.classList.remove('hidden');
    const oauthN = dsh.providers.filter(p => p.oauth).length;
    banner.innerHTML = `已从 <b>DSH · DeepSeek Harness</b> 接引 ${dsh.providers.length} 位神谕（含 ${oauthN} 位 OAuth 登录态）。凭据不返回浏览器，仅发送至所选 AI 服务。`;
  } else {
    banner.classList.remove('hidden');
    banner.textContent = dsh.enabled === false ? '尚未导入 DSH。点击下方按钮，即可读取本机已有的 Provider，无需逐个填写。' : '本机未发现可用的 DSH Provider。请先在 DSH 中配置，再点击重新导入。';
  }
  // 默认选择：优先有模型的 DSH provider
  if (!providerState.selectedId || !getProvider(providerState.selectedId)) {
    const first = dsh.providers?.find(p => p.hasKey && p.models?.length) || dsh.providers?.[0];
    if (first) selectProvider(first.id, first.models?.[0] || null);
  }
  renderProviderList();
  updateOrb();
  $('#dshImportBtn').textContent = dsh.enabled ? '重新导入 DSH' : '导入本机 DSH';
  $('#dshImportBtn').disabled = false;
}

function renderProviderList() {
  const list = $('#providerList');
  list.innerHTML = '';
  for (const p of allProviders()) {
    const item = document.createElement('div');
    item.className = 'provider-item' + (p.id === providerState.selectedId ? ' selected' : '');
    const head = document.createElement('div');
    head.className = 'p-head';
    const tag = document.createElement('span');
    tag.className = 'p-tag' + (p.oauth ? ' oauth' : '');
    tag.textContent = p.oauth ? 'OAUTH' : (p.kind === 'anthropic' ? 'ANTHROPIC' : p.kind === 'responses' ? 'RESPONSES' : 'OPENAI');
    const name = document.createElement('span');
    name.className = 'p-name';
    name.textContent = p.label;
    const models = document.createElement('span');
    models.className = 'p-models';
    models.textContent = (p.models?.length ? p.models.length + ' 模型' : '待探测');
    head.append(tag, name, models);
    item.appendChild(head);
    if (p.source === 'DSH' || p.source === 'DSH OAuth') {
      const src = document.createElement('div');
      src.style.cssText = 'font-size:11px;color:rgba(181,171,147,.55);margin-top:4px;letter-spacing:.08em';
      src.textContent = (p.note ? p.note + ' · ' : '') + '经由 DSH 接引';
      item.appendChild(src);
    }
    if (p.id === providerState.selectedId) {
      const sel = document.createElement('select');
      const cur = currentModel(p.id);
      if (p.models?.length) {
        for (const m of p.models) {
          const o = document.createElement('option');
          o.value = m; o.textContent = m;
          if (m === cur) o.selected = true;
          sel.appendChild(o);
        }
        if (cur && !p.models.includes(cur)) {
          const manual = document.createElement('option');
          manual.value = cur; manual.textContent = cur; manual.selected = true;
          sel.appendChild(manual);
        }
        if (!cur && p.models[0]) setModel(p.id, p.models[0]);
      } else {
        const o = document.createElement('option');
        o.value = cur || ''; o.textContent = cur ? cur : '（点击探测模型列表）';
        sel.appendChild(o);
        sel.addEventListener('focus', async () => {
          if (sel.dataset.probing) return;
          sel.dataset.probing = '1';
          try {
            const ms = await fetchModels(p.id);
            if (ms.length) {
              p.models = ms;
              sel.innerHTML = '';
              for (const m of ms) {
                const oo = document.createElement('option');
                oo.value = m; oo.textContent = m;
                sel.appendChild(oo);
              }
              setModel(p.id, ms[0]);
              updateOrb();
              toast(`已探得 ${p.label} 的 ${ms.length} 个模型`);
            }
          } catch (e) { toast('模型探测失败：' + e.message, true); }
          sel.dataset.probing = '';
        });
      }
      sel.addEventListener('change', () => { setModel(p.id, sel.value); updateOrb(); });
      item.appendChild(sel);
      const manualModel = document.createElement('input');
      manualModel.placeholder = '手动填写模型 ID';
      manualModel.value = cur || '';
      manualModel.addEventListener('change', () => {
        const id = manualModel.value.trim();
        if (id) { setModel(p.id, id); renderProviderList(); updateOrb(); }
      });
      item.appendChild(manualModel);
    }
    if (p.id.startsWith('custom:')) {
      const rm = document.createElement('button');
      rm.className = 'p-remove';
      rm.textContent = '请离';
      rm.addEventListener('click', e => { e.stopPropagation(); removeCustomProvider(p.id); renderProviderList(); updateOrb(); });
      head.appendChild(rm);
    }
    item.addEventListener('click', e => {
      if (e.target.closest('select') || e.target.closest('option') || e.target.closest('button') || e.target.closest('input')) return;
      selectProvider(p.id, currentModel(p.id) || p.models?.[0] || null);
      renderProviderList();
      updateOrb();
    });
    list.appendChild(item);
  }
}

function updateOrb() {
  const p = selectedProvider();
  const dot = $('#orbDot');
  const label = $('#providerLabel');
  if (p) {
    dot.classList.add('lit');
    const m = currentModel(p.id);
    label.textContent = `${p.label}${m ? ' · ' + m : ''}`;
  } else {
    dot.classList.remove('lit');
    label.textContent = '神谕未连';
  }
}

function wireSettings() {
  $('#providerOrb').addEventListener('click', () => $('#settingsPanel').classList.toggle('open'));
  $('#settingsClose').addEventListener('click', () => $('#settingsPanel').classList.remove('open'));
  $('#dshImportBtn').addEventListener('click', async () => {
    const button = $('#dshImportBtn');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在导入…';
    try {
      const dsh = await importDsh();
      await refreshProviders(dsh);
      toast(dsh.providers.length ? `已导入 ${dsh.providers.length} 个 DSH Provider` : '尚未找到可用的 DSH Provider，请检查 DSH 配置。');
    } catch (error) {
      toast(error.message, true);
      button.textContent = '重试导入 DSH';
    } finally { button.disabled = false; }
  });
  $('#cpAdd').addEventListener('click', async () => {
    const label = $('#cpName').value.trim();
    const kind = $('#cpKind').value;
    const baseURL = $('#cpBase').value.trim().replace(/\/+$/, '');
    const apiKey = $('#cpKey').value.trim();
    if (!label || !baseURL || !apiKey) { toast('名号、Base URL 与 API Key 均需填写', true); return; }
    const p = addCustomProvider({ label, kind, baseURL, apiKey, models: [] });
    selectProvider('custom:' + p.id, null);
    renderProviderList(); updateOrb();
    $('#cpName').value = $('#cpBase').value = $('#cpKey').value = '';
    try {
      const ms = await fetchModels('custom:' + p.id);
      const stored = providerState.custom.find(c => c.id === p.id);
      if (stored) stored.models = ms;
      if (ms.length) setModel('custom:' + p.id, ms[0]);
      renderProviderList(); updateOrb();
      toast(`神谕已入议会：${label}${ms.length ? ' · ' + ms.length + ' 个模型' : ''}`);
    } catch (e) {
      toast(`已载入，但模型探测失败：${e.message}（可稍后在列表中重试）`, true);
    }
  });
}

// ---- 一 · 问询 -----------------------------------------------------------------
function wireQuestion() {
  $('#beginBtn').addEventListener('click', () => {
    S.question = $('#questionInput').value.trim();
    S.autoMode = document.querySelector('input[name="spreadMode"]:checked').value === 'auto';
    if ($('#photoMode').checked) {
      openPhotoPanel();
      return;
    }
    openSpreadPhase();
  });
}

function openSpreadPhase() {
  const list = $('#spreadList');
  list.innerHTML = '';
  $('#autoReason').classList.add('hidden');
  let chosen = null;

  if (S.autoMode) {
    const { spread, reason } = autoSpread(S.question);
    chosen = spread;
    S.spread = spread;
    S.spreadReason = reason;
    $('#spreadEyebrow').textContent = 'THE PATTERN APPOINTED';
    $('#spreadTitle').textContent = '依问择阵';
    const box = $('#autoReason');
    box.classList.remove('hidden');
    box.innerHTML = `神谕为此次占问择定 <strong>${spread.zh}</strong> —— ${reason}`;
  } else {
    $('#spreadEyebrow').textContent = 'CHOOSE THE PATTERN';
    $('#spreadTitle').textContent = '择取牌阵';
  }

  SPREADS.forEach((sp, i) => {
    const item = document.createElement('div');
    item.className = 'spread-item' + (chosen && sp.id === chosen.id ? ' chosen' : '');
    item.innerHTML = `
      <span class="spread-num">${['I', 'II', 'III', 'IV', 'V'][i]}</span>
      <span class="spread-name">${sp.zh}</span>
      <span class="spread-meta">
        <span class="spread-count">${sp.count} CARDS</span>
        <span class="spread-desc">${sp.desc}</span>
      </span>`;
    item.addEventListener('click', () => {
      S.spread = sp;
      item.parentElement.querySelectorAll('.spread-item').forEach(x => x.classList.remove('chosen'));
      item.classList.add('chosen');
      if (S.photoFlowOpen) {
        S.photoFlowOpen = false;
        updatePhotoNote();
        refreshPhotoRead();
        setTimeout(() => setPhase('photo'), 420);
        return;
      }
      setTimeout(() => startRitual(), 420);
    });
    list.appendChild(item);
  });
  setPhase('spread');
}

function wireSpread() {
  $('#spreadBackBtn').addEventListener('click', () => {
    setPhase(S.photoFlowOpen ? 'photo' : 'question');
  });
}

// ---- 二 · 仪式 -----------------------------------------------------------------
function computeScale() {
  const cam = window.__stage.camera;
  const visH = 2 * Math.tan(cam.fov * Math.PI / 360) * 17;
  const visW = visH * cam.aspect;
  const w = S.spread.layout.w * CARD_W, h = S.spread.layout.h * CARD_H;
  S.scale = Math.min(visW * 0.86 / w, visH * 0.78 / h, 1.25);
}

function startRitual() {
  clearTimeout(S.autoTimer);
  computeScale();
  setPhase('shuffle');
  $('#readingPanel').classList.remove('open');
  closeCardDetail();
  S.placed = [];
  hint(`静心。命运正在洗牌……`);
  actions();
  window.__ritual.shuffle(() => {
    setPhase('select');
    window.__ritual.beginSelection();
    if (S.photoFlow) {
      window.__ritual.endSelection();
      dealPhotoCards();
      return;
    }
    hint(`以手择牌 · 点选 ${S.spread.count} 张（可按住拖动画布）`);
    actions(
      mkBtn('命运代抽', 'ghost', autoDraw),
      mkBtn('重 新 洗 牌', 'ghost', () => startRitual()),
    );
  });
}

function handleCardClick(entry) {
  if (S.phase === 'select' && entry.state === 'fan') {
    drawCard(entry);
  } else if (S.phase === 'reading' && entry.state === 'drawn') {
    if (S.detailEntry === entry) closeCardDetail();
    else showCardDetail(entry);
  }
}

function closeCardDetail() {
  S.detailEntry = null;
  $('#cardDetail').classList.remove('open');
}

function drawCard(entry) {
  const idx = S.placed.length;
  if (idx >= S.spread.count) return;
  const slotWorld = window.__ritual.layoutSlots(S.spread, S.scale)[idx];
  const placed = { entry, card: entry.card, reversed: Math.random() < 0.28, slot: S.spread.slots[idx], slotWorld };
  S.placed.push(placed);
  window.__ritual.fitCamera(S.spread, S.scale);
  window.__ritual.flyToSlot(entry, { ...slotWorld, reversed: placed.reversed, deferReveal: true }, () => {
    placed.arrived = true;
    if (S.phase !== 'select' || !S.placed.includes(placed)) return;
    if (S.placed.length === S.spread.count && S.placed.every(p => p.arrived)) {
      const batch = S.placed;
      clearTimeout(S.autoTimer);
      window.__ritual.endSelection();
      setPhase('reveal');
      hint('牌已齐备。屏息，共同揭晓……');
      actions();
      window.__ritual.revealTogether(batch.map(p => p.entry), () => {
        if (S.phase !== 'reveal' || S.placed !== batch) return;
        setPhase('reading');
        startReading();
      });
    } else {
      const remaining = S.spread.count - S.placed.length;
      hint(remaining ? `以手择牌 · 尚余 ${remaining} 张 · 抽齐后一起揭晓` : '牌已选齐，静候落定……');
    }
  });
  hint(`第 ${idx + 1} 张 · 「${placed.slot.label}」之位已定`);
  if (S.placed.length >= S.spread.count) { actions(); hint('牌已选齐，静候落定……'); }
}

function autoDraw() {
  const batch = S.placed;
  const tick = () => {
    if (S.phase !== 'select' || S.placed !== batch || S.placed.length >= S.spread.count) return;
    const rest = window.__ritual.cards.filter(e => e.state === 'fan');
    if (!rest.length) return;
    drawCard(rest[Math.floor(Math.random() * rest.length)]);
    S.autoTimer = setTimeout(tick, 760);
  };
  actions(mkBtn('止 于 此', 'ghost', () => clearTimeout(S.autoTimer)));
  tick();
}

// ---- 三 · 解读 -----------------------------------------------------------------
function chipsHtml() {
  const box = $('#readingChips');
  box.innerHTML = '';
  S.placed.forEach(p => {
    const c = document.createElement('span');
    c.className = 'chip' + (p.reversed ? ' rev' : '');
    c.innerHTML = `<b>${p.slot.label}</b> ${p.card.zh} · ${p.reversed ? '逆位' : '正位'}`;
    box.appendChild(c);
  });
}

function startReading() {
  hint('可拖动画布 · 双指捏合或滚轮缩放 · 点选牌面查看详情');
  $('#readingTitle').textContent = S.spread.zh;
  $('#readingQuestion').textContent = S.question ? `「${S.question}」` : '「愿牌语直指当下最需要看见之事」';
  chipsHtml();
  const stream = $('#readingStream');
  stream.classList.add('streaming');
  stream.innerHTML = '';
  S.readingRaw = '';
  $('#readingPanel').classList.add('open');
  if (S.readingAbort) S.readingAbort.abort();

  const p = selectedProvider();
  if (!p) {
    stream.classList.remove('streaming');
    stream.textContent = '尚未连接 AI。可点击牌面查看内置牌义，或在右上角配置服务后点击「再问一次」。';
    return;
  }
  const model = currentModel(p.id);
  if (!model) { stream.classList.remove('streaming'); stream.textContent = '请先在右上角选定模型，再点击「再问一次」。'; return; }
  const providerArg = p.id.startsWith('custom:')
    ? { kind: p.kind, baseURL: p.baseURL, apiKey: p.apiKey, label: p.label }
    : undefined;

  const messages = buildReadingMessages({
    question: S.question, spread: S.spread, placed: S.placed,
  });
  if (S.readingAbort) S.readingAbort.abort();
  S.readingAbort = new AbortController();
  chat({
    providerId: p.id.startsWith('custom:') ? null : p.id,
    provider: providerArg,
    model, messages, temperature: 0.8, maxTokens: 4096,
    signal: S.readingAbort.signal,
    onDelta(v) {
      S.readingRaw += v;
      stream.innerHTML = mdToHtml(S.readingRaw);
      stream.scrollTop = stream.scrollHeight;
    },
    onDone() { stream.classList.remove('streaming'); },
    onError(msg) {
      stream.classList.remove('streaming');
      const err = document.createElement('p');
      err.style.cssText = 'color:#d9a5a5;font-size:13px;letter-spacing:.05em';
      err.textContent = '神谕中断：' + msg;
      stream.appendChild(err);
      toast('解读中断：' + msg, true);
    },
  });
  $('#readingPanel').classList.add('open');
}

function wireReading() {
  $('#reReadBtn').addEventListener('click', () => { if (S.placed.length) startReading(); });
  $('#newReadBtn').addEventListener('click', () => softReset());
  $('#copyReadBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(S.readingRaw); toast('解读已誊抄至剪贴板'); }
    catch { toast('誊抄失败', true); }
  });
  $('#detailClose').addEventListener('click', () => closeCardDetail());
  $('#chipsToggle').addEventListener('click', () => {
    const btn = $('#chipsToggle');
    const folded = btn.classList.toggle('folded');
    btn.setAttribute('aria-expanded', String(!folded));
    $('#chipsWrap').classList.toggle('folded', folded);
  });
}

function showCardDetail(entry) {
  const placed = S.placed.find(p => p.entry === entry);
  if (!placed) return;
  const c = placed.card;
  $('#detailPos').innerHTML = `牌位 · <b>${placed.slot.label}</b>`;
  $('#detailName').textContent = `${c.zh} · ${placed.reversed ? '逆位' : '正位'}`;
  $('#detailSub').textContent = `${c.en.toUpperCase()} · ${c.astro || ''}`;
  $('#detailKw').innerHTML = placed.reversed
    ? `<b>逆位</b>　${c.k_rev}`
    : `<b>正位</b>　${c.k_up}`;
  $('#detailMeaning').textContent = placed.reversed ? c.rev : c.up;
  $('#detailImg').src = renderCardFace(c).toDataURL();
  $('#detailImg').style.transform = placed.reversed ? 'rotate(180deg)' : '';
  S.detailEntry = entry;
  $('#cardDetail').classList.add('open');
}

function softReset() {
  if (S.readingAbort) S.readingAbort.abort();
  clearTimeout(S.autoTimer);
  $('#readingPanel').classList.remove('open');
  $('#cardDetail').classList.remove('open');
  $('#settingsPanel').classList.remove('open');
  S.placed = [];
  S.spread = null;
  S.detailEntry = null;
  S.photoRows = [];
  S.photoSpreadPicked = false;
  S.photoFlow = false;
  renderPhotoRows();
  const ritual = window.__ritual;
  ritual.resetCamera();
  ritual.build(DECK);
  ritual.intro();
  $('#questionInput').value = S.question;
  setPhase('question');
}

// ---- 四 · 实景占卜 ---------------------------------------------------------------
function wirePhoto() {
  const dz = $('#dropzone');
  const input = $('#photoInput');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('over');
    addPhotos([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  });
  input.addEventListener('change', () => { addPhotos([...input.files]); input.value = ''; });
  $('#photoCancelBtn').addEventListener('click', () => { S.photoFlow = false; S.photoFlowOpen = false; setPhase('question'); });
  $('#photoSpreadBtn').addEventListener('click', () => { S.photoFlowOpen = true; S.autoMode = false; openSpreadPhase(); });
  $('#photoReadBtn').addEventListener('click', beginPhotoReading);
}

function openPhotoPanel() {
  S.photoFlow = true;
  updatePhotoNote();
  setPhase('photo');
}

function updatePhotoNote() {
  const sp = S.spread;
  $('#photoNote').textContent = sp
    ? `已择定 ${sp.zh}（${sp.count} 张）。请为每个牌位上传一张实拍牌面，依序对应。`
    : '以你自己的塔罗牌静心抽牌，逐张拍照上传。神谕将识其牌名与正逆，再为你展开解读。';
}

async function addPhotos(files) {
  for (const f of files) {
    if (S.photoRows.length >= 12) { toast('一次至多十二张', true); break; }
    const dataUrl = await downscale(f, 1024, 0.85);
    const row = { dataUrl, status: '辨识中……', card: null, reversed: false };
    S.photoRows.push(row);
    renderPhotoRows();
    identify(row);
  }
}

function downscale(file, max, q) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', q));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function identify(row) {
  const p = selectedProvider();
  if (!p) { row.status = '未选定神谕'; renderPhotoRows(); return; }
  const model = currentModel(p.id);
  let raw = '';
  await chat({
    providerId: p.id.startsWith('custom:') ? null : p.id,
    provider: p.id.startsWith('custom:') ? { kind: p.kind, baseURL: p.baseURL, apiKey: p.apiKey, label: p.label } : undefined,
    model, messages: buildIdentifyMessages(row.dataUrl),
    temperature: 0, maxTokens: 300,
    onDelta(v) { raw += v; },
    onDone(ok) {
      if (!ok) return;
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        const j = JSON.parse(m ? m[0] : raw);
        if (j.en) {
          row.card = matchCard(j.en, j.zh) || null;
          row.reversed = Boolean(j.reversed);
          row.confidence = j.confidence;
          row.status = row.card ? `识为 ${row.card.zh} · ${row.reversed ? '逆位' : '正位'}${j.confidence != null ? ' · 信度 ' + Number(j.confidence).toFixed(2) : ''}`
            : '未能对上牌库，请于下方指定';
        } else {
          row.status = '照片中未辨出塔罗牌，请重新拍摄或于下方指定';
        }
      } catch {
        row.status = '辨识异常，请于下方指定';
      }
      renderPhotoRows();
    },
    onError(msg) { row.status = '辨识失败：' + msg; renderPhotoRows(); },
  });
}

function matchCard(en, zh) {
  const norm = s => (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9 ]/g, '').trim();
  const enN = norm(en), zhS = (zh || '').trim();
  return DECK.find(c => norm(c.en) === enN)
    || DECK.find(c => c.zh === zhS)
    || DECK.find(c => norm(c.en).includes(enN) && enN.length > 3)
    || null;
}

function renderPhotoRows() {
  const box = $('#photoRows');
  box.innerHTML = '';
  S.photoRows.forEach((row, i) => {
    const div = document.createElement('div');
    div.className = 'photo-row';
    const img = document.createElement('img');
    img.src = row.dataUrl;
    const main = document.createElement('div');
    main.className = 'row-main';
    const status = document.createElement('div');
    status.className = 'row-status';
    status.textContent = `第 ${i + 1} 位 · ${row.status}`;
    const pick = document.createElement('select');
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '指定牌名……';
    pick.appendChild(opt0);
    const groups = { '大阿卡纳': [], '权杖': [], '圣杯': [], '宝剑': [], '星币': [] };
    DECK.forEach(c => {
      if (c.major) groups['大阿卡纳'].push(c);
      else groups[c.zh.slice(0, 2)].push(c);
    });
    for (const [g, arr] of Object.entries(groups)) {
      if (!arr.length) continue;
      const og = document.createElement('optgroup');
      og.label = g;
      arr.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = c.zh;
        if (row.card && row.card.id === c.id) o.selected = true;
        og.appendChild(o);
      });
      pick.appendChild(og);
    }
    pick.addEventListener('change', () => { row.card = byId[pick.value] || null; refreshPhotoRead(); });
    const rev = document.createElement('label');
    rev.className = 'rev-toggle';
    const revCk = document.createElement('input');
    revCk.type = 'checkbox';
    revCk.checked = row.reversed;
    revCk.addEventListener('change', () => { row.reversed = revCk.checked; });
    rev.append(revCk, document.createTextNode('逆位'));
    main.append(status, pick, rev);
    const rm = document.createElement('button');
    rm.className = 'row-remove';
    rm.textContent = '移除';
    rm.addEventListener('click', () => { S.photoRows.splice(i, 1); renderPhotoRows(); });
    div.append(img, main, rm);
    box.appendChild(div);
  });
  refreshPhotoRead();
}

function refreshPhotoRead() {
  const sp = S.spread;
  const n = S.photoRows.length;
  const unique = new Set(S.photoRows.filter(r => r.card).map(r => r.card.id)).size === n;
  const ready = n > 0 && unique && S.photoRows.every(r => r.card) && (!sp || n === sp.count);
  const btn = $('#photoReadBtn');
  btn.disabled = !ready;
  btn.textContent = !unique && S.photoRows.every(r => r.card) ? '牌名重复，请确认每个牌位' : sp
    ? (n === sp.count ? `开 始 解 读 · ${sp.zh}` : `还 需 ${Math.abs(sp.count - n)} 张（${sp.zh} 共 ${sp.count} 位）`)
    : '开 始 解 读';
}

function beginPhotoReading() {
  if (S.photoRows.some(r => !r.card) || new Set(S.photoRows.map(r => r.card.id)).size !== S.photoRows.length) {
    toast('请为每个牌位选择不同且已确认的牌', true); return;
  }
  if (!S.spread) { S.autoMode = true; const { spread } = autoSpread(S.question); S.spread = spread; }
  if (S.photoRows.length !== S.spread.count) {
    toast(`${S.spread.zh} 需要 ${S.spread.count} 张，当前 ${S.photoRows.length} 张`, true);
    return;
  }
  S.photoPending = S.photoRows.map(r => ({ card: r.card, reversed: r.reversed }));
  setPhase('shuffle');
  S.photoFlow = true;
  startRitual();
}

function dealPhotoCards() {
  const ritual = window.__ritual;
  ritual.endSelection();
  const slots = ritual.layoutSlots(S.spread, S.scale);
  S.placed = [];
  hint('实拍之牌，各归其位……');
  ritual.fitCamera(S.spread, S.scale);
  S.photoPending.forEach((p, i) => {
    const entry = ritual.cards.find(e => e.card.id === p.card.id);
    if (!entry) return;
    const slotWorld = slots[i];
    setTimeout(() => {
      ritual.flyToSlot(entry, { ...slotWorld, reversed: p.reversed }, () => {
        S.placed.push({ entry, card: entry.card, reversed: p.reversed, slot: S.spread.slots[i], slotWorld });
        if (S.placed.length === S.spread.count) {
          setPhase('reading');
          startReading();
        }
      });
    }, i * 620);
  });
}

boot();
