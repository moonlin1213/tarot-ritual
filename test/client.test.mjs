import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

// Browser APIs are replaced only at the I/O boundary; run the actual client.
for (const file of ['ai.js', 'core.js']) {
  const client = await import(`../public/js/${file}`);
  test(`${file}: explicit DSH import posts consent and updates the usable provider list`, async () => {
    assert.equal(typeof client.importDsh, 'function', 'one-click DSH import is missing');
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return Response.json({ enabled: true, found: true, providers: [{ id: 'dsh:fixture', kind: 'openai', label: 'Fixture', models: ['model-a'], hasKey: true }] });
    };
    const result = await client.importDsh();
    assert.equal(request.url, '/api/dsh/import');
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers['X-Tarot-Request'], '1');
    assert.deepEqual(JSON.parse(request.init.body), { consent: true });
    assert.equal(result.enabled, true);
    assert.equal(client.getProvider('dsh:fixture').models[0], 'model-a');
  });
  test(`${file}: failed DSH import preserves prior providers and reports the failure`, async () => {
    assert.equal(typeof client.importDsh, 'function', 'one-click DSH import is missing');
    client.providerState.dsh = { found: true, providers: [{ id: 'dsh:existing' }] };
    globalThis.fetch = async () => Response.json({ error: 'local error' }, { status: 500 });
    await assert.rejects(client.importDsh());
    assert.equal(client.providerState.dsh.providers[0].id, 'dsh:existing');
  });
  test(`${file}: custom credentials never persist, including legacy migration`, () => {
    const storage = new Map([['arcana.customProviders.v1', JSON.stringify([{ id: 'legacy', apiKey: 'test-secret' }])]]);
    globalThis.localStorage = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
    client.initProviderState();
    assert.equal(client.providerState.custom.length, 0);
    client.addCustomProvider({ label: 'Fixture', kind: 'openai', baseURL: 'https://example.com/v1', apiKey: 'test-secret' });
    assert.ok(!JSON.stringify([...storage]).includes('test-secret'));
  });
  test(`${file}: model discovery keeps credentials out of URLs`, async () => {
    client.providerState.custom = [{ id: 'fixture', kind: 'openai', baseURL: 'https://example.com/v1', apiKey: 'test-secret' }];
    let request;
    globalThis.fetch = async (url, init) => { request = { url, init }; return Response.json({ models: ['fixture'] }); };
    assert.deepEqual(await client.fetchModels('custom:fixture'), ['fixture']);
    assert.equal(request.url, '/api/models');
    assert.equal(request.init.method, 'POST');
    assert.equal(JSON.parse(request.init.body).provider.apiKey, 'test-secret');
    assert.equal(request.init.headers['X-Tarot-Request'], '1');
  });
  test(`${file}: a page reload restores the selected Codex model without storing its credentials`,()=>{
    const storage=new Map();
    globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
    client.selectProvider('dsh:codex-oauth','gpt-5.6-sol');
    client.providerState.selectedId=null;client.providerState.modelByProvider={};
    client.initProviderState();
    assert.equal(client.providerState.selectedId,'dsh:codex-oauth');
    assert.equal(client.currentModel('dsh:codex-oauth'),'gpt-5.6-sol');
    assert.deepEqual(JSON.parse(storage.get('arcana.selectedProvider.v1')),{id:'dsh:codex-oauth',models:{'dsh:codex-oauth':'gpt-5.6-sol'}});
  });
  test(`${file}: completion is delivered exactly once`, async () => {
    globalThis.fetch = async () => new Response('data: {"t":"delta","v":"hello"}\n\ndata: {"t":"done"}\n\n');
    const done = [], deltas = [];
    await client.chat({ onDelta: x => deltas.push(x), onDone: x => done.push(x) });
    assert.deepEqual(deltas, ['hello']);
    assert.deepEqual(done, [true]);
  });
  test(`${file}: truncated streams do not report success`, async () => {
    globalThis.fetch = async () => new Response('data: {"t":"delta","v":"partial"}\n\n');
    const done = [], errors = [];
    await client.chat({ onDone: x => done.push(x), onError: x => errors.push(x) });
    assert.deepEqual(done, [false]);
    assert.equal(errors.length, 1);
  });
}

test('settings truthfully distinguish optional credential renewal from read-only import',async()=>{
  const src=(await fs.readFile(new URL('../public/js/main.js',import.meta.url),'utf8')).replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g,'').replace(/boot\(\);\s*$/,'');
  const nodes=new Map();
  const context=vm.createContext({document:{querySelector:s=>{if(!nodes.has(s))nodes.set(s,{classList:{add(){},remove(){}},textContent:''});return nodes.get(s);}},providerState:{selectedId:'existing'},getProvider:()=>({})});
  vm.runInContext(src+'\nrenderProviderList=()=>{}; updateOrb=()=>{};',context);
  await vm.runInContext('refreshProviders({enabled:true,found:false,providers:[],oauthRefreshEnabled:true})',context);
  assert.match(nodes.get('#dshConsentNote')?.textContent || '',/续期/);
  assert.match(nodes.get('#dshConsentNote')?.textContent || '',/更新/);
  await vm.runInContext('refreshProviders({enabled:true,found:false,providers:[],oauthRefreshEnabled:false})',context);
  assert.match(nodes.get('#dshConsentNote')?.textContent || '',/只读/);
});

test('overlapping card arrivals reveal together once and read only after the reveal completes', async () => {
  const src = (await fs.readFile(new URL('../public/js/main.js', import.meta.url), 'utf8'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '').replace(/boot\(\);\s*$/, '');
  const callbacks = [], reveals = [], elements = new Map();
  const element = () => ({ classList: { toggle() {}, add() {}, remove() {} }, appendChild() {}, textContent: '', innerHTML: '' });
  const context = vm.createContext({
    Math, setTimeout, clearTimeout,
    document: { querySelector: s => { if (!elements.has(s)) elements.set(s, element()); return elements.get(s); } },
    window: { __ritual: { layoutSlots: () => [{}, {}, {}], fitCamera() {}, flyToSlot: (e, s, cb) => callbacks.push(cb), endSelection() {}, revealTogether:(entries,cb)=>reveals.push({entries,cb}) } },
  });
  vm.runInContext(src + '\nS.phase="select"; S.spread={count:3,slots:[{},{},{}]}; var reads=0; startReading=()=>{reads++};', context);
  vm.runInContext('drawCard({card:{}}); drawCard({card:{}}); drawCard({card:{}});', context);
  callbacks[1]();
  assert.equal(vm.runInContext('reads', context), 0);
  callbacks[0](); callbacks[2]();
  assert.equal(vm.runInContext('reads', context), 0, 'landing is not the end of the reveal');
  assert.equal(reveals.length,1);
  assert.equal(reveals[0].entries.length,3);
  callbacks[2]();
  assert.equal(reveals.length,1);
  reveals[0].cb(); reveals[0].cb();
  assert.equal(vm.runInContext('reads', context), 1);
});

test('reading without an AI provider still opens the panel so the user can restart', async () => {
  const src = (await fs.readFile(new URL('../public/js/main.js', import.meta.url), 'utf8'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '').replace(/boot\(\);\s*$/, '');
  const nodes = new Map();
  const node = () => { const classes = new Set(); return { classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) }, innerHTML: '', textContent: '', appendChild() {} }; };
  const context = vm.createContext({ document: { querySelector: s => { if (!nodes.has(s)) nodes.set(s, node()); return nodes.get(s); } } });
  vm.runInContext(src + '\nS.spread={zh:"Fixture"}; selectedProvider=()=>null; toast=()=>{}; startReading();', context);
  assert.equal(nodes.get('#readingPanel')?.classList.contains('open'), true);
  assert.equal(nodes.get('#readingStream').classList.contains('streaming'), false);
});

test('photo flow disables reading when one physical card is assigned twice', async () => {
  const src = (await fs.readFile(new URL('../public/js/main.js', import.meta.url), 'utf8'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '').replace(/boot\(\);\s*$/, '');
  const button = {};
  const context = vm.createContext({ document: { querySelector: () => button } });
  vm.runInContext(src + '\nS.spread={count:2}; S.photoRows=[{card:{id:"M00"}},{card:{id:"M00"}}]; refreshPhotoRead();', context);
  assert.equal(button.disabled, true);
});

test('provider without a model listing can select a model manually', async () => {
  const src = (await fs.readFile(new URL('../public/js/main.js', import.meta.url), 'utf8'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g, '').replace(/boot\(\);\s*$/, '');
  const elements = [], chosen = [];
  function element(tag) { const e = { tag, dataset: {}, style: {}, handlers: {}, append() {}, appendChild() {}, addEventListener(name, cb) { this.handlers[name] = cb; } }; elements.push(e); return e; }
  const context = vm.createContext({
    document: { createElement: element, querySelector: () => element('container') },
    allProviders: () => [{ id: 'dsh:fixture', kind: 'responses', models: [] }],
    providerState: { selectedId: 'dsh:fixture' }, currentModel: () => null, setModel: (...args) => chosen.push(args),
  });
  vm.runInContext(src + '\nupdateOrb=()=>{}; renderProviderList();', context);
  const input = elements.find(e => e.tag === 'input');
  assert.ok(input, 'manual model input is available when discovery is unavailable');
  input.value = 'custom-model'; input.handlers.change();
  assert.deepEqual(chosen, [['dsh:fixture', 'custom-model']]);
});
