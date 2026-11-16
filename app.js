import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

/* ------------------------------------------------------------------ setup */
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const PID = params.get('pid') || 'anon';

const zonesJson = await (await fetch('./zones.json')).json();
const W = zonesJson.width, H = zonesJson.height;
const U = 1 / W;                       // 1 SVG px in AR units (marker width = 1)

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOutBounce = t => {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375;
  return n * (t -= 2.625 / d) * t + .984375;
};

/* ------------------------------------------------------------------ session log (for the study) */
const log = [];
const T0 = performance.now();
let targetMs = 0, foundAt = null, taps = 0;
function ev(type, extra = {}) {
  log.push({ t: Math.round(performance.now() - T0), type, ...extra });
  try { localStorage.setItem('plastic_ar_log_' + PID, JSON.stringify(log)); } catch (e) { /* storage may be unavailable */ }
}

/* ------------------------------------------------------------------ helpers */
function makeLabel(text, wpx = 300, hpx = 70, fontPx = 40) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * hpx / wpx);
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = s => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(15,30,61,0.92)';
    const r = c.height / 2;
    ctx.beginPath(); ctx.roundRect(4, 4, c.width - 8, c.height - 8, r); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(c.height * fontPx / hpx)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, c.width / 2, c.height / 2 + 2);
    tex.needsUpdate = true;
  };
  draw(text);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(wpx * U, hpx * U, 1);
  sprite.renderOrder = 10;
  let last = text;
  return { sprite, set(s) { if (s !== last) { last = s; draw(s); } } };
}

const BOTTLE_PROFILE = [[0, 0], [0.20, 0], [0.255, 0.03], [0.265, 0.08], [0.265, 0.60], [0.24, 0.68],
                        [0.19, 0.75], [0.13, 0.81], [0.095, 0.85], [0.095, 0.95]];
function bottleR(y) {
  for (let i = 1; i < BOTTLE_PROFILE.length; i++) {
    const [r1, y1] = BOTTLE_PROFILE[i];
    if (y <= y1) { const [r0, y0] = BOTTLE_PROFILE[i - 1]; return lerp(r0, r1, (y - y0) / (y1 - y0 || 1)); }
  }
  return 0.095;
}
function makeBottle() {
  const group = new THREE.Group();
  const pts = BOTTLE_PROFILE.map(([r, y]) => new THREE.Vector2(r, y - 0.5));
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xcfeaf0, transparent: true, opacity: 0.6, roughness: 0.15, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), bodyMat);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xFF6B35, roughness: .5, transparent: true });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.07, 24), capMat);
  cap.position.y = 0.95 + 0.035 - 0.5;
  const labMat = new THREE.MeshStandardMaterial({ color: 0x12A594, roughness: .6, side: THREE.DoubleSide, transparent: true });
  const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.268, 0.268, 0.2, 40, 1, true), labMat);
  lab.position.y = 0.335 - 0.5;
  group.add(body, cap, lab);
  return {
    group,
    setOpacity(o) { bodyMat.opacity = 0.6 * o; capMat.opacity = o; labMat.opacity = o; group.visible = o > 0.01; }
  };
}
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .45, metalness: .1, ...o });

/* ------------------------------------------------------------------ zone builders */
// each builder returns { update(t) } ; t = seconds since the animation was (re)started
function buildOil(g) {
  const S = 260 * U, N = 28, pts = [];
  for (let i = 0; i <= N; i++) { const a = i / N; pts.push(new THREE.Vector2(0.5 * Math.sin(Math.PI * Math.pow(a, 0.6)), a - 0.5)); }
  pts[0].x = 0; pts[N].x = 0;
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat(0x15151a, { roughness: .18, metalness: .35 }));
  g.add(m);
  return { update(t) {
    const k = easeOutBack(clamp(t / 0.9));
    m.scale.set(S * k, S * k * (1 + 0.04 * Math.sin(t * 3)), S * k);
    m.rotation.y = t * 0.9;
    m.position.set(0, -17 * U, S * 0.3 + 0.004 * Math.sin(t * 2));
  } };
}

function buildPellets(g) {
  const cols = [0x12A594, 0xFF6B35, 0xEAF4F4, 0xF2B134];
  const geo = new THREE.CylinderGeometry(24 * U, 24 * U, 26 * U, 18); geo.rotateX(Math.PI / 2);
  const items = []; let k = 0;
  [5, 4, 3, 2, 1].forEach((n, row) => {
    for (let j = 0; j < n; j++) {
      const m = new THREE.Mesh(geo, mat(cols[(k + row) % 4], { roughness: .35 }));
      g.add(m);
      items.push({ m, x: (j - (n - 1) / 2) * 62 * U, y: (row * 56 - 110) * U, delay: k * 0.045, rx: Math.random() * 3, ry: Math.random() * 3 });
      k++;
    }
  });
  return { update(t) {
    items.forEach(it => {
      const tt = clamp((t - it.delay) / 0.8);
      it.m.visible = t > it.delay;
      const h = (1 - easeOutBounce(tt)) * 0.18;
      it.m.position.set(it.x, it.y + h * 0.3, 14 * U + h);
      it.m.rotation.set((1 - tt) * it.rx, (1 - tt) * it.ry, 0);
    });
  } };
}

function buildBottle(g) {
  const b = makeBottle(); const S = 290 * U;
  g.add(b.group);
  return { update(t) {
    const k = easeOutBack(clamp(t / 1.3));
    const sy = 0.35 + 0.65 * k, sxz = 0.35 + 0.65 * k;   // "blow moulding": preform inflates into a bottle
    b.group.scale.set(S * sxz, S * sy, S * sxz);
    b.group.rotation.y = t * 0.9;
    b.group.position.set(0, -13 * U, S * 0.3);
  } };
}

function buildClock(g) {
  const R = 100 * U;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 7 * U, 12, 48), mat(0x0F1E3D));
  const hand = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(9 * U, 80 * U, 6 * U), mat(0xFF6B35));
  bar.position.y = 40 * U; hand.add(bar);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(11 * U, 16, 12), mat(0x0F1E3D));
  const grp = new THREE.Group(); grp.add(ring, hand, hub); grp.position.z = 14 * U; g.add(grp);
  const label = makeLabel('05:00', 260, 64, 38); label.sprite.position.set(0, 150 * U, 30 * U); g.add(label.sprite);
  return { update(t) {
    const k = easeOutBack(clamp(t / 0.6)); grp.scale.setScalar(Math.max(k, 0.001));
    const loop = 4, f = (t % loop) / loop;                 // one 5-minute "drink" per 4 s
    hand.rotation.z = -f * Math.PI * 2;
    const rem = Math.round(300 * (1 - f));
    label.set(`${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`);
  } };
}

function buildBars(g, d) {
  const items = d.bars.map((b, i) => {
    const w = b.w * U, dep = b.w * 0.7 * U;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, dep), mat(i === 3 ? 0xFF6B35 : 0x0F1E3D, { transparent: true, opacity: 0.93 }));
    g.add(m);
    return { m, x: (b.cx - d.cx) * U, yb: -(b.base - d.cy) * U, hFull: b.h * U, dep, delay: i * 0.4, year: b.year, v: b.v };
  });
  return { update(t) {
    items.forEach(it => {
      const k = easeOutCubic(clamp((t - it.delay) / 1.4));
      const h = Math.max(1e-4, it.hFull * k);
      it.m.scale.y = h;
      it.m.position.set(it.x, it.yb + h / 2, it.dep / 2);
    });
  } };
}

function buildWaffle(g, d) {
  const step = d.cell, size = (step - 12) * U;
  const geo = new THREE.BoxGeometry(size, size, size);
  const palette = { '#12A594': 0x12A594, '#FF6B35': 0xFF6B35, '#F2B134': 0xF2B134, '#D7263D': 0xD7263D };
  const items = d.colors.map((c, n) => {
    const row = Math.floor(n / 10), col = n % 10;
    const m = new THREE.Mesh(geo, mat(palette[c], { roughness: .4 }));
    g.add(m);
    return { m, c, x: (col - 4.5) * step * U, y: (row - 4.5) * step * U, delay: n * 0.022, ph: Math.random() * 6 };
  });
  return { update(t) {
    items.forEach(it => {
      const k = easeOutBack(clamp((t - it.delay) / 0.5));
      let sz = Math.max(k, 0.001), lift = 0, glow = 0;
      if (t > 3) {
        const s = Math.sin(t * 2.2 + it.ph);
        if (it.c === '#12A594') lift = (0.5 + 0.5 * s) * 0.6 * size;        // recycled: returns "upstream"
        else if (it.c === '#D7263D') lift = (0.5 + 0.5 * s) * 1.4 * size;   // leaked: drifts away
        else if (it.c === '#FF6B35') glow = 0.35 + 0.35 * s;                // burned
      }
      it.m.scale.set(1, 1, sz);
      it.m.position.set(it.x, it.y, size / 2 * sz + lift);
      it.m.material.emissive.setHex(glow > 0 ? 0xFF3300 : 0x000000);
      it.m.material.emissiveIntensity = glow;
    });
  } };
}

function buildDecay(g, d) {
  const b = makeBottle(); const BS = 230 * U;
  b.group.scale.setScalar(BS); g.add(b.group);
  const label = makeLabel('0 років', 300, 66, 38); label.sprite.position.set(0, 150 * U, 40 * U); g.add(label.sprite);
  const cols = [0x12A594, 0xFF6B35, 0x2F80ED, 0xF2B134, 0xEAF4F4];
  const geo = new THREE.TetrahedronGeometry(1);
  const parts = [];
  for (let i = 0; i < 170; i++) {
    const y = Math.random() * 0.95, th = Math.random() * Math.PI * 2, r = bottleR(y);
    const m = new THREE.Mesh(geo, mat(cols[i % cols.length], { roughness: .4 }));
    m.visible = false; g.add(m);
    parts.push({
      m, sx: Math.cos(th) * r * BS, sy: (y - 0.5) * BS, sz: Math.sin(th) * r * BS,
      ex: (Math.random() - .5) * 400 * U, ey: (Math.random() - .5) * 330 * U - 10 * U, ez: (10 + Math.random() * 40) * U,
      ph: Math.random() * 6, rx: Math.random() * 6, ry: Math.random() * 6
    });
  }
  return { update(t) {
    const T = t % 12;
    const ang = Math.min(T, 3) * 0.9;
    let bo = T < 3 ? 1 : T < 5 ? 1 - (T - 3) / 2 : T > 11 ? T - 11 : 0;
    b.setOpacity(bo);
    b.group.rotation.y = ang;
    b.group.position.set(0, 0, BS * 0.3);
    const appear = clamp((T - 3) / 1.5), fade = T > 11 ? 1 - (T - 11) : 1;
    const spread = easeInOutCubic(clamp((T - 5) / 5));
    const ca = Math.cos(ang), sa = Math.sin(ang);
    parts.forEach(p => {
      const on = T >= 3 && T < 12;
      p.m.visible = on;
      if (!on) return;
      const bx = p.sx * ca + p.sz * sa, bz = -p.sx * sa + p.sz * ca + BS * 0.3;   // shard sits where the bottle wall was
      const x = lerp(bx, p.ex, spread), y = lerp(p.sy, p.ey, spread) + 0.004 * Math.sin(T * 2 + p.ph) * spread;
      const z = lerp(bz, p.ez, spread);
      p.m.position.set(x, y, z);
      p.m.scale.setScalar(lerp(14 * U, 4 * U, spread) * appear * fade);
      p.m.rotation.set(p.rx + T * 0.5, p.ry + T * 0.4, 0);
    });
    const yrs = T < 3 ? 0 : Math.round(450 * easeOutCubic(clamp((T - 3) / 5)));
    label.set(yrs === 0 ? '0 років' : yrs >= 450 ? '450 років' : `${yrs} років`);
  } };
}

function buildMicro(g, d) {
  const core = new THREE.Mesh(new THREE.SphereGeometry(46 * U, 28, 20), mat(0xF2C9B8, { roughness: .5, transparent: true, opacity: 0.9 }));
  g.add(core);
  const cols = [0xD7263D, 0xFF6B35, 0x2F80ED, 0xF2B134, 0x12A594];
  const geo = new THREE.TetrahedronGeometry(1);
  const parts = [];
  for (let i = 0; i < 120; i++) {
    const m = new THREE.Mesh(geo, mat(cols[i % cols.length], { roughness: .4 })); g.add(m);
    parts.push({ m, r: 70 + Math.random() * 60, tilt: Math.random() * Math.PI, ph: Math.random() * 6.28,
                 sp: (0.6 + Math.random() * 1.2) * (Math.random() < .5 ? -1 : 1), s: 4 + Math.random() * 6, delay: Math.random() * 1.2 });
  }
  const label = makeLabel('1 мкм – 5 мм', 280, 60, 34); label.sprite.position.set(0, -140 * U, 40 * U); g.add(label.sprite);
  return { update(t) {
    core.scale.setScalar(Math.max(easeOutBack(clamp(t / 0.8)), 0.001) * (1 + 0.03 * Math.sin(t * 2)));
    core.position.z = 60 * U;
    parts.forEach(p => {
      const a = p.ph + p.sp * t, k = clamp((t - p.delay) / 0.5);
      p.m.position.set(p.r * Math.cos(a) * U, p.r * Math.sin(a) * Math.cos(p.tilt) * U, (p.r * Math.sin(a) * Math.sin(p.tilt) + 70) * U);
      p.m.scale.setScalar(Math.max(p.s * U * k, 1e-5));
      p.m.rotation.set(a, a * 0.7, 0);
    });
  } };
}

const BUILDERS = { oil: buildOil, pellets: buildPellets, bottle: buildBottle, clock: buildClock,
                   bars: buildBars, waffle: buildWaffle, decay: buildDecay, micro: buildMicro };

/* ------------------------------------------------------------------ AR runtime */
const hint = $('hint'), hintText = $('hintText'), capBox = $('caption'), capText = $('capText');
let mindar, renderer, scene, camera, anchor, root, clock;
let zones = [], hitboxes = [], targetVisible = false, show3d = true, currentCap = null;
const tmp = new THREE.Vector3(), ray = new THREE.Raycaster();

function buildScene() {
  root = new THREE.Group(); anchor.group.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.15));
  const dl = new THREE.DirectionalLight(0xffffff, 1.3); dl.position.set(0.4, 0.8, 1.2); scene.add(dl);
  zonesJson.zones.forEach(d => {
    const g = new THREE.Group();
    g.position.set((d.cx - W / 2) * U, -(d.cy - H / 2) * U, 0);
    g.visible = false;
    root.add(g);
    const api = BUILDERS[d.kind](g, d);
    const hw = d.size * U, hh = (d.kind === 'bars' ? 520 : d.size) * U;
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(hw, hh), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.z = 0.002; hit.userData.zone = d.id; g.add(hit); hitboxes.push(hit);
    zones.push({ d, g, api, t0: -1, on: false });
  });
}

function play(z, now, why) { z.t0 = now; z.g.visible = true; ev('play', { zone: z.d.id, why }); }

function frame() {
  const now = clock.getElapsedTime();
  if (targetVisible && show3d) {
    let best = null, bestD = 9;
    zones.forEach(z => {
      z.g.getWorldPosition(tmp); tmp.project(camera);
      const onscreen = Math.abs(tmp.x) < 1.0 && Math.abs(tmp.y) < 1.0 && tmp.z < 1;
      if (onscreen && !z.on) play(z, now, 'enter');
      z.on = onscreen;
      if (onscreen) { const dist = Math.hypot(tmp.x, tmp.y); if (dist < bestD) { bestD = dist; best = z; } }
      if (z.t0 >= 0) z.api.update(now - z.t0);
    });
    const cap = best ? best.d.caption : null;
    if (cap !== currentCap) { currentCap = cap; capText.textContent = cap || ''; capBox.style.display = cap ? 'block' : 'none'; }
  }
  renderer.render(scene, camera);
}

function onTap(e) {
  if (!targetVisible || !show3d) return;
  if (e.target.closest && e.target.closest('#tools')) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(hitboxes, false)[0];
  taps++;
  if (hit) { const z = zones.find(q => q.d.id === hit.object.userData.zone); play(z, clock.getElapsedTime(), 'tap'); ev('tap', { zone: z.d.id }); }
  else ev('tap', { zone: null });
}

function showError(msg) { const e = $('err'); e.style.display = 'flex'; e.textContent = msg; }

async function startAR() {
  $('startBtn').disabled = true; $('startBtn').textContent = 'Завантаження…';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomedia');
    mindar = new MindARThree({ container: $('ar'), imageTargetSrc: './plastic.mind', maxTrack: 1,
                               uiLoading: 'no', uiScanning: 'no', uiError: 'no', missTolerance: 10, warmupTolerance: 4 });
    ({ renderer, scene, camera } = mindar);
    anchor = mindar.addAnchor(0);
    clock = new THREE.Clock();
    buildScene();
    anchor.onTargetFound = () => {
      targetVisible = true; foundAt = performance.now(); ev('found');
      hint.style.opacity = 0;
    };
    anchor.onTargetLost = () => {
      targetVisible = false; if (foundAt) { targetMs += performance.now() - foundAt; foundAt = null; } ev('lost');
      hint.style.opacity = 1; hintText.textContent = 'Наведіть камеру на інфографіку'; capBox.style.display = 'none'; currentCap = null;
    };
    await mindar.start();
    $('start').style.display = 'none';
    $('tools').style.display = 'flex';
    if (DEBUG) $('copyLog').style.display = 'block';
    ev('start', { pid: PID, ua: navigator.userAgent });
    renderer.domElement.addEventListener('pointerdown', onTap);
    $('ar').addEventListener('pointerdown', onTap);
    renderer.setAnimationLoop(frame);
    window.__ar = { zones, anchor, camera, renderer, log, ev };   // for debugging / tests
  } catch (err) {
    console.error(err);
    showError(err && err.message === 'nomedia'
      ? 'Камера недоступна. Відкрийте сторінку за HTTPS-адресою в Safari (iOS) або Chrome (Android).'
      : 'Не вдалося запустити камеру. Дозвольте доступ до камери в налаштуваннях браузера й оновіть сторінку.');
  }
}

$('startBtn').addEventListener('click', startAR);
$('toggle3d').addEventListener('click', e => {
  show3d = !show3d;
  root && (root.visible = show3d);
  e.target.textContent = show3d ? '3D: увімк' : '3D: вимк'; e.target.classList.toggle('off', !show3d);
  if (!show3d) { capBox.style.display = 'none'; currentCap = null; }
  ev('toggle3d', { on: show3d });
});
$('copyLog').addEventListener('click', async () => {
  const total = targetMs + (foundAt ? performance.now() - foundAt : 0);
  const out = JSON.stringify({ pid: PID, targetSeconds: Math.round(total / 100) / 10, taps, events: log }, null, 1);
  try { await navigator.clipboard.writeText(out); $('copyLog').textContent = 'Скопійовано'; } catch (e) { prompt('Лог', out); }
});
