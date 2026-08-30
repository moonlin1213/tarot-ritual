// ============================================================================
// 牌面绘制引擎 · 程序化粒子星绘（Canvas 2D 光点系统，非 SVG）
// 每张牌面由数千个辉光粒子沿参数曲线构成，RWS 图像志的抽象重述。
// ============================================================================

export const PW = 512, PH = 896;

// ---- 确定性随机 ------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---- 辉光粒子 --------------------------------------------------------------
const glowCache = new Map();
function glowSprite(color) {
  if (glowCache.has(color)) return glowCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(color, c);
  return c;
}
const GLOW_BOOST = 1.35;
function dot(g, x, y, r, color, a) {
  const spr = glowSprite(color);
  const rr = r * GLOW_BOOST;
  g.globalAlpha = a;
  g.drawImage(spr, x - rr, y - rr, rr * 2, rr * 2);
}
function dots(g, pts, color, base) {
  for (const [x, y, s, a] of pts) dot(g, x, y, base * (s || 1), color, (a ?? 1) * 1.0);
}

// ---- 参数曲线采样 ----------------------------------------------------------
const TAU = Math.PI * 2;
function ringPts(cx, cy, r, n, j = 0, rnd = Math.random, a0 = 0, a1 = TAU) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + (a1 - a0) * (i / (n - (a1 - a0 >= TAU - 1e-6 ? 0 : 1)));
    const rr = r * (1 + (rnd() - 0.5) * 2 * j);
    pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, 0.7 + rnd() * 0.9, 0.35 + rnd() * 0.65]);
  }
  return pts;
}
function arcPts(cx, cy, r, a0, a1, n, j = 0, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = a0 + (a1 - a0) * i / (n - 1);
    const rr = r * (1 + (rnd() - 0.5) * 2 * j);
    pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr, 0.7 + rnd() * 0.8, 0.4 + rnd() * 0.6]);
  }
  return pts;
}
function linePts(x0, y0, x1, y1, n, j = 0, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push([
      x0 + (x1 - x0) * t + (rnd() - 0.5) * j,
      y0 + (y1 - y0) * t + (rnd() - 0.5) * j,
      0.6 + rnd() * 0.9, 0.35 + rnd() * 0.65,
    ]);
  }
  return pts;
}
function polylinePts(path, n, j = 0, rnd = Math.random) {
  // path: [[x,y],...] — 均匀采样折线
  const segs = []; let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    segs.push(d); total += d;
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    let d = total * i / (n - 1), k = 0;
    while (k < segs.length - 1 && d > segs[k]) { d -= segs[k]; k++; }
    const t = segs[k] > 0 ? d / segs[k] : 0;
    pts.push([
      path[k][0] + (path[k + 1][0] - path[k][0]) * t + (rnd() - 0.5) * j,
      path[k][1] + (path[k + 1][1] - path[k][1]) * t + (rnd() - 0.5) * j,
      0.6 + rnd() * 0.9, 0.4 + rnd() * 0.6,
    ]);
  }
  return pts;
}
function bezierPts(p0, p1, p2, p3, n, j = 0, rnd = Math.random) {
  const path = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    path.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return polylinePts(path, n, j, rnd);
}
function lemniscatePts(cx, cy, w, n, j = 0, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = TAU * i / n;
    const d = 1 + Math.sin(t) * Math.sin(t);
    pts.push([cx + w * Math.cos(t) / d, cy + w * Math.cos(t) * Math.sin(t) / d * 0.55, 0.7 + rnd() * 0.8, 0.5 + rnd() * 0.5]);
  }
  return pts;
}
function spiralPts(cx, cy, r, turns, n, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = turns * TAU * i / n;
    const rr = r * i / n;
    pts.push([cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * 0.8, 0.6 + rnd() * 0.9, 0.3 + (i / n) * 0.7]);
  }
  return pts;
}
function rayPts(cx, cy, n, r0, r1, rnd = Math.random, wavy = false) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = TAU * i / n - Math.PI / 2;
    const len = r0 + (r1 - r0) * rnd();
    for (let k = 0; k <= 5; k++) {
      const t = k / 5, rr = r0 + (len - r0) * t;
      const wob = wavy ? Math.sin(t * Math.PI * 2) * 4 : 0;
      pts.push([cx + Math.cos(a) * rr + wob * Math.sin(a), cy + Math.sin(a) * rr - wob * Math.cos(a), 0.5 + t * 0.5, 0.5 * (1 - t) + 0.2]);
    }
  }
  return pts;
}
function starPts(cx, cy, rO, rI, points, n, j = 0.004, rnd = Math.random) {
  const path = [];
  for (let i = 0; i <= points * 2; i++) {
    const a = TAU * i / (points * 2) - Math.PI / 2;
    const r = i % 2 === 0 ? rO : rI;
    path.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return polylinePts(path, n, j * PW, rnd);
}
function scatterPts(cx, cy, rx, ry, n, rnd = Math.random) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, rr = Math.sqrt(rnd());
    pts.push([cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr, 0.4 + rnd() * 0.8, 0.15 + rnd() * 0.5]);
  }
  return pts;
}

// ---- 星座 / 行星符徽（参数折线，单位以 s 缩放） ------------------------------
function circlePath(cx, cy, r, a0 = 0, a1 = TAU) {
  const p = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const a = a0 + (a1 - a0) * i / N;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return p;
}
function sigilPaths(name, cx, cy, s) {
  const P = [];
  const add = (...segs) => segs.forEach(x => P.push(x));
  switch (name) {
    case '太阳': add(circlePath(cx, cy, s), [[cx - s * 0.18, cy], [cx + s * 0.18, cy]], [[cx, cy - s * 0.18], [cx, cy + s * 0.18]]); break;
    case '月亮': add(circlePath(cx, cy, s, TAU * 0.15, TAU * 1.35), circlePath(cx - s * 0.42, cy, s * 0.82, TAU * 0.62, TAU * 1.38)); break;
    case '水星': add(circlePath(cx, cy - s * 0.25, s * 0.5), [[cx, cy + s * 0.25], [cx, cy + s * 0.85]], [[cx - s * 0.4, cy + s * 0.85], [cx + s * 0.4, cy + s * 0.85]], circlePath(cx, cy - s * 0.95, s * 0.3, TAU * 0.75, TAU * 1.75)); break;
    case '金星': add(circlePath(cx, cy - s * 0.3, s * 0.55), [[cx, cy + s * 0.25], [cx, cy + s * 0.9]], [[cx - s * 0.4, cy + s * 0.55], [cx + s * 0.4, cy + s * 0.55]]); break;
    case '火星': add(circlePath(cx, cy + s * 0.2, s * 0.55), [[cx + s * 0.38, cy - s * 0.18], [cx + s * 0.85, cy - s * 0.65]], [[cx + s * 0.85, cy - s * 0.65], [cx + s * 0.45, cy - s * 0.65]], [[cx + s * 0.85, cy - s * 0.65], [cx + s * 0.85, cy - s * 0.25]]); break;
    case '木星': add([[cx - s * 0.5, cy - s * 0.7], [cx - s * 0.1, cy - s * 0.7]], circlePath(cx - s * 0.3, cy - s * 0.35, s * 0.4, -TAU * 0.05, TAU * 0.45), [[cx + s * 0.1, cy + s * 0.05], [cx + s * 0.1, cy + s * 0.8]], [[cx - s * 0.35, cy + s * 0.8], [cx + s * 0.45, cy + s * 0.8]]); break;
    case '土星': add([[cx - s * 0.45, cy - s * 0.75], [cx + s * 0.35, cy - s * 0.75]], [[cx, cy - s * 0.75], [cx, cy + s * 0.1]], bezierPts([cx, cy + s * 0.1], [cx, cy + s * 0.75], [cx + s * 0.6, cy + s * 0.75], [cx + s * 0.6, cy + s * 0.25], 14)); break;
    case '天王星': add(circlePath(cx, cy + s * 0.25, s * 0.45), [[cx, cy - s * 0.75], [cx, cy - s * 0.2]], [[cx - s * 0.5, cy - s * 0.75], [cx - s * 0.5, cy - s * 0.35]], [[cx + s * 0.5, cy - s * 0.75], [cx + s * 0.5, cy - s * 0.35]]); break;
    case '海王星': add([[cx, cy - s * 0.8], [cx, cy + s * 0.8]], [[cx - s * 0.4, cy + s * 0.35], [cx + s * 0.4, cy + s * 0.35]], bezierPts([cx - s * 0.5, cy - s * 0.2], [cx - s * 0.55, cy - s * 0.85], [cx - s * 0.15, cy - s * 0.8], [cx, cy - s * 0.8], 12), bezierPts([cx + s * 0.5, cy - s * 0.2], [cx + s * 0.55, cy - s * 0.85], [cx + s * 0.15, cy - s * 0.8], [cx, cy - s * 0.8], 12)); break;
    case '冥王星': add(circlePath(cx, cy - s * 0.25, s * 0.45), circlePath(cx, cy - s * 0.62, s * 0.55, TAU * 0.6, TAU * 1.4), [[cx - s * 0.3, cy + s * 0.55], [cx - s * 0.3, cy + s * 0.9]], [[cx + s * 0.3, cy + s * 0.55], [cx + s * 0.3, cy + s * 0.9]], [[cx - s * 0.3, cy + s * 0.72], [cx + s * 0.3, cy + s * 0.72]]); break;
    case '白羊座': add(bezierPts([cx, cy + s * 0.6], [cx, cy - s * 0.2], [cx - s * 0.9, cy - s * 0.9], [cx - s * 0.9, cy - s * 0.1], 16), bezierPts([cx, cy + s * 0.6], [cx, cy - s * 0.2], [cx + s * 0.9, cy - s * 0.9], [cx + s * 0.9, cy - s * 0.1], 16)); break;
    case '金牛座': add(circlePath(cx, cy + s * 0.2, s * 0.55), bezierPts([cx - s * 0.5, cy - s * 0.1], [cx - s * 0.85, cy - s * 0.4], [cx - s * 0.75, cy - s * 0.85], [cx - s * 0.3, cy - s * 0.55], 14), bezierPts([cx + s * 0.5, cy - s * 0.1], [cx + s * 0.85, cy - s * 0.4], [cx + s * 0.75, cy - s * 0.85], [cx + s * 0.3, cy - s * 0.55], 14)); break;
    case '双子座': add([[cx - s * 0.45, cy - s * 0.8], [cx - s * 0.45, cy + s * 0.8]], [[cx + s * 0.45, cy - s * 0.8], [cx + s * 0.45, cy + s * 0.8]], [[cx - s * 0.55, cy - s * 0.8], [cx + s * 0.55, cy - s * 0.8]], [[cx - s * 0.55, cy + s * 0.8], [cx + s * 0.55, cy + s * 0.8]]); break;
    case '巨蟹座': add(bezierPts([cx + s * 0.35, cy - s * 0.7], [cx - s * 0.55, cy - s * 0.7], [cx - s * 0.55, cy + s * 0.55], [cx + s * 0.05, cy + s * 0.2], 18), circlePath(cx + s * 0.42, cy + s * 0.32, s * 0.4, TAU * 0.55, TAU * 1.55), bezierPts([cx - s * 0.35, cy + s * 0.7], [cx + s * 0.55, cy + s * 0.7], [cx + s * 0.55, cy - s * 0.55], [cx - s * 0.05, cy - s * 0.2], 18)); break;
    case '狮子座': add(circlePath(cx - s * 0.15, cy + s * 0.1, s * 0.5), bezierPts([cx + s * 0.3, cy + s * 0.05], [cx + s * 0.75, cy - s * 0.3], [cx + s * 0.75, cy - s * 0.6], [cx + s * 0.35, cy - s * 0.75], 16), bezierPts([cx + s * 0.35, cy - s * 0.75], [cx - s * 0.05, cy - s * 0.85], [cx + s * 0.1, cy - s * 0.45], [cx + s * 0.3, cy - s * 0.3], 14)); break;
    case '处女座': add([[cx - s * 0.55, cy - s * 0.5], [cx - s * 0.55, cy + s * 0.65]], bezierPts([cx - s * 0.55, cy - s * 0.5], [cx - s * 0.55, cy - s * 0.95], [cx + s * 0.05, cy - s * 0.95], [cx + s * 0.05, cy - s * 0.45], 16), [[cx + s * 0.05, cy - s * 0.45], [cx + s * 0.05, cy + s * 0.65]], bezierPts([cx + s * 0.05, cy - s * 0.5], [cx + s * 0.05, cy - s * 0.95], [cx + s * 0.62, cy - s * 0.95], [cx + s * 0.62, cy - s * 0.3], 16), bezierPts([cx + s * 0.62, cy - s * 0.3], [cx + s * 0.62, cy + s * 0.4], [cx + s * 0.25, cy + s * 0.55], [cx + s * 0.05, cy + s * 0.2], 16)); break;
    case '天秤座': add([[cx - s * 0.7, cy + s * 0.55], [cx + s * 0.7, cy + s * 0.55]], bezierPts([cx - s * 0.55, cy + s * 0.55], [cx - s * 0.55, cy - s * 0.85], [cx + s * 0.55, cy - s * 0.85], [cx + s * 0.55, cy + s * 0.55], 22)); break;
    case '天蝎座': add([[cx - s * 0.6, cy - s * 0.75], [cx - s * 0.6, cy + s * 0.3]], bezierPts([cx - s * 0.6, cy - s * 0.75], [cx - s * 0.6, cy - s * 0.15], [cx - s * 0.05, cy - s * 0.15], [cx - s * 0.05, cy + s * 0.3], 16), [[cx - s * 0.05, cy - s * 0.75], [cx - s * 0.05, cy + s * 0.3]], bezierPts([cx + s * 0.5, cy - s * 0.15], [cx + s * 0.5, cy + s * 0.5], [cx + s * 0.1, cy + s * 0.55], [cx + s * 0.3, cy + s * 0.85], 18), [[cx + s * 0.3, cy + s * 0.85], [cx + s * 0.5, cy + s * 0.95]]); break;
    case '射手座': add([[cx - s * 0.6, cy + s * 0.75], [cx + s * 0.6, cy - s * 0.6]], [[cx + s * 0.05, cy - s * 0.6], [cx + s * 0.6, cy - s * 0.6]], [[cx + s * 0.6, cy - s * 0.05], [cx + s * 0.6, cy - s * 0.6]], [[cx - s * 0.25, cy + s * 0.05], [cx + s * 0.25, cy - s * 0.35]]); break;
    case '摩羯座': add(bezierPts([cx - s * 0.55, cy - s * 0.8], [cx - s * 0.2, cy - s * 0.8], [cx - s * 0.05, cy - s * 0.3], [cx - s * 0.05, cy + s * 0.3], 18), bezierPts([cx - s * 0.55, cy - s * 0.8], [cx - s * 0.9, cy - s * 0.4], [cx - s * 0.85, cy - s * 0.05], [cx - s * 0.6, cy - s * 0.15], 14), bezierPts([cx - s * 0.05, cy + s * 0.3], [cx - s * 0.05, cy + s * 0.85], [cx + s * 0.65, cy + s * 0.85], [cx + s * 0.45, cy + s * 0.25], 18)); break;
    case '水瓶座': add(polylinePts([[cx - s * 0.7, cy - s * 0.35], [cx - s * 0.35, cy - s * 0.65], [cx, cy - s * 0.35], [cx + s * 0.35, cy - s * 0.65], [cx + s * 0.7, cy - s * 0.35]], 22), polylinePts([[cx - s * 0.7, cy + s * 0.45], [cx - s * 0.35, cy + s * 0.15], [cx, cy + s * 0.45], [cx + s * 0.35, cy + s * 0.15], [cx + s * 0.7, cy + s * 0.45]], 22)); break;
    case '双鱼座': add(bezierPts([cx - s * 0.15, cy - s * 0.75], [cx - s * 0.85, cy - s * 0.4], [cx - s * 0.85, cy + s * 0.4], [cx - s * 0.15, cy + s * 0.75], 20), bezierPts([cx + s * 0.15, cy - s * 0.75], [cx + s * 0.85, cy - s * 0.4], [cx + s * 0.85, cy + s * 0.4], [cx + s * 0.15, cy + s * 0.75], 20), [[cx - s * 0.15, cy], [cx + s * 0.15, cy]]); break;
    case '火': add([[cx, cy - s * 0.75], [cx - s * 0.7, cy + s * 0.6]], [[cx, cy - s * 0.75], [cx + s * 0.7, cy + s * 0.6]], [[cx - s * 0.7, cy + s * 0.6], [cx + s * 0.7, cy + s * 0.6]]); break;
    case '水': add([[cx, cy + s * 0.75], [cx - s * 0.7, cy - s * 0.6]], [[cx, cy + s * 0.75], [cx + s * 0.7, cy - s * 0.6]], [[cx - s * 0.7, cy - s * 0.6], [cx + s * 0.7, cy - s * 0.6]]); break;
    case '风': add([[cx, cy - s * 0.7], [cx - s * 0.65, cy + s * 0.55]], [[cx, cy - s * 0.7], [cx + s * 0.65, cy + s * 0.55]], [[cx - s * 0.65, cy + s * 0.55], [cx + s * 0.65, cy + s * 0.55]], [[cx - s * 0.4, cy + s * 0.2], [cx + s * 0.4, cy + s * 0.2]]); break;
    case '土': add([[cx, cy + s * 0.7], [cx - s * 0.65, cy - s * 0.55]], [[cx, cy + s * 0.7], [cx + s * 0.65, cy - s * 0.55]], [[cx - s * 0.65, cy - s * 0.55], [cx + s * 0.65, cy - s * 0.55]], [[cx - s * 0.4, cy - s * 0.2], [cx + s * 0.4, cy - s * 0.2]]); break;
    default: add(circlePath(cx, cy, s * 0.6));
  }
  return P;
}
function paintSigil(g, name, cx, cy, s, color, rnd, dotN = 3) {
  for (const seg of sigilPaths(name, cx, cy, s)) {
    if (seg.length === 2) {
      dots(g, linePts(seg[0][0], seg[0][1], seg[1][0], seg[1][1], Math.max(6, Math.round(Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) / 7)), 1.6, rnd), color, 1.5);
    } else {
      dots(g, polylinePts(seg, Math.max(10, Math.round(seg.reduce((a, p, i, arr) => i ? a + Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) : 0, 0) / 7)), 1.8, rnd), color, 1.5);
    }
    void dotN;
  }
}

// ---- 花色符文 --------------------------------------------------------------
function suitGlyphPts(suit, cx, cy, s, rnd) {
  const pts = [];
  const put = arr => pts.push(...arr);
  if (suit === 'wands') {
    put(bezierPts([cx, cy + s], [cx - s * 0.12, cy + s * 0.3], [cx - s * 0.1, cy - s * 0.3], [cx, cy - s], 30, 1.5, rnd));
    put(bezierPts([cx - s * 0.02, cy - s * 0.45], [cx - s * 0.5, cy - s * 0.65], [cx - s * 0.55, cy - s * 1.05], [cx - s * 0.1, cy - s * 0.95], 16, 1.2, rnd));
    put(bezierPts([cx + s * 0.02, cy - s * 0.2], [cx + s * 0.5, cy - s * 0.4], [cx + s * 0.55, cy - s * 0.8], [cx + s * 0.1, cy - s * 0.7], 16, 1.2, rnd));
    put(bezierPts([cx + s * 0.02, cy + s * 0.35], [cx + s * 0.45, cy + s * 0.2], [cx + s * 0.5, cy + s * 0.6], [cx + s * 0.08, cy + s * 0.6], 14, 1.2, rnd));
  } else if (suit === 'cups') {
    put(arcPts(cx, cy - s * 0.35, s * 0.62, 0, Math.PI, 26, 0.02, rnd));
    put(linePts(cx - s * 0.62, cy - s * 0.35, cx + s * 0.62, cy - s * 0.35, 12, 1, rnd));
    put(linePts(cx, cy + s * 0.27, cx, cy + s * 0.62, 8, 1, rnd));
    put(arcPts(cx, cy + s * 0.62, s * 0.34, Math.PI, TAU, 14, 0.02, rnd));
    put(ringPts(cx - s * 0.2, cy - s * 0.55, s * 0.05, 4, 0.2, rnd));
  } else if (suit === 'swords') {
    put(polylinePts([[cx - s * 0.07, cy - s * 0.95], [cx, cy - s * 1.15], [cx + s * 0.07, cy - s * 0.95], [cx + s * 0.07, cy + s * 0.25], [cx - s * 0.07, cy + s * 0.25], [cx - s * 0.07, cy - s * 0.95]], 34, 1.2, rnd));
    put(linePts(cx - s * 0.5, cy + s * 0.32, cx + s * 0.5, cy + s * 0.32, 14, 1, rnd));
    put(linePts(cx, cy + s * 0.38, cx, cy + s * 0.78, 8, 1, rnd));
    put(ringPts(cx, cy + s * 0.92, s * 0.13, 10, 0.04, rnd));
  } else {
    put(ringPts(cx, cy, s * 0.72, 40, 0.015, rnd));
    put(starPts(cx, cy, s * 0.6, s * 0.24, 5, 44, 0.006, rnd));
    put(scatterPts(cx, cy, s * 0.2, s * 0.2, 8, rnd));
  }
  return pts;
}

// ---- 大阿卡纳 22 构图（归一化坐标 u,v ∈ [0,1]） -----------------------------
const U = u => u * PW, V = v => v * PH;

const MAJOR_MOTIFS = {
  M00(rnd) {
    return [
      { pts: rayPts(U(0.72), V(0.14), 16, 14, 52, rnd), c: 'sun' },
      { pts: ringPts(U(0.72), V(0.14), 22, 16, 0.05, rnd), c: 'sun' },
      { pts: polylinePts([[U(0.18), V(0.6)], [U(0.34), V(0.52)], [U(0.5), V(0.6)], [U(0.68), V(0.5)], [U(0.84), V(0.58)]], 40, 1.5, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.86), V(0.62)], [U(0.86), V(0.88)], [U(0.5), V(0.88)], [U(0.5), V(0.66)]], 46, 1.5, rnd), c: 'gold' },
      { pts: scatterPts(U(0.45), V(0.35), 0.3 * PW, 0.26 * PH, 90, rnd), c: 'dust' },
      { pts: spiralPts(U(0.38), V(0.75), 60, 2.2, 60, rnd), c: 'soft' },
    ];
  },
  M01(rnd) {
    return [
      { pts: lemniscatePts(U(0.5), V(0.17), 62, 90, 0.008, rnd), c: 'gold' },
      { pts: linePts(U(0.5), V(0.3), U(0.5), V(0.72), 30, 1.5, rnd), c: 'gold' },
      { pts: [...linePts(U(0.16), V(0.24), U(0.44), V(0.44), 16, 1.2, rnd), ...linePts(U(0.84), V(0.24), U(0.56), V(0.44), 16, 1.2, rnd), ...linePts(U(0.16), V(0.78), U(0.44), V(0.58), 16, 1.2, rnd), ...linePts(U(0.84), V(0.78), U(0.56), V(0.58), 16, 1.2, rnd)], c: 'soft' },
      { pts: ringPts(U(0.5), V(0.84), 34, 24, 0.03, rnd), c: 'gold' },
      { pts: starPts(U(0.5), V(0.84), 20, 8, 5, 24, 0.006, rnd), c: 'sun' },
    ];
  },
  M02(rnd) {
    return [
      { pts: linePts(U(0.22), V(0.2), U(0.22), V(0.78), 34, 2, rnd), c: 'ivory' },
      { pts: linePts(U(0.78), V(0.2), U(0.78), V(0.78), 34, 2, rnd), c: 'ivory' },
      { pts: bezierPts([U(0.28), V(0.24)], [U(0.4), V(0.36)], [U(0.6), V(0.36)], [U(0.72), V(0.24)], 30, 1.5, rnd), c: 'moon' },
      { pts: arcPts(U(0.5), V(0.8), 54, Math.PI, TAU, 30, 0.02, rnd), c: 'moon' },
      { pts: arcPts(U(0.5), V(0.8), 40, Math.PI, TAU, 22, 0.02, rnd), c: 'moon' },
      { pts: ringPts(U(0.5), V(0.13), 26, 18, 0.03, rnd), c: 'sun' },
      { pts: scatterPts(U(0.5), V(0.55), 0.24 * PW, 0.16 * PH, 70, rnd), c: 'dust' },
    ];
  },
  M03(rnd) {
    return [
      { pts: ringPts(U(0.5), V(0.15), 30, 20, 0.04, rnd), c: 'gold' },
      { pts: paintSigilCollect('金星', U(0.5), V(0.42), 52, rnd), c: 'gold' },
      { pts: arcPts(U(0.5), V(0.5), 120, Math.PI * 0.15, Math.PI * 0.85, 40, 0.03, rnd), c: 'soft' },
      { pts: scatterPts(U(0.5), V(0.78), 0.34 * PW, 0.12 * PH, 110, rnd), c: 'leaf' },
      { pts: linePts(U(0.14), V(0.7), U(0.86), V(0.7), 20, 2, rnd), c: 'gold' },
    ];
  },
  M04(rnd) {
    return [
      { pts: polylinePts([[U(0.32), V(0.3)], [U(0.32), V(0.66)], [U(0.68), V(0.66)], [U(0.68), V(0.3)], [U(0.32), V(0.3)]], 52, 1.5, rnd), c: 'gold' },
      { pts: arcPts(U(0.38), V(0.34), 20, Math.PI * 0.9, Math.PI * 2.1, 18, 0.03, rnd), c: 'gold' },
      { pts: arcPts(U(0.62), V(0.34), 20, Math.PI * 0.9, Math.PI * 2.1, 18, 0.03, rnd), c: 'gold' },
      { pts: paintSigilCollect('白羊座', U(0.5), V(0.17), 34, rnd), c: 'sun' },
      { pts: polylinePts([[U(0.1), V(0.78)], [U(0.26), V(0.66)], [U(0.44), V(0.78)], [U(0.62), V(0.64)], [U(0.8), V(0.76)], [U(0.92), V(0.68)]], 50, 1.5, rnd), c: 'soft' },
      { pts: scatterPts(U(0.5), V(0.85), 0.36 * PW, 0.06 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M05(rnd) {
    return [
      { pts: linePts(U(0.5), V(0.14), U(0.5), V(0.4), 18, 1.2, rnd), c: 'gold' },
      { pts: linePts(U(0.36), V(0.22), U(0.64), V(0.22), 14, 1.2, rnd), c: 'gold' },
      { pts: linePts(U(0.32), V(0.31), U(0.68), V(0.31), 16, 1.2, rnd), c: 'gold' },
      { pts: linePts(U(0.42), V(0.42), U(0.42), V(0.6), 10, 1.2, rnd), c: 'ivory' },
      { pts: linePts(U(0.58), V(0.42), U(0.58), V(0.6), 10, 1.2, rnd), c: 'ivory' },
      { pts: linePts(U(0.42), V(0.6), U(0.32), V(0.75), 10, 1.2, rnd), c: 'ivory' },
      { pts: linePts(U(0.58), V(0.6), U(0.68), V(0.75), 10, 1.2, rnd), c: 'ivory' },
      { pts: ringPts(U(0.34), V(0.78), 7, 8, 0.1, rnd), c: 'soft' },
      { pts: ringPts(U(0.66), V(0.78), 7, 8, 0.1, rnd), c: 'soft' },
      { pts: arcPts(U(0.5), V(0.88), 46, Math.PI, TAU, 26, 0.02, rnd), c: 'gold' },
    ];
  },
  M06(rnd) {
    return [
      { pts: ringPts(U(0.5), V(0.13), 30, 20, 0.03, rnd), c: 'sun' },
      { pts: rayPts(U(0.5), V(0.13), 12, 34, 58, rnd), c: 'sun' },
      { pts: arcPts(U(0.5), V(0.32), 74, Math.PI * 1.15, Math.PI * 1.85, 26, 0.02, rnd), c: 'gold' },
      { pts: ringPts(U(0.36), V(0.52), 12, 10, 0.05, rnd), c: 'gold' },
      { pts: ringPts(U(0.64), V(0.52), 12, 10, 0.05, rnd), c: 'gold' },
      { pts: bezierPts([U(0.72), V(0.44)], [U(0.78), V(0.56)], [U(0.66), V(0.68)], [U(0.72), V(0.8)], 24, 1.5, rnd), c: 'leaf' },
      { pts: starPts(U(0.26), V(0.62), 26, 10, 5, 30, 0.008, rnd), c: 'leaf' },
      { pts: scatterPts(U(0.5), V(0.9), 0.3 * PW, 0.05 * PH, 46, rnd), c: 'dust' },
    ];
  },
  M07(rnd) {
    return [
      { pts: arcPts(U(0.5), V(0.2), 46, Math.PI * 1.05, Math.PI * 1.95, 18, 0.02, rnd), c: 'gold' },
      { pts: starPts(U(0.5), V(0.13), 13, 5, 5, 20, 0.006, rnd), c: 'sun' },
      { pts: arcPts(U(0.38), V(0.42), 16, Math.PI * 0.2, Math.PI * 1.8, 16, 0.02, rnd), c: 'moon' },
      { pts: arcPts(U(0.62), V(0.42), 16, Math.PI * 0.2, Math.PI * 1.8, 16, 0.02, rnd), c: 'moon' },
      { pts: polylinePts([[U(0.3), V(0.55)], [U(0.3), V(0.78)], [U(0.7), V(0.78)], [U(0.7), V(0.55)], [U(0.3), V(0.55)]], 44, 1.5, rnd), c: 'gold' },
      { pts: ringPts(U(0.38), V(0.86), 14, 12, 0.03, rnd), c: 'ivory' },
      { pts: ringPts(U(0.62), V(0.86), 14, 12, 0.03, rnd), c: 'ivory' },
      { pts: linePts(U(0.16), V(0.5), U(0.16), V(0.8), 14, 1.5, rnd), c: 'soft' },
      { pts: linePts(U(0.84), V(0.5), U(0.84), V(0.8), 14, 1.5, rnd), c: 'soft' },
    ];
  },
  M08(rnd) {
    return [
      { pts: lemniscatePts(U(0.5), V(0.18), 56, 90, 0.008, rnd), c: 'sun' },
      { pts: arcPts(U(0.5), V(0.52), 90, Math.PI * 1.05, Math.PI * 1.95, 30, 0.03, rnd), c: 'gold' },
      { pts: ringPts(U(0.5), V(0.6), 56, 34, 0.05, rnd), c: 'gold' },
      { pts: [...arcPts(U(0.42), V(0.58), 10, 0, TAU, 10, 0.05, rnd), ...linePts(U(0.3), V(0.72), U(0.44), V(0.68), 10, 1, rnd), ...linePts(U(0.62), V(0.44), U(0.72), V(0.52), 10, 1, rnd)], c: 'soft' },
      { pts: scatterPts(U(0.5), V(0.85), 0.3 * PW, 0.06 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M09(rnd) {
    return [
      { pts: starPts(U(0.5), V(0.2), 30, 13, 6, 42, 0.006, rnd), c: 'sun' },
      { pts: ringPts(U(0.5), V(0.2), 40, 24, 0.03, rnd), c: 'gold' },
      { pts: linePts(U(0.68), V(0.3), U(0.68), V(0.86), 30, 1.5, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.08), V(0.86)], [U(0.24), V(0.72)], [U(0.38), V(0.84)], [U(0.54), V(0.7)], [U(0.92), V(0.88)]], 44, 1.5, rnd), c: 'soft' },
      { pts: scatterPts(U(0.3), V(0.55), 0.2 * PW, 0.2 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M10(rnd) {
    return [
      { pts: ringPts(U(0.5), V(0.44), 130, 60, 0.015, rnd), c: 'gold' },
      { pts: ringPts(U(0.5), V(0.44), 84, 40, 0.02, rnd), c: 'moon' },
      { pts: ringPts(U(0.5), V(0.44), 30, 20, 0.03, rnd), c: 'gold' },
      { pts: [...linePts(U(0.5) - 130, V(0.44), U(0.5) + 130, V(0.44), 24, 1.5, rnd), ...linePts(U(0.5), V(0.44) - 130, U(0.5), V(0.44) + 130, 24, 1.5, rnd)], c: 'gold' },
      { pts: polylinePts([[U(0.5) + 92 * Math.cos(-2.3), V(0.44) + 92 * Math.sin(-2.3)], [U(0.5) + 60 * Math.cos(-2.0), V(0.44) + 60 * Math.sin(-2.0)], [U(0.5) + 96 * Math.cos(-1.7), V(0.44) + 96 * Math.sin(-1.7)]], 16, 1.2, rnd), c: 'ivory' },
      { pts: polylinePts([[U(0.5) + 92 * Math.cos(0.85), V(0.44) + 92 * Math.sin(0.85)], [U(0.5) + 60 * Math.cos(1.15), V(0.44) + 60 * Math.sin(1.15)], [U(0.5) + 96 * Math.cos(1.45), V(0.44) + 96 * Math.sin(1.45)]], 16, 1.2, rnd), c: 'ivory' },
      { pts: starPts(U(0.5), V(0.44), 200, 168, 4, 40, 0.01, rnd), c: 'soft' },
    ];
  },
  M11(rnd) {
    return [
      { pts: linePts(U(0.5), V(0.16), U(0.5), V(0.84), 40, 1.5, rnd), c: 'gold' },
      { pts: linePts(U(0.24), V(0.32), U(0.76), V(0.32), 24, 1.5, rnd), c: 'gold' },
      { pts: [linePts(U(0.24), V(0.32), U(0.24), V(0.52), 10, 1.2, rnd), linePts(U(0.76), V(0.32), U(0.76), V(0.52), 10, 1.2, rnd)].flat(), c: 'gold' },
      { pts: arcPts(U(0.24), V(0.56), 22, Math.PI, TAU, 16, 0.02, rnd), c: 'moon' },
      { pts: arcPts(U(0.76), V(0.56), 22, Math.PI, TAU, 16, 0.02, rnd), c: 'moon' },
      { pts: polylinePts([[U(0.3), V(0.2)], [U(0.3), V(0.14)], [U(0.7), V(0.14)], [U(0.7), V(0.2)]], 20, 1.2, rnd), c: 'gold' },
      { pts: linePts(U(0.18), V(0.88), U(0.82), V(0.88), 20, 1.5, rnd), c: 'soft' },
    ];
  },
  M12(rnd) {
    return [
      { pts: linePts(U(0.2), V(0.26), U(0.8), V(0.26), 24, 1.5, rnd), c: 'gold' },
      { pts: linePts(U(0.5), V(0.26), U(0.5), V(0.36), 8, 1, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.44), V(0.38)], [U(0.56), V(0.38)], [U(0.5), V(0.36)]], 10, 1, rnd), c: 'gold' },
      { pts: linePts(U(0.44), V(0.4), U(0.44), V(0.62), 12, 1.2, rnd), c: 'ivory' },
      { pts: linePts(U(0.56), V(0.4), U(0.56), V(0.62), 12, 1.2, rnd), c: 'ivory' },
      { pts: linePts(U(0.44), V(0.62), U(0.56), V(0.66), 8, 1, rnd), c: 'ivory' },
      { pts: linePts(U(0.56), V(0.62), U(0.44), V(0.66), 8, 1, rnd), c: 'ivory' },
      { pts: ringPts(U(0.5), V(0.74), 20, 14, 0.03, rnd), c: 'sun' },
      { pts: arcPts(U(0.5), V(0.9), 60, Math.PI * 1.1, Math.PI * 1.9, 22, 0.02, rnd), c: 'soft' },
      { pts: scatterPts(U(0.2), V(0.75), 0.12 * PW, 0.14 * PH, 40, rnd), c: 'dust' },
    ];
  },
  M13(rnd) {
    return [
      { pts: polylinePts([[U(0.3), V(0.8)], [U(0.68), V(0.3)]], 30, 1.5, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.62), V(0.28)], [U(0.86), V(0.36)], [U(0.84), V(0.5)], [U(0.6), V(0.42)]], 34, 1.5, rnd), c: 'rose' },
      { pts: starPts(U(0.73), V(0.4), 16, 6, 5, 24, 0.008, rnd), c: 'rose' },
      { pts: polylinePts([[U(0.18), V(0.72)], [U(0.3), V(0.72)], [U(0.3), V(0.8)], [U(0.18), V(0.8)]], 20, 1.2, rnd), c: 'ivory' },
      { pts: polylinePts([[U(0.7), V(0.72)], [U(0.82), V(0.72)], [U(0.82), V(0.8)], [U(0.7), V(0.8)]], 20, 1.2, rnd), c: 'ivory' },
      { pts: arcPts(U(0.5), V(0.92), 40, Math.PI * 1.15, Math.PI * 1.85, 20, 0.02, rnd), c: 'sun' },
      { pts: rayPts(U(0.5), V(0.94), 9, 42, 66, rnd), c: 'sun' },
      { pts: scatterPts(U(0.5), V(0.55), 0.3 * PW, 0.24 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M14(rnd) {
    return [
      { pts: ringPts(U(0.5), V(0.14), 24, 16, 0.03, rnd), c: 'sun' },
      { pts: arcPts(U(0.34), V(0.5), 20, Math.PI, TAU, 14, 0.02, rnd), c: 'gold' },
      { pts: linePts(U(0.14), V(0.5), U(0.54), V(0.5), 10, 1, rnd), c: 'gold' },
      { pts: arcPts(U(0.66), V(0.62), 20, Math.PI, TAU, 14, 0.02, rnd), c: 'gold' },
      { pts: linePts(U(0.46), V(0.62), U(0.86), V(0.62), 10, 1, rnd), c: 'gold' },
      { pts: bezierPts([U(0.34), V(0.52)], [U(0.44), V(0.56)], [U(0.56), V(0.56)], [U(0.66), V(0.54)], 26, 1.5, rnd), c: 'moon' },
      { pts: paintSigilCollect('火', U(0.5), V(0.36), 22, rnd), c: 'gold' },
      { pts: scatterPts(U(0.3), V(0.82), 0.24 * PW, 0.08 * PH, 50, rnd), c: 'leaf' },
      { pts: scatterPts(U(0.72), V(0.86), 0.2 * PW, 0.06 * PH, 40, rnd), c: 'iris' },
    ];
  },
  M15(rnd) {
    return [
      { pts: starPts(U(0.5), V(0.2), 40, 16, 5, 52, 0.008, rnd), c: 'ember' },
      { pts: ringPts(U(0.5), V(0.2), 52, 30, 0.03, rnd), c: 'ember' },
      { pts: bezierPts([U(0.4), V(0.52)], [U(0.36), V(0.44)], [U(0.3), V(0.44)], [U(0.32), V(0.52)], 16, 1.2, rnd), c: 'gold' },
      { pts: bezierPts([U(0.6), V(0.52)], [U(0.64), V(0.44)], [U(0.7), V(0.44)], [U(0.68), V(0.52)], 16, 1.2, rnd), c: 'gold' },
      { pts: arcPts(U(0.5), V(0.62), 30, Math.PI * 0.1, Math.PI * 0.9, 18, 0.02, rnd), c: 'gold' },
      { pts: ringPts(U(0.38), V(0.78), 12, 10, 0.04, rnd), c: 'ivory' },
      { pts: ringPts(U(0.62), V(0.78), 12, 10, 0.04, rnd), c: 'ivory' },
      { pts: linePts(U(0.38), V(0.66), U(0.38), V(0.9), 12, 1.2, rnd), c: 'soft' },
      { pts: linePts(U(0.62), V(0.66), U(0.62), V(0.9), 12, 1.2, rnd), c: 'soft' },
      { pts: scatterPts(U(0.85), V(0.3), 0.06 * PW, 0.1 * PH, 30, rnd), c: 'ember' },
    ];
  },
  M16(rnd) {
    return [
      { pts: polylinePts([[U(0.38), V(0.84)], [U(0.38), V(0.4)], [U(0.52), V(0.34)], [U(0.52), V(0.84)]], 40, 1.8, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.34), V(0.3)], [U(0.44), V(0.24)], [U(0.4), V(0.18)], [U(0.5), V(0.12)]], 20, 1.2, rnd), c: 'ember' },
      { pts: polylinePts([[U(0.62), V(0.3)], [U(0.68), V(0.36)], [U(0.64), V(0.42)], [U(0.72), V(0.48)]], 18, 1.2, rnd), c: 'ember' },
      { pts: polylinePts([[U(0.1), V(0.06)], [U(0.26), V(0.16)], [U(0.2), V(0.2)], [U(0.34), V(0.3)]], 22, 1.5, rnd), c: 'sun' },
      { pts: ringPts(U(0.3), V(0.3), 9, 8, 0.1, rnd), c: 'ivory' },
      { pts: ringPts(U(0.7), V(0.52), 9, 8, 0.1, rnd), c: 'ivory' },
      { pts: scatterPts(U(0.5), V(0.6), 0.34 * PW, 0.24 * PH, 90, rnd), c: 'ember' },
      { pts: scatterPts(U(0.5), V(0.9), 0.3 * PW, 0.04 * PH, 40, rnd), c: 'dust' },
    ];
  },
  M17(rnd) {
    return [
      { pts: starPts(U(0.5), V(0.24), 52, 21, 8, 72, 0.006, rnd), c: 'sun' },
      { pts: ringPts(U(0.5), V(0.24), 62, 30, 0.03, rnd), c: 'gold' },
      { pts: [...arcPts(U(0.24), V(0.12), 9, 0, TAU, 10, 0.05, rnd), ...arcPts(U(0.36), V(0.07), 7, 0, TAU, 8, 0.05, rnd), ...arcPts(U(0.66), V(0.07), 7, 0, TAU, 8, 0.05, rnd), ...arcPts(U(0.78), V(0.12), 9, 0, TAU, 10, 0.05, rnd), ...arcPts(U(0.16), V(0.22), 7, 0, TAU, 8, 0.05, rnd), ...arcPts(U(0.86), V(0.22), 7, 0, TAU, 8, 0.05, rnd), ...arcPts(U(0.5), V(0.05), 7, 0, TAU, 8, 0.05, rnd)], c: 'moon' },
      { pts: bezierPts([U(0.44), V(0.5)], [U(0.4), V(0.62)], [U(0.42), V(0.7)], [U(0.48), V(0.78)], 24, 1.5, rnd), c: 'moon' },
      { pts: bezierPts([U(0.58), V(0.5)], [U(0.68), V(0.6)], [U(0.7), V(0.68)], [U(0.76), V(0.72)], 22, 1.5, rnd), c: 'moon' },
      { pts: [...arcPts(U(0.6), V(0.84), 44, Math.PI, TAU, 20, 0.02, rnd), ...arcPts(U(0.6), V(0.84), 30, Math.PI, TAU, 14, 0.02, rnd), ...arcPts(U(0.6), V(0.84), 16, Math.PI, TAU, 10, 0.02, rnd)], c: 'moon' },
      { pts: scatterPts(U(0.5), V(0.6), 0.3 * PW, 0.24 * PH, 70, rnd), c: 'dust' },
    ];
  },
  M18(rnd) {
    return [
      { pts: arcPts(U(0.5), V(0.18), 44, Math.PI * 0.55, Math.PI * 1.95, 30, 0.02, rnd), c: 'moon' },
      { pts: arcPts(U(0.38), V(0.18), 34, Math.PI * 0.5, Math.PI * 1.7, 22, 0.02, rnd), c: 'moon' },
      { pts: [...linePts(U(0.36), V(0.3), U(0.34), V(0.44), 10, 1, rnd), ...linePts(U(0.5), V(0.32), U(0.5), V(0.46), 10, 1, rnd), ...linePts(U(0.64), V(0.3), U(0.66), V(0.44), 10, 1, rnd), ...linePts(U(0.28), V(0.34), U(0.25), V(0.48), 10, 1, rnd), ...linePts(U(0.72), V(0.34), U(0.75), V(0.48), 10, 1, rnd), ...linePts(U(0.43), V(0.31), U(0.42), V(0.45), 10, 1, rnd), ...linePts(U(0.57), V(0.31), U(0.58), V(0.45), 10, 1, rnd)], c: 'moon' },
      { pts: polylinePts([[U(0.2), V(0.55)], [U(0.2), V(0.68)], [U(0.28), V(0.68)], [U(0.28), V(0.55)]], 18, 1.2, rnd), c: 'ivory' },
      { pts: polylinePts([[U(0.72), V(0.55)], [U(0.72), V(0.68)], [U(0.8), V(0.68)], [U(0.8), V(0.55)]], 18, 1.2, rnd), c: 'ivory' },
      { pts: polylinePts([[U(0.32), V(0.72)], [U(0.38), V(0.78)], [U(0.46), V(0.8)], [U(0.54), V(0.8)], [U(0.64), V(0.78)], [U(0.68), V(0.72)]], 24, 1.5, rnd), c: 'gold' },
      { pts: ringPts(U(0.5), V(0.88), 10, 8, 0.08, rnd), c: 'moon' },
      { pts: [...linePts(U(0.44), V(0.9), U(0.4), V(0.84), 6, 0.8, rnd), ...linePts(U(0.56), V(0.9), U(0.6), V(0.84), 6, 0.8, rnd)], c: 'moon' },
      { pts: scatterPts(U(0.5), V(0.5), 0.3 * PW, 0.2 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M19(rnd) {
    return [
      { pts: ringPts(U(0.5), V(0.2), 54, 30, 0.02, rnd), c: 'sun' },
      { pts: rayPts(U(0.5), V(0.2), 16, 58, 96, rnd), c: 'sun' },
      { pts: [...linePts(U(0.16), V(0.52), U(0.16), V(0.88), 16, 1.5, rnd), ...linePts(U(0.84), V(0.52), U(0.84), V(0.88), 16, 1.5, rnd), ...linePts(U(0.16), V(0.52), U(0.84), V(0.52), 12, 1.5, rnd)], c: 'gold' },
      { pts: [...ringPts(U(0.3), V(0.6), 14, 12, 0.04, rnd), ...ringPts(U(0.5), V(0.66), 14, 12, 0.04, rnd), ...ringPts(U(0.7), V(0.6), 14, 12, 0.04, rnd), ...ringPts(U(0.4), V(0.78), 14, 12, 0.04, rnd), ...ringPts(U(0.6), V(0.78), 14, 12, 0.04, rnd)], c: 'leaf' },
      { pts: [...arcPts(U(0.5), V(0.9), 26, Math.PI, TAU, 14, 0.02, rnd), ...linePts(U(0.24), V(0.9), U(0.76), V(0.9), 16, 1.2, rnd)], c: 'ivory' },
      { pts: scatterPts(U(0.5), V(0.4), 0.28 * PW, 0.14 * PH, 60, rnd), c: 'dust' },
    ];
  },
  M20(rnd) {
    return [
      { pts: bezierPts([U(0.4), V(0.42)], [U(0.5), V(0.3)], [U(0.66), V(0.26)], [U(0.78), V(0.22)], 26, 1.5, rnd), c: 'gold' },
      { pts: arcPts(U(0.8), V(0.2), 16, Math.PI * 0.75, Math.PI * 2.05, 14, 0.03, rnd), c: 'gold' },
      { pts: polylinePts([[U(0.56), V(0.4)], [U(0.56), V(0.52)], [U(0.66), V(0.52)], [U(0.56), V(0.52)], [U(0.56), V(0.6)], [U(0.46), V(0.6)]], 20, 1.2, rnd), c: 'ivory' },
      { pts: arcPts(U(0.5), V(0.24), 60, Math.PI * 1.1, Math.PI * 1.9, 24, 0.02, rnd), c: 'sun' },
      { pts: [...polylinePts([[U(0.3), V(0.82)], [U(0.3), V(0.7)], [U(0.42), V(0.7)], [U(0.42), V(0.82)]], 18, 1.2, rnd), ...polylinePts([[U(0.44), V(0.82)], [U(0.44), V(0.7)], [U(0.56), V(0.7)], [U(0.56), V(0.82)]], 18, 1.2, rnd), ...polylinePts([[U(0.58), V(0.82)], [U(0.58), V(0.7)], [U(0.7), V(0.7)], [U(0.7), V(0.82)]], 18, 1.2, rnd)], c: 'gold' },
      { pts: [...linePts(U(0.36), V(0.66), U(0.38), V(0.52), 8, 1, rnd), ...linePts(U(0.5), V(0.66), U(0.5), V(0.5), 8, 1, rnd), ...linePts(U(0.64), V(0.66), U(0.62), V(0.52), 8, 1, rnd)], c: 'moon' },
      { pts: scatterPts(U(0.5), V(0.88), 0.3 * PW, 0.04 * PH, 40, rnd), c: 'dust' },
    ];
  },
  M21(rnd) {
    return [
      { pts: arcPts(U(0.5), V(0.48), 150, Math.PI * 0.6, Math.PI * 2.4, 70, 0.015, rnd), c: 'gold' },
      { pts: arcPts(U(0.5), V(0.48), 128, Math.PI * 0.6, Math.PI * 2.4, 54, 0.02, rnd), c: 'gold' },
      { pts: [...linePts(U(0.42), V(0.36), U(0.42), V(0.6), 12, 1.2, rnd), ...linePts(U(0.58), V(0.36), U(0.58), V(0.6), 12, 1.2, rnd)], c: 'ivory' },
      { pts: ringPts(U(0.5), V(0.48), 20, 14, 0.03, rnd), c: 'moon' },
      { pts: [...ringPts(U(0.2), V(0.2), 14, 10, 0.04, rnd), ...ringPts(U(0.8), V(0.2), 14, 10, 0.04, rnd), ...ringPts(U(0.2), V(0.76), 14, 10, 0.04, rnd), ...ringPts(U(0.8), V(0.76), 14, 10, 0.04, rnd)], c: 'soft' },
      { pts: scatterPts(U(0.5), V(0.48), 0.4 * PW, 0.36 * PH, 80, rnd), c: 'dust' },
    ];
  },
};

function paintSigilCollect(name, cx, cy, s, rnd) {
  // 汇总符徽所有折线为粒子点
  const out = [];
  for (const seg of sigilPaths(name, cx, cy, s)) {
    if (seg.length === 2) out.push(...linePts(seg[0][0], seg[0][1], seg[1][0], seg[1][1], Math.max(6, Math.round(Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) / 8)), 1.6, rnd));
    else out.push(...polylinePts(seg, 24, 1.8, rnd));
  }
  return out;
}

// ---- 小阿卡纳牌点布局 -------------------------------------------------------
const PIP_LAYOUTS = {
  1: [[0, 0]],
  2: [[0, -0.52], [0, 0.52]],
  3: [[0, -0.55], [-0.42, 0.4], [0.42, 0.4]],
  4: [[-0.34, -0.45], [0.34, -0.45], [-0.34, 0.45], [0.34, 0.45]],
  5: [[-0.4, -0.52], [0.4, -0.52], [0, 0], [-0.4, 0.52], [0.4, 0.52]],
  6: [[-0.38, -0.62], [0.38, -0.62], [-0.38, 0], [0.38, 0], [-0.38, 0.62], [0.38, 0.62]],
  7: [[0, -0.68], [-0.42, -0.28], [0.42, -0.28], [-0.42, 0.22], [0.42, 0.22], [-0.28, 0.68], [0.28, 0.68]],
  8: [[-0.36, -0.68], [0.36, -0.68], [-0.36, -0.24], [0.36, -0.24], [-0.36, 0.24], [0.36, 0.24], [-0.36, 0.68], [0.36, 0.68]],
  9: [[-0.4, -0.62], [0, -0.62], [0.4, -0.62], [-0.4, 0], [0, 0], [0.4, 0], [-0.4, 0.62], [0, 0.62], [0.4, 0.62]],
  10: [[-0.36, -0.7], [0.36, -0.7], [-0.36, -0.24], [0.36, -0.24], [-0.36, 0.24], [0.36, 0.24], [-0.36, 0.7], [0.36, 0.7], [0, -0.47], [0, 0.47]],
};

// ---- 面板绘制 --------------------------------------------------------------
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function stroke(g, pts, color, width, alpha) {
  g.strokeStyle = color;
  g.globalAlpha = alpha;
  g.lineWidth = width;
  g.beginPath();
  pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
  g.stroke();
  g.globalAlpha = 1;
}

const SUIT_COLORS = {
  wands: { main: '#e0a05c', soft: '#c97b4a', tint: 'rgba(150,84,40,0.20)' },
  cups: { main: '#9db4d8', soft: '#7d94c0', tint: 'rgba(58,80,130,0.20)' },
  swords: { main: '#b9c3cf', soft: '#8e9dad', tint: 'rgba(84,98,120,0.18)' },
  pentacles: { main: '#c8b273', soft: '#a08d58', tint: 'rgba(120,104,52,0.20)' },
};
const C = {
  gold: '#d9b877', sun: '#f0d9a6', moon: '#b9cbe4', ivory: '#e8e0cc',
  soft: '#8d84a8', dust: '#6f6888', leaf: '#a8b585', rose: '#cf8a8a',
  ember: '#d98a5e', iris: '#a89ac8',
};

const PALETTES = {
  M: {
    M00: { a: 'sun', b: 'gold' }, M01: { a: 'gold', b: 'sun' }, M02: { a: 'moon', b: 'gold' },
    M03: { a: 'leaf', b: 'gold' }, M04: { a: 'gold', b: 'ember' }, M05: { a: 'gold', b: 'ivory' },
    M06: { a: 'sun', b: 'leaf' }, M07: { a: 'gold', b: 'moon' }, M08: { a: 'sun', b: 'leaf' },
    M09: { a: 'moon', b: 'gold' }, M10: { a: 'gold', b: 'moon' }, M11: { a: 'gold', b: 'ivory' },
    M12: { a: 'moon', b: 'ivory' }, M13: { a: 'rose', b: 'gold' }, M14: { a: 'moon', b: 'leaf' },
    M15: { a: 'ember', b: 'rose' }, M16: { a: 'ember', b: 'sun' }, M17: { a: 'moon', b: 'sun' },
    M18: { a: 'moon', b: 'soft' }, M19: { a: 'sun', b: 'leaf' }, M20: { a: 'sun', b: 'ivory' },
    M21: { a: 'gold', b: 'moon' },
  },
};

// ---- 主绘制入口 -------------------------------------------------------------
const faceCache = new Map();

export function renderCardFace(card) {
  if (faceCache.has(card.id)) return faceCache.get(card.id);
  const cv = document.createElement('canvas');
  cv.width = PW; cv.height = PH;
  const g = cv.getContext('2d');
  const rnd = mulberry32(hashStr(card.id));

  paintBackground(g, card, rnd);
  paintMotif(g, card, rnd);
  paintFrame(g, card, rnd);
  paintPlates(g, card, rnd);

  // 圆角蒙版（贴图四角透明，露出卡牌金边）
  g.globalCompositeOperation = 'destination-in';
  roundRectPath(g, 0, 0, PW, PH, 34);
  g.fillStyle = '#fff';
  g.fill();
  g.globalCompositeOperation = 'source-over';

  faceCache.set(card.id, cv);
  return cv;
}

function paintBackground(g, card, rnd) {
  const base = g.createLinearGradient(0, 0, 0, PH);
  base.addColorStop(0, '#151022');
  base.addColorStop(0.5, '#1a1429');
  base.addColorStop(1, '#120d1e');
  g.fillStyle = base;
  g.fillRect(0, 0, PW, PH);

  const pal = paletteOf(card);
  const glow = g.createRadialGradient(PW / 2, PH * 0.42, 20, PW / 2, PH * 0.42, PW * 0.72);
  glow.addColorStop(0, pal.tint);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, PW, PH);

  for (let i = 0; i < 900; i++) {
    const x = rnd() * PW, y = rnd() * PH;
    g.globalAlpha = 0.04 + rnd() * 0.12;
    g.fillStyle = rnd() > 0.5 ? '#d9b877' : '#8d84a8';
    g.fillRect(x, y, 1, 1);
  }
  g.globalAlpha = 1;

  const vig = g.createRadialGradient(PW / 2, PH / 2, PH * 0.32, PW / 2, PH / 2, PH * 0.72);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(4,2,8,0.42)');
  g.fillStyle = vig;
  g.fillRect(0, 0, PW, PH);
}

function paletteOf(card) {
  if (card.major) {
    const p = PALETTES.M[card.id] || { a: 'gold', b: 'moon' };
    return { main: C[p.a], soft: C[p.b], tint: 'rgba(160,130,80,0.16)' };
  }
  const s = SUIT_COLORS[card.suit] || SUIT_COLORS.wands;
  return { main: s.main, soft: s.soft, tint: s.tint };
}

function paintMotif(g, card, rnd) {
  const pal = paletteOf(card);
  if (card.major) {
    const motif = MAJOR_MOTIFS[card.id];
    if (motif) {
      const ops = motif(rnd);
      for (const op of ops) {
        const col = C[op.c] || pal.main;
        dots(g, op.pts, col, 2.6);
        if (op.line) stroke(g, op.pts, col, 0.8, 0.22);
      }
    }
  } else {
    paintMinor(g, card, rnd, pal);
  }
}

function zodiacOrPlanet(astro) {
  if (!astro) return '太阳';
  const t = astro.trim();
  const table = ['天王星', '海王星', '冥王星', '水星', '金星', '火星', '木星', '土星', '太阳', '月亮', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'];
  for (const k of table) if (t.startsWith(k)) return k;
  if (t.includes('之')) return t.split('之')[1] || t.split('之')[0];
  return '太阳';
}

function paintMinor(g, card, rnd, pal) {
  const cx = PW / 2, cy = PH * 0.47;
  if (card.rank === 1) {
    dots(g, suitGlyphPts(card.suit, cx, cy, 120, rnd), pal.main, 3.2);
    dots(g, ringPts(cx, cy, 150, 44, 0.03, rnd), pal.soft, 2.2);
    dots(g, rayPts(cx, cy, 12, 155, 185, rnd), pal.soft, 1.8);
  } else if (typeof card.rank === 'number') {
    const n = card.rank;
    const scale = n <= 3 ? 0.34 : n <= 6 ? 0.28 : n <= 8 ? 0.25 : 0.22;
    const area = { w: PW * 0.72, h: PH * 0.42 };
    for (const [px, py] of PIP_LAYOUTS[n]) {
      dots(g, suitGlyphPts(card.suit, cx + px * area.w, cy + py * area.h, 52 * (scale / 0.25), rnd), pal.main, 2.2);
    }
    dots(g, scatterPts(cx, cy, PW * 0.4, PH * 0.26, 40, rnd), C.dust, 1.4);
  } else {
    // 宫廷牌
    dots(g, suitGlyphPts(card.suit, cx, cy - 30, 110, rnd), pal.main, 3);
    const el = (card.astro || '').split('之')[1] || '地';
    dots(g, paintSigilCollect(el === '火' ? '火' : el === '水' ? '水' : el === '风' ? '风' : '土', cx, cy + 130, 30, rnd), pal.soft, 2);
    // 冠冕
    const crown = [[cx - 60, cy - 150], [cx - 45, cy - 185], [cx - 25, cy - 155], [cx, cy - 195], [cx + 25, cy - 155], [cx + 45, cy - 185], [cx + 60, cy - 150], [cx - 60, cy - 150]];
    dots(g, polylinePts(crown, 42, 1.5, rnd), C.gold, 2.4);
    dots(g, arcPts(cx, cy + 108, 130, Math.PI * 1.15, Math.PI * 1.85, 26, 0.03, rnd), pal.soft, 2);
  }
}

function paintFrame(g, card, rnd) {
  g.strokeStyle = 'rgba(217,184,119,0.85)';
  g.lineWidth = 2;
  roundRectPath(g, 10, 10, PW - 20, PH - 20, 18);
  g.stroke();
  g.strokeStyle = 'rgba(217,184,119,0.35)';
  g.lineWidth = 1;
  roundRectPath(g, 22, 22, PW - 44, PH - 44, 12);
  g.stroke();

  // 角饰
  const corner = (x, y, sx, sy) => {
    const p = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      p.push([x + sx * (14 + 46 * Math.sin(t * Math.PI * 0.5) ** 2), y + sy * (14 + 46 * (1 - Math.cos(t * Math.PI * 0.5) ** 2) ** 1)]);
    }
    return p;
  };
  dots(g, polylinePts(corner(26, 26, 1, 1), 12, 0.8, rnd), C.gold, 1.6);
  dots(g, polylinePts(corner(PW - 26, 26, -1, 1), 12, 0.8, rnd), C.gold, 1.6);
  dots(g, polylinePts(corner(26, PH - 26, 1, -1), 12, 0.8, rnd), C.gold, 1.6);
  dots(g, polylinePts(corner(PW - 26, PH - 26, -1, -1), 12, 0.8, rnd), C.gold, 1.6);
}

function paintPlates(g, card, rnd) {
  const pal = paletteOf(card);
  // 顶部罗马数字环
  g.save();
  g.strokeStyle = 'rgba(217,184,119,0.7)';
  g.lineWidth = 1.2;
  g.beginPath(); g.arc(PW / 2, 64, 34, 0, TAU); g.stroke();
  g.globalAlpha = 0.35;
  g.beginPath(); g.arc(PW / 2, 64, 40, 0, TAU); g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = '#e8d9ae';
  g.font = '600 26px Cinzel, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(card.numeral, PW / 2, 65);
  g.restore();

  // 占星符徽（顶部环下方小徽记）
  const sig = zodiacOrPlanet(card.astro);
  if (sig) {
    dots(g, paintSigilCollect(sig, PW / 2, 128, 17, rnd), pal.soft, 1.6);
  }

  // 底部铭牌
  g.save();
  const py = PH - 78;
  g.strokeStyle = 'rgba(217,184,119,0.5)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(PW * 0.18, py - 30); g.lineTo(PW * 0.82, py - 30);
  g.stroke();
  g.fillStyle = '#ede2c0';
  g.font = '600 34px "Songti SC", "Noto Serif SC", "STSong", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(card.zh, PW / 2, py + 4);
  g.fillStyle = 'rgba(217,184,119,0.85)';
  g.font = '400 17px Cinzel, "Times New Roman", serif';
  const en = card.en.toUpperCase();
  g.save();
  g.translate(PW / 2, py + 38);
  const spacing = 3;
  let total = 0;
  const widths = [...en].map(ch => { const w = g.measureText(ch).width; total += w + spacing; return w; });
  let x = -total / 2;
  [...en].forEach((ch, i) => { g.fillText(ch, x + widths[i] / 2, 0); x += widths[i] + spacing; });
  g.restore();
  g.restore();

  void rnd;
}

export function preloadFaces(cards) {
  for (const c of cards) renderCardFace(c);
}
