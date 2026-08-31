import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import {createRitual} from '../public/js/three/cards3d.js';

function ritualFixture(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  let frame, time=0;
  const ritual=createRitual({scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),
    rig:{base:new THREE.Vector3(0,0,17)},onFrame:fn=>{frame=fn;},
    renderer:{domElement:{addEventListener(){},style:{}}}});
  // Complete card entries with real Three transforms; raster art is irrelevant to timing.
  const entries=[0,1].map(idx=>{
    const mesh=new THREE.Group();mesh.rotation.y=Math.PI;
    const entry={mesh,glow:new THREE.Mesh(undefined,new THREE.MeshBasicMaterial({opacity:0})),card:{id:`fixture-${idx}`},state:'fan',idx};
    ritual.cards.push(entry);return entry;
  });
  ritual.beginSelection();
  const slot=i=>({pos:new THREE.Vector3(i*2,0,1.2),rot:i?.3:0,scale:.8,reversed:i===1,deferReveal:true});
  const advance=ms=>{for(let i=0;i<ms;i+=10){time+=.01;t.mock.timers.tick(10);frame(.01,time);}};
  return {ritual,entries,slot,advance};
}

test('a selected card lands face-down and waits without revealing its identity', t=>{
  const f=ritualFixture(t);let arrivals=0;
  f.ritual.flyToSlot(f.entries[0],f.slot(0),()=>arrivals++);
  f.advance(2500);
  assert.equal(arrivals,1);
  assert.equal(f.entries[0].mesh.rotation.y,Math.PI);
  assert.equal(f.entries[0].mesh.scale.x,.8);
});

test('all cards turn at the same time and finish upright/reversed before one completion', t=>{
  const f=ritualFixture(t);
  f.ritual.flyToSlot(f.entries[0],f.slot(0));f.advance(400);
  f.ritual.flyToSlot(f.entries[1],f.slot(1));f.advance(1100);
  assert.ok(f.entries.every(e=>e.mesh.rotation.y===Math.PI));
  let completed=0;
  f.ritual.endSelection();
  f.ritual.revealTogether(f.entries,()=>completed++);
  f.advance(150);
  assert.ok(f.entries.every(e=>e.mesh.rotation.y===Math.PI),'allow a brief settled moment');
  f.advance(400);
  assert.ok(f.entries[0].mesh.rotation.y>0 && f.entries[0].mesh.rotation.y<Math.PI);
  assert.equal(f.entries[0].mesh.rotation.y,f.entries[1].mesh.rotation.y);
  assert.equal(completed,0);
  f.advance(1000);
  assert.equal(completed,1);
  assert.equal(f.entries[0].mesh.rotation.y,0);
  assert.equal(f.entries[1].mesh.rotation.y,0);
  assert.equal(f.entries[0].mesh.rotation.z,0);
  assert.equal(f.entries[1].mesh.rotation.z,.3+Math.PI);
  assert.equal(f.ritual.revealTogether(f.entries,()=>completed++),false);
  f.advance(1500);assert.equal(completed,1);
});

test('an unfinished flight cannot be revealed as a completed batch', t=>{
  const f=ritualFixture(t);let completed=0;
  f.ritual.flyToSlot(f.entries[0],f.slot(0));
  assert.equal(typeof f.ritual.revealTogether,'function','batch reveal is missing');
  assert.equal(f.ritual.revealTogether([f.entries[0]],()=>completed++),false);
  f.advance(2000);assert.equal(completed,0);
  assert.equal(f.entries[0].mesh.rotation.y,Math.PI);
});

test('starting a new deck cancels pending reveal completion from the old reading', t=>{
  const f=ritualFixture(t);let completed=0;
  f.ritual.flyToSlot(f.entries[0],f.slot(0));f.advance(1100);
  assert.equal(typeof f.ritual.revealTogether,'function','batch reveal is missing');
  f.ritual.endSelection();f.ritual.revealTogether([f.entries[0]],()=>completed++);
  f.ritual.build([]);f.advance(2000);
  assert.equal(completed,0);
});

test('a one-card spread also completes only after its flip has finished',t=>{
  const f=ritualFixture(t);let completed=0;
  f.ritual.flyToSlot(f.entries[0],f.slot(0));f.advance(1100);
  f.ritual.endSelection();f.ritual.revealTogether([f.entries[0]],()=>completed++);
  f.advance(700);assert.equal(completed,0);
  f.advance(500);assert.equal(completed,1);assert.equal(f.entries[0].mesh.rotation.y,0);
});

test('existing physical-card placement can still reveal immediately without deferred mode',t=>{
  const f=ritualFixture(t);let completed=0;
  f.ritual.flyToSlot(f.entries[1],{...f.slot(1),deferReveal:false},()=>completed++);
  f.advance(2000);
  assert.equal(completed,1);
  assert.equal(f.entries[1].mesh.rotation.y,0);
  assert.equal(f.entries[1].mesh.rotation.z,.3+Math.PI);
});

test('rebuilding during the flip suppresses the old completion as well',t=>{
  const f=ritualFixture(t);let completed=0;
  f.ritual.flyToSlot(f.entries[0],f.slot(0));f.advance(1100);
  f.ritual.endSelection();f.ritual.revealTogether([f.entries[0]],()=>completed++);
  f.advance(600);f.ritual.build([]);f.advance(1500);
  assert.equal(completed,0);
});

async function clientFixture() {
  const source=(await fs.readFile(new URL('../public/js/main.js',import.meta.url),'utf8'))
    .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\n/g,'').replace(/boot\(\);\s*$/,'');
  const flights=[],reveals=[],timers=[];
  const entries=[0,1,2].map(i=>({state:'fan',card:{id:`c${i}`}}));
  const context=vm.createContext({Math,clearTimeout(){},setTimeout:fn=>{timers.push(fn);return timers.length;},
    document:{querySelector:()=>({classList:{toggle(){},add(){},remove(){}},appendChild(){},innerHTML:''}),createElement:()=>({addEventListener(){}})},
    window:{__ritual:{cards:entries,layoutSlots:()=>[{},{},{}],fitCamera(){},endSelection(){},
      flyToSlot:(e,s,cb)=>{e.state='drawn';flights.push({e,s,cb});},revealTogether:(es,cb)=>reveals.push({es,cb})}}});
  vm.runInContext(source+'\nS.phase="select"; S.spread={count:3,slots:[{},{},{}]}; var reads=0,details=0; startReading=()=>reads++; showCardDetail=()=>details++;',context);
  return {context,flights,reveals,timers,entries,run:code=>vm.runInContext(code,context)};
}

test('automatic drawing defers every reveal until all flights have landed',async()=>{
  const f=await clientFixture();f.run('autoDraw()');
  while(f.timers.length)f.timers.shift()();
  assert.equal(f.flights.length,3);
  assert.ok(f.flights.every(f=>f.s.deferReveal===true));
  f.flights[2].cb();f.flights[0].cb();assert.equal(f.reveals.length,0);
  f.flights[1].cb();assert.equal(f.reveals.length,1);assert.equal(f.run('reads'),0);
  f.reveals[0].cb();assert.equal(f.run('reads'),1);
});

test('an old batch callback cannot open a reading after the current hand has changed',async()=>{
  const f=await clientFixture();f.run('autoDraw()');while(f.timers.length)f.timers.shift()();
  f.flights.forEach(f=>f.cb());
  assert.equal(f.reveals.length,1);
  f.run('S.placed=[]; S.phase="reveal"');f.reveals[0].cb();
  assert.equal(f.run('reads'),0);
});

test('cards cannot show detail during the collective flip but can after it',async()=>{
  const f=await clientFixture();
  f.run('S.phase="reveal"; handleCardClick({state:"drawn",card:{}})');
  assert.equal(f.run('details'),0);
  f.run('S.phase="reading"; handleCardClick({state:"drawn",card:{}})');
  assert.equal(f.run('details'),1);
});
