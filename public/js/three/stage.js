// ============================================================================
// 三维圣坛 · 舞台层：星云背景、星辰、金尘、相机架
// ============================================================================
import * as THREE from 'three';

const NEBULA_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uRes;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for(int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main(){
    vec2 uv = vUv;
    float aspect = uRes.x / uRes.y;
    vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

    float n1 = fbm(p * 2.6 + vec2(uTime * 0.010, uTime * 0.006));
    float n2 = fbm(p * 5.2 - vec2(uTime * 0.016, 0.0) + n1 * 0.9);
    float n3 = fbm(p * 1.3 + vec2(0.0, -uTime * 0.004) + n2 * 0.5);

    vec3 base   = vec3(0.030, 0.024, 0.052);
    vec3 violet = vec3(0.088, 0.062, 0.145);
    vec3 indigo = vec3(0.048, 0.062, 0.118);
    vec3 gold   = vec3(0.62, 0.50, 0.30);

    vec3 col = mix(base, violet, smoothstep(0.30, 0.85, n1));
    col = mix(col, indigo, smoothstep(0.35, 0.9, n2) * 0.65);
    col += vec3(0.020, 0.014, 0.036) * smoothstep(0.55, 1.0, n3);

    // 一条极淡的金色银河带
    float band = exp(-pow((uv.y - 0.56 - 0.13 * sin(uv.x * 2.4 + uTime * 0.03) - (n2 - 0.5) * 0.35), 2.0) * 26.0);
    col += gold * band * 0.05 * smoothstep(0.4, 0.9, n1);

    // 暗角
    float d = length(vec2(p.x / aspect, p.y)) / 0.72;
    col *= 1.0 - smoothstep(0.55, 1.15, d) * 0.55;

    gl_FragColor = vec4(col, 1.0);
  }
`;

const NEBULA_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function makeGlowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070510');
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(0, 0, 17);
  camera.add(new THREE.AmbientLight('#8888aa', 0.6)); // 保留场景默认亮度（材质以 Basic 为主）
  scene.add(camera);

  // ---- 星云穹顶（跟随相机，始终铺满视野）----
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
    depthWrite: false,
  });
  const bgGeo = new THREE.PlaneGeometry(2, 2);
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.frustumCulled = false;
  bg.position.z = -120;
  const bgScene = new THREE.Scene();
  const bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  bgScene.add(bg);

  // ---- 星辰两层 ----
  const sprite = makeGlowSprite();
  const starGroup = new THREE.Group();
  const starLayers = [];
  function starLayer(count, radius, size, color, opacity) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.25 + Math.random() * 0.75);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r * 0.62;
      pos[i * 3 + 2] = -30 - Math.random() * 60;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size, map: sprite, color, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    starGroup.add(pts);
    starLayers.push({ pts, baseO: opacity, phase: Math.random() * 10 });
  }
  starLayer(900, 90, 0.55, '#cfd3ea', 0.7);
  starLayer(500, 60, 1.05, '#e8d9ae', 0.55);
  starLayer(140, 45, 1.7, '#d9b877', 0.5);
  scene.add(starGroup);

  // ---- 金尘（漂浮上升的仪式微尘）----
  const DUST_N = 260;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustSeed = new Float32Array(DUST_N);
  for (let i = 0; i < DUST_N; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 34;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
    dustPos[i * 3 + 2] = (Math.random() - 0.2) * 10;
    dustSeed[i] = Math.random() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    size: 0.16, map: sprite, color: '#d9b877', transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ---- 相机架（含鼠标视差）----
  const rig = {
    base: new THREE.Vector3(0, 0, 17),
    target: new THREE.Vector3(0, 0, 17),
    parallax: new THREE.Vector2(0, 0),
    parallaxTarget: new THREE.Vector2(0, 0),
  };
  window.addEventListener('pointermove', e => {
    rig.parallaxTarget.set(
      (e.clientX / window.innerWidth - 0.5) * 0.5,
      -(e.clientY / window.innerHeight - 0.5) * 0.3,
    );
  }, { passive: true });

  const clock = new THREE.Clock();
  const hooks = new Set();
  function onFrame(fn) { hooks.add(fn); return () => hooks.delete(fn); }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bgMat.uniforms.uRes.value.set(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  renderer.setClearColor('#070510', 1);
  renderer.autoClear = false;
  let elapsed = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    bgMat.uniforms.uTime.value = elapsed;

    starGroup.rotation.z = elapsed * 0.004;
    starLayers.forEach(l => { l.pts.material.opacity = l.baseO * (0.75 + 0.25 * Math.sin(elapsed * 0.7 + l.phase)); });

    // 金尘上升
    const arr = dust.geometry.attributes.position.array;
    for (let i = 0; i < DUST_N; i++) {
      arr[i * 3 + 1] += dt * (0.14 + 0.1 * Math.sin(dustSeed[i]));
      arr[i * 3] += dt * 0.05 * Math.sin(elapsed * 0.4 + dustSeed[i]);
      if (arr[i * 3 + 1] > 11) { arr[i * 3 + 1] = -11; arr[i * 3] = (Math.random() - 0.5) * 34; }
    }
    dust.geometry.attributes.position.needsUpdate = true;
    dustMat.opacity = 0.4 + 0.18 * Math.sin(elapsed * 0.5);

    // 相机缓动
    rig.target.x += (rig.base.x - rig.target.x) * 0.03;
    rig.target.y += (rig.base.y - rig.target.y) * 0.03;
    rig.target.z += (rig.base.z - rig.target.z) * 0.045;
    rig.parallax.x += (rig.parallaxTarget.x - rig.parallax.x) * 0.04;
    rig.parallax.y += (rig.parallaxTarget.y - rig.parallax.y) * 0.04;
    camera.position.set(
      rig.target.x + rig.parallax.x,
      rig.target.y + rig.parallax.y,
      rig.target.z,
    );
    camera.lookAt(rig.target.x, rig.target.y, 0);

    hooks.forEach(fn => fn(dt, elapsed));

    renderer.clear();
    renderer.render(bgScene, bgCamera);
    renderer.render(scene, camera);
  });

  return { scene, camera, renderer, rig, onFrame, THREE };
}
