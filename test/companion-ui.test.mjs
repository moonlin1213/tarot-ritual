import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import { createRitual } from '../public/js/three/cards3d.js';
import { SPREADS, DECK, byId, mdToHtml, buildReadingMessages, buildIdentifyMessages, chat } from '../public/js/core.js';
import { createCompanionAdapter } from '../public/js/companion-adapter.js';

const source = (await fs.readFile(new URL('../public/js/main.js', import.meta.url), 'utf8'))
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '').replace(/boot\(\);\s*$/, '');
function fixture() {
  const nodes = new Map(), flights = [], reveals = [], layouts = [], requests = [];
  function node() { const classes = new Set(); return { style: {}, dataset: {}, children: [], handlers: {}, value: '', disabled: false, textContent: '', innerHTML: '', classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, v) { if (v) classes.add(x); else classes.delete(x); } }, appendChild(x) { this.children.push(x); }, append(...xs) { this.children.push(...xs); }, addEventListener(k, fn) { this.handlers[k] = fn; }, setAttribute() {} }; }
  const ritual = { cards: DECK.map(card => ({ card, state: 'fan' })), layoutSlots: sp => sp.slots.map(() => ({})), fitCamera() {}, endSelection() {},
    flyToSlot(e, s, cb) { e.state = 'drawn'; flights.push({ e, s, cb }); }, revealTogether: (entries, cb) => { reveals.push({ entries, cb }); return true; },
    restoreLayout: placed => layouts.push(placed), build() { requests.push('build'); }, intro() { requests.push('intro'); }, shuffle() { requests.push('shuffle'); } };
  const context = vm.createContext({ Math, setTimeout, clearTimeout, AbortController, crypto, SPREADS, DECK, byId, mdToHtml,
    document: { querySelector: s => { if (!nodes.has(s)) nodes.set(s, node()); return nodes.get(s); }, createElement: node },
    window: { __ritual: ritual, __stage: { camera: { fov: 45, aspect: 1.5 } } },
    providerState: { selectedId: null }, getProvider: () => null,
  });
  vm.runInContext(source + '\ntoast=()=>{};', context);
  return { nodes, flights, reveals, layouts, requests, ritual, context, run: code => vm.runInContext(code, context) };
}

test('managed draw stays face-down until durable ACK and blocks replacement/reset', async () => {
  const f = fixture(); let ack; const events = [];
  f.context.adapter = { commitDraw: body => { events.push(body); return new Promise(r => { ack = r; }); }, reveal: async () => ({ revision: 2 }) };
  f.run('S.companion=adapter; S.phase="select"; S.question="Synthetic"; S.spread=SPREADS[0]; var reads=0; startReading=()=>reads++; drawCard(window.__ritual.cards[0]);');
  f.flights[0].cb(); await new Promise(r => setImmediate(r));
  assert.equal(f.reveals.length, 0, 'a draw needs server ACK before revealing');
  assert.equal(events.length, 1); assert.equal(events[0].draws[0].card_id, 'M00');
  f.run('softReset(); startRitual();'); assert.deepEqual(f.requests, []);
  ack({ revision: 1 }); await new Promise(r => setImmediate(r));
  assert.equal(f.reveals.length, 1); assert.equal(f.run('reads'), 0);
  f.reveals[0].cb(); await new Promise(r => setImmediate(r));
  assert.equal(f.run('reads'), 1);
});

test('refresh restores canonical card positions and text without shuffle or AI request', async () => {
  const f = fixture();
  f.context.saved = { id: 'synthetic', question: 'Saved question', spread_id: 'three', phase: 'revealed', revision: 4,
    draws: [{ position: 2, card_id: 'M02', reversed: false, revealed: true }, { position: 0, card_id: 'M00', reversed: true, revealed: true }, { position: 1, card_id: 'M01', reversed: false, revealed: true }], reading: { id: 'attempt', state: 'unknown', text: 'Saved **partial** text' } };
  f.run('S.companion={}; var reads=0; startReading=()=>reads++;');
  assert.equal(f.run('typeof restoreCompanionSession'), 'function');
  await f.run('restoreCompanionSession(saved)');
  assert.equal(f.run('reads'), 0); assert.deepEqual(f.requests, []);
  assert.equal(f.run('S.placed.map(p=>p.card.id).join(",")'), 'M00,M01,M02');
  assert.equal(f.run('S.placed[0].reversed'), true);
  assert.equal(f.run('S.readingRaw'), 'Saved **partial** text');
  assert.match(f.nodes.get('#readingStream').innerHTML, /Saved <strong>partial<\/strong> text/);
  assert.match(f.nodes.get('#companionStatus').textContent, /未知/);
  assert.equal(f.nodes.get('#ritualHint').textContent, SPREADS[1].zh);
  assert.equal(f.nodes.get('#newReadBtn').disabled, true);
});

test('physical cards use the managed batch ACK boundary and preserve chosen orientation', async () => {
  const f = fixture(); let ack;
  f.context.adapter = { commitDraw: () => new Promise(r => { ack = r; }), reveal: async () => ({ revision: 2 }) };
  f.run('S.companion=adapter; S.spread=SPREADS[0]; S.photoPending=[{card:DECK[0],reversed:true}]; S.phase="select"; dealPhotoCards();');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(f.flights.length, 1); assert.equal(f.flights[0].s.deferReveal, true); assert.equal(f.flights[0].s.reversed, true);
  f.flights[0].cb(); await new Promise(r => setImmediate(r));
  assert.equal(f.reveals.length, 0); ack({ revision: 1 }); await new Promise(r => setImmediate(r));
  assert.equal(f.reveals.length, 1);
});

test('restored 3D layout uses exact transforms and still allows deferred collective reveal', () => {
  const ritual = createRitual({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), rig: { base: new THREE.Vector3() }, onFrame() {}, renderer: { domElement: { addEventListener() {}, style: {} } } });
  const entry = { card: DECK[0], mesh: new THREE.Group(), state: 'idle' };
  ritual.cards.push(entry);
  assert.equal(typeof ritual.restoreLayout, 'function');
  const placed = [{ entry, reversed: true, revealed: true, slotWorld: { pos: new THREE.Vector3(2, 3, 4), rot: 0.2, scale: 0.8 } }];
  ritual.restoreLayout(placed);
  assert.equal(entry.state, 'drawn'); assert.equal(entry.mesh.visible, true);
  assert.deepEqual(entry.mesh.position.toArray(), [2, 3, 4]); assert.equal(entry.mesh.rotation.z, 0.2 + Math.PI);
  assert.equal(entry.mesh.rotation.y, 0); assert.equal(ritual.mode, 'layout');
  ritual.restoreLayout([{ ...placed[0], revealed: false }]);
  assert.equal(entry.mesh.rotation.y, Math.PI); assert.equal(entry.pendingReveal.reversed, true);
});

test('standalone boot performs no companion request and managed bootstrap precedes control wiring', async () => {
  for (const managed of [false, true]) {
    const f = fixture(), calls = []; let finish;
    f.nodes.set('#companion-config', managed ? { textContent: JSON.stringify({ protocol: 'cove-tarot-companion-v1', sessionId: 'synthetic', apiBase: '/companion/v1' }) } : null);
    f.context.document.fonts = { ready: Promise.resolve() };
    f.context.setTimeout = () => 0;
    f.context.initProviderState = () => calls.push('provider-state');
    f.context.createStage = () => f.context.window.__stage;
    f.context.createRitual = () => f.ritual;
    f.context.createCompanionAdapter = config => createCompanionAdapter(config, { fetchImpl: async () => {
      calls.push('bootstrap'); await new Promise(r => { finish = r; });
      return Response.json({ session: { id: 'synthetic', question: 'Saved question', phase: 'accepted', revision: 0, draws: [], reading: null }, csrf_token: 'synthetic-csrf' });
    } });
    globalThis.localStorage = { getItem: () => null };
    f.run('wireQuestion=wireSpread=wireReading=wireSettings=wirePhoto=()=>{}; refreshProviders=()=>{};');
    const boot = f.run('boot()'); await new Promise(r => setImmediate(r));
    if (managed) {
      assert.deepEqual(calls, ['bootstrap']); assert.equal(f.nodes.get('#beginBtn').disabled, true);
      finish();
    }
    await boot;
    assert.deepEqual(calls, managed ? ['bootstrap', 'provider-state'] : ['provider-state']);
    if (managed) assert.equal(f.nodes.get('#beginBtn').disabled, false);
  }
});

test('an incomplete saved reveal syncs saved positions but never starts a new reading', async () => {
  const f = fixture(), positions = [];
  f.context.adapter = { reveal: async body => positions.push([...body.positions]) };
  f.run('S.companion=adapter; var reads=0; startReading=()=>reads++;');
  await f.run('restoreCompanionSession({id:"synthetic",phase:"drawn",question:"Saved",spread_id:"single",draws:[{position:0,card_id:"M00",reversed:true,revealed:false}],reading:null})');
  assert.equal(f.reveals.length, 1); assert.equal(f.run('reads'), 0);
  await f.reveals[0].cb();
  assert.deepEqual(positions, [[0]]); assert.equal(f.run('reads'), 0);
});

test('running readings only resume by attempt ID; unknown reread requires charge warning consent', async () => {
  const f = fixture(), reads = [];
  f.context.record = arg => reads.push(arg);
  f.context.window.confirm = () => false;
  f.run('S.companion={}; S.phase="reading"; S.placed=[{}]; S.companionSession={phase:"revealed",reading:{id:"existing-attempt",state:"running"}}; startReading=record; wireReading();');
  f.nodes.get('#reReadBtn').handlers.click();
  assert.equal(reads.length, 1); assert.equal(reads[0].attempt_id, 'existing-attempt');
  f.run('S.companionSession.reading.state="unknown";');
  f.nodes.get('#reReadBtn').handlers.click(); assert.equal(reads.length, 1);
  f.context.window.confirm = () => true;
  f.nodes.get('#reReadBtn').handlers.click(); assert.equal(reads.length, 2);
  for (const phase of ['returned', 'stopped', 'deleted']) {
    f.run(`S.companionSession.phase=${JSON.stringify(phase)};`);
    f.nodes.get('#reReadBtn').handlers.click();
  }
  assert.equal(reads.length, 2);
});

test('failed draw ACK leaves reveal and reading locked with a truthful recovery status', async () => {
  const f = fixture();
  f.context.adapter = { commitDraw: async () => { throw new Error('synthetic lost ACK'); } };
  f.run('S.companion=adapter; S.phase="select"; S.spread=SPREADS[0]; drawCard(window.__ritual.cards[0]);');
  f.flights[0].cb(); await new Promise(r => setImmediate(r));
  assert.equal(f.reveals.length, 0);
  assert.equal(f.nodes.get('#newReadBtn').disabled, true); assert.equal(f.nodes.get('#reReadBtn').disabled, true);
  assert.match(f.nodes.get('#companionStatus').textContent, /未确认/);
});

test('a corrupt restored session cannot re-enable question controls or accept a replacement', async () => {
  const f = fixture();
  f.run('S.companion={};');
  await assert.rejects(f.run('restoreCompanionSession({id:"synthetic",phase:"drawn",spread_id:"single",draws:[{position:0,card_id:"unknown-card",reversed:false,revealed:true}],reading:null})'));
  f.run('startRitual(); softReset();');
  assert.deepEqual(f.requests, []);
});

test('managed reading uses the companion transport, while photo identification retains original chat', async () => {
  const f = fixture(), requests = [], storage = new Map();
  f.context.localStorage = { setItem: (k, v) => storage.set(k, v) };
  f.context.buildReadingMessages = buildReadingMessages;
  f.context.buildIdentifyMessages = buildIdentifyMessages;
  f.context.currentModel = () => 'synthetic-model';
  f.context.chat = chat;
  f.context.adapter = { read: async body => {
    requests.push({ kind: 'companion', body });
    return new Response('data: {"t":"delta","v":"Synthetic reading"}\n\ndata: {"t":"done"}\n\n');
  } };
  globalThis.fetch = async (url, init) => {
    requests.push({ kind: 'original', url, body: JSON.parse(init.body) });
    return new Response('data: {"t":"delta","v":"{\\"en\\":\\"The Fool\\",\\"reversed\\":true}"}\n\ndata: {"t":"done"}\n\n');
  };
  f.run('S.companion=adapter; S.companionSession={id:"synthetic",phase:"revealed"}; S.phase="reading"; S.spread=SPREADS[0]; S.placed=[{card:DECK[0],reversed:true,slot:SPREADS[0].slots[0]}]; selectedProvider=()=>({id:"dsh:synthetic",kind:"openai"}); refreshCompanionReading=()=>{}; renderPhotoRows=()=>{}; startReading();');
  await new Promise(r => setImmediate(r));
  assert.equal(requests.length, 1); assert.equal(requests[0].kind, 'companion');
  assert.equal(requests[0].body.model, 'synthetic-model'); assert.equal(requests[0].body.providerId, 'dsh:synthetic');
  assert.match(requests[0].body.action_id, /^[a-z0-9-]+$/);
  assert.equal(storage.get('cove-tarot-companion-v1.reading.synthetic'), requests[0].body.action_id);
  assert.equal(f.run('S.readingRaw'), 'Synthetic reading');
  await f.run('var row={dataUrl:"data:image/png;base64,AA=="}; identify(row)');
  assert.equal(requests.length, 2); assert.equal(requests[1].url, '/api/chat');
  assert.equal(requests[1].body.model, 'synthetic-model');
  assert.equal(f.run('row.card.id'), 'M00'); assert.equal(f.run('row.reversed'), true);
});

test('managed drawing without a provider keeps truthful original no-reading guidance', () => {
  const f = fixture();
  f.run('S.companion={}; S.companionSession={id:"synthetic",phase:"revealed"}; S.phase="reading"; S.spread=SPREADS[0]; startReading();');
  assert.equal(f.nodes.get('#readingPanel').classList.contains('open'), true);
  assert.match(f.nodes.get('#readingStream').textContent, /尚未连接 AI/);
  assert.equal(f.nodes.get('#readingStream').classList.contains('streaming'), false);
});

for (const photo of [false, true]) {
  for (const terminal of ['stopped', 'returned', 'deleted']) {
    test(`delayed ${photo ? 'physical-card' : 'draw'} shuffle cannot reopen a ${terminal} session`, async () => {
      const f = fixture(); let finishShuffle;
      f.ritual.shuffle = callback => { finishShuffle = callback; };
      f.ritual.beginSelection = () => f.requests.push('beginSelection');
      f.context.setTimeout = callback => { callback(); return 0; };
      f.context.adapter = { stop: async () => ({ phase: 'stopped' }), returnToChat: async () => ({ state: 'pending' }) };
      f.run(`S.companion=adapter; S.companionSession={id:"synthetic",phase:"accepted"}; S.spread=SPREADS[0]; S.photoFlow=${photo}; S.photoPending=[{card:DECK[0],reversed:true}]; wireCompanion(); startRitual();`);
      const controls = f.nodes.get('#ui').children[0].children;
      if (terminal === 'deleted') f.run('S.companionSession.phase="deleted"; setPhase("question"); actions(); lockCompanionControls();');
      else await controls.find(button => button.textContent === (terminal === 'stopped' ? '停止本次' : '返回聊天')).handlers.click();
      assert.equal(f.run('companionTerminal()'), true);
      finishShuffle();
      assert.equal(f.run('S.phase'), terminal === 'returned' ? 'shuffle' : 'question', 'late completion must not reopen selection');
      assert.deepEqual(f.requests, [], 'terminal completion cannot enter selection');
      assert.deepEqual(f.nodes.get('#ritualActions').children, [], 'terminal completion cannot recreate draw controls');
      assert.equal(f.flights.length, 0, 'terminal physical flow cannot deal a saved photo hand');
      assert.equal(f.run('S.placed.length'), 0);
    });
  }
}

test('only the current managed shuffle may complete, while an active standalone shuffle still opens selection', () => {
  const f = fixture(), completions = [];
  f.ritual.shuffle = callback => completions.push(callback);
  f.ritual.beginSelection = () => f.requests.push('beginSelection');
  f.run('S.companion={}; S.companionSession={id:"synthetic",phase:"accepted"}; S.spread=SPREADS[0]; startRitual(); startRitual();');
  completions[0]();
  assert.equal(f.run('S.phase'), 'shuffle', 'superseded operation cannot finish the current shuffle');
  assert.deepEqual(f.requests, []);
  completions[1]();
  assert.equal(f.run('S.phase'), 'select');
  assert.deepEqual(f.requests, ['beginSelection']);
  const standalone = fixture(); let finishStandalone;
  standalone.ritual.shuffle = callback => { finishStandalone = callback; };
  standalone.ritual.beginSelection = () => {};
  standalone.run('S.spread=SPREADS[0]; startRitual();');
  finishStandalone();
  assert.equal(standalone.run('S.phase'), 'select');
  assert.equal(standalone.nodes.get('#ritualActions').children.length, 2);
});
