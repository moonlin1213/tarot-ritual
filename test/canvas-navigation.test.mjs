import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRitual } from '../public/js/three/cards3d.js';

// Run the actual ritual and Three camera; replace only the DOM event surface.
function fixture(t) {
  const oldWindow = globalThis.window;
  globalThis.window = {innerWidth:1000, innerHeight:800};
  t.after(() => { globalThis.window = oldWindow; });
  const element = new EventTarget();
  element.style = {};
  const captured = new Set();
  element.setPointerCapture = id => captured.add(id);
  element.releasePointerCapture = id => captured.delete(id);
  element.getBoundingClientRect = () => ({left:0,top:0,width:1000,height:800});
  const camera = new THREE.PerspectiveCamera(42, 1.25, .1, 400);
  camera.position.z = 17;
  const rig = {base:new THREE.Vector3(0,0,17)};
  let frame;
  const ritual = createRitual({scene:new THREE.Scene(),camera,rig,
    renderer:{domElement:element},onFrame:fn=>{frame=fn;}});
  let taps=0;
  ritual.onEmptyClick = () => taps++;
  const fire = (type, values={}) => {
    const event = new Event(type, {cancelable:true});
    Object.assign(event, {pointerId:1,clientX:500,clientY:400,button:0,pointerType:'touch',deltaY:0,deltaMode:0,ctrlKey:false,...values});
    element.dispatchEvent(event);
    return event;
  };
  return {element,camera,rig,ritual,fire,captured,frame:dt=>frame(dt,0),taps:()=>taps};
}

test('reading canvas handles trackpad pinch and wheel zoom without browser page zoom', t => {
  const f=fixture(t); f.ritual.endSelection();
  const before=f.camera.projectionMatrix.clone();
  const e=f.fire('wheel',{deltaY:-100,ctrlKey:true});
  assert.ok(f.camera.zoom>1, 'pinch must enlarge the card view');
  assert.equal(e.defaultPrevented,true);
  assert.ok(!f.camera.projectionMatrix.equals(before));
  const enlarged=f.camera.zoom;
  f.fire('wheel',{deltaY:100});
  assert.ok(f.camera.zoom<enlarged);
});

test('pinch doubles zoom, lifting one finger continues pan, and releasing never opens a card', t => {
  const f=fixture(t); f.ritual.endSelection();
  f.fire('pointerdown',{pointerId:1,clientX:400});
  f.fire('pointerdown',{pointerId:2,clientX:600});
  f.fire('pointermove',{pointerId:2,clientX:800});
  assert.equal(f.camera.zoom,2);
  f.fire('pointerup',{pointerId:2,clientX:800});
  const x=f.rig.base.x;
  f.fire('pointermove',{pointerId:1,clientX:420});
  assert.ok(f.rig.base.x<x);
  f.fire('pointerup',{pointerId:1,clientX:420});
  assert.equal(f.taps(),0);
  assert.equal(f.captured.size,0);
});

test('Safari gesture scale is relative to gesture start and overlapping wheel is not applied twice', t => {
  const f=fixture(t); f.ritual.endSelection();
  assert.equal(f.fire('gesturestart',{scale:1}).defaultPrevented,true);
  f.fire('gesturechange',{scale:1.5});
  assert.equal(f.camera.zoom,1.5);
  f.fire('wheel',{deltaY:-100,ctrlKey:true});
  assert.equal(f.camera.zoom,1.5);
  f.fire('gesturechange',{scale:2});
  assert.equal(f.camera.zoom,2);
  f.fire('gestureend',{scale:2});
  f.fire('wheel',{deltaY:100});
  assert.ok(f.camera.zoom<2);
});

test('zoom is bounded and invalid wheel data cannot corrupt the camera', t => {
  const f=fixture(t); f.ritual.endSelection();
  f.fire('wheel',{deltaY:-1e6});
  assert.equal(f.camera.zoom,4);
  f.fire('wheel',{deltaY:1e6});
  assert.equal(f.camera.zoom,.5);
  f.fire('wheel',{deltaY:NaN});
  assert.equal(f.camera.zoom,.5);
  assert.ok(Number.isFinite(f.rig.base.x));
});

test('zoom preserves the point under the cursor instead of pulling everything to canvas center', t => {
  const f=fixture(t); f.ritual.endSelection();
  // Independently project a point on the board plane (z=0), without the stage parallax.
  const world=new THREE.Vector3(-3,2,0);
  const project=()=>{f.camera.position.copy(f.rig.base);f.camera.lookAt(f.rig.base.x,f.rig.base.y,0);f.camera.updateMatrixWorld();return world.clone().project(f.camera);};
  const before=project();
  f.fire('wheel',{deltaY:-180,clientX:(before.x+1)*500,clientY:(1-before.y)*400});
  const after=project();
  assert.ok(f.camera.zoom>1);
  assert.ok(before.distanceTo(after)<1e-9);
});

test('tap and drag still work during selection, while zoom is restricted to the reading layout', t => {
  const f=fixture(t);
  assert.equal(f.fire('wheel',{deltaY:-100}).defaultPrevented,false);
  f.ritual.beginSelection();
  f.fire('wheel',{deltaY:-100});
  assert.equal(f.camera.zoom,1);
  f.fire('pointerdown'); f.fire('pointerup');
  assert.equal(f.taps(),1);
  f.fire('pointerdown'); f.fire('pointermove',{clientX:550}); f.fire('pointerup',{clientX:550});
  assert.ok(f.rig.base.x<0);
  assert.equal(f.taps(),1);
});

test('cancelled or lost-capture gestures cannot cause a tap or leave dragging stuck', t => {
  for (const type of ['pointercancel','lostpointercapture']) {
    const f=fixture(t); f.ritual.endSelection();
    f.fire('pointerdown'); f.fire(type);
    const x=f.rig.base.x;
    f.fire('pointermove',{clientX:800}); f.fire('pointerup');
    assert.equal(f.rig.base.x,x);
    assert.equal(f.taps(),0);
    f.fire('pointerdown'); f.fire('pointerup');
    assert.equal(f.taps(),1);
  }
});

test('fresh camera framing resets zoom, and reset cancels an in-progress gesture', t => {
  const f=fixture(t); f.ritual.endSelection();
  f.fire('wheel',{deltaY:-100});
  assert.ok(f.camera.zoom>1);
  f.ritual.fitCamera({slots:[{x:0,y:0}]},1);
  assert.equal(f.camera.zoom,1);
  f.fire('pointerdown');
  f.ritual.resetCamera();
  f.fire('pointerup');
  assert.equal(f.taps(),0);
  assert.equal(f.captured.size,0);
});

test('manual zoom takes control from an unfinished automatic framing animation', t => {
  const f=fixture(t); f.ritual.endSelection();
  f.ritual.fitCamera({slots:[{x:0,y:0}]},1);
  f.fire('wheel',{deltaY:-100,clientX:300});
  const position=f.rig.base.clone();
  f.frame(.8); f.frame(.8); f.frame(.8);
  assert.ok(f.rig.base.equals(position));
});

test('dragging at twice the zoom travels half as far through the card world', t => {
  const f=fixture(t); f.ritual.endSelection();
  f.fire('gesturestart',{scale:1}); f.fire('gesturechange',{scale:2}); f.fire('gestureend',{scale:2});
  f.fire('pointerdown'); f.fire('pointermove',{clientX:600}); f.fire('pointerup',{clientX:600});
  const magnifiedDistance=Math.abs(f.rig.base.x);
  f.rig.base.x=0; f.ritual.resetCamera();
  f.fire('pointerdown'); f.fire('pointermove',{clientX:600}); f.fire('pointerup',{clientX:600});
  assert.ok(Math.abs(Math.abs(f.rig.base.x)-2*magnifiedDistance)<1e-9);
});
