// 外送風雲：親自出馬嘅 3D 街景揸車（three.js r128）。
// index.html 叫 StreetDrive.start(opts)；每段路到咗問 opts.onArrive(i)，完成或者放棄就叫 opts.onEnd(result)。
// 座標：遊戲用米，x 向東、y 向北；3D 入面係 (x, 高度, -y)。
(() => {
'use strict';
const T = THREE, PI = Math.PI;
const WIDTH = [4.5, 7, 10, 13];   // road width by class: service, street, secondary, primary
const VEH = {
  moto: { wb: 1.3, maxV: 13.5, acc: 4.2, steer: .6, r: .55, jam: .6, wet: [.75, .55], name: '電單車' },
  car: { wb: 2.6, maxV: 15, acc: 3.2, steer: .55, r: 1.1, jam: .35, wet: [.9, .7], name: '私家車' },
};
const CYCLE = 16, GREEN = 9, AMBER = 11;   // traffic light seconds: green, amber, then red to 16

const CSS = `
.dv{position:fixed;inset:0;z-index:1500;background:#0b0e16;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.dv[hidden]{display:none}
.dv canvas.dv-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.dv-hud{position:absolute;inset:0;pointer-events:none;font-family:'Noto Sans TC',system-ui,sans-serif;color:#ece8df}
.dv-hud button{pointer-events:auto;font:inherit;font-weight:700;color:#ece8df;background:rgba(31,36,48,.85);border:1px solid #3a4152;border-radius:10px;cursor:pointer}
.dv-top{position:absolute;left:12px;top:10px;right:180px;display:flex;flex-direction:column;gap:2px;text-shadow:0 1px 3px #000}
.dv-top b{font-size:16px}.dv-top span{font-family:'IBM Plex Mono',monospace;font-size:13px;color:#cfd3dc}
.dv-nav{position:absolute;left:50%;top:12px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:rgba(124,108,255,.92);border-radius:12px;padding:6px 14px;font-weight:700;font-size:15px;max-width:calc(100vw - 340px);white-space:nowrap}
.dv-arrow{display:inline-block;font-size:22px;line-height:1;transition:transform .15s}
.dv-ev{position:absolute;left:50%;top:64px;transform:translateX(-50%);font-weight:900;font-size:18px;text-shadow:0 2px 6px #000;white-space:nowrap}
.dv-mini{position:absolute;right:12px;top:10px;width:150px;height:150px;border-radius:50%;border:2px solid #3a4152;background:#11141a}
.dv-tools{position:absolute;right:12px;top:168px;display:flex;flex-direction:column;gap:6px;width:150px}
.dv-tools button{padding:7px 0;font-size:13px}
.dv-spd{position:absolute;left:12px;bottom:110px;font-family:'IBM Plex Mono',monospace;font-size:13px;text-shadow:0 1px 3px #000}
.dv-spd b{font-size:28px}
.dv-pad{position:absolute;bottom:16px;display:flex;gap:10px}
.dv-pad button{width:78px;height:78px;font-size:22px;border-radius:16px}
.dv-pad button.on{background:#7c6cff;border-color:#7c6cff}
.dv-left{left:12px}.dv-right{right:12px}
.dv-wait{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(13,15,19,.85);border:1px solid #7c6cff;border-radius:14px;padding:14px 22px;font-size:18px;font-weight:700;text-align:center}
.dv-wait[hidden]{display:none}
@media (max-width:640px){.dv-nav{top:auto;bottom:110px;max-width:calc(100vw - 24px)}.dv-top{right:170px}.dv-mini{width:120px;height:120px}.dv-tools{top:138px;width:120px}}
`;

function start(o) {
  if (!document.getElementById('dv-css')) { const st = document.createElement('style'); st.id = 'dv-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = o.container; root.className = 'dv'; root.hidden = false;
  root.innerHTML = `<canvas class="dv-cv"></canvas><div class="dv-hud">
    <div class="dv-top"><b class="dv-title"></b><span class="dv-info"></span></div>
    <div class="dv-nav"><span class="dv-arrow">⬆</span><span class="dv-goal"></span></div>
    <div class="dv-ev"></div><div class="dv-wait" hidden></div>
    <canvas class="dv-mini" width="150" height="150"></canvas>
    <div class="dv-tools"><button data-dv="cam">鏡頭（V）</button><button data-dv="quit">放棄</button></div>
    <div class="dv-spd"><b>0</b> km/h</div>
    <div class="dv-pad dv-left"><button data-k="L">◀</button><button data-k="R">▶</button></div>
    <div class="dv-pad dv-right"><button data-k="B">煞</button><button data-k="G">油</button></div></div>`;
  const q = s => root.querySelector(s);
  const V = VEH[o.veh] || VEH.moto, net = o.net;
  const wet = o.wx === 'typhoon' ? V.wet[1] : o.wx === 'rain' ? V.wet[0] : 1;

  // ---------- renderer / scene ----------
  const cv = q('.dv-cv');
  const renderer = new T.WebGLRenderer({ canvas: cv, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new T.Scene();
  const sky = o.wx === 'sun' ? 0x0b0e16 : 0x10141c;
  scene.background = new T.Color(sky);
  scene.fog = new T.Fog(sky, 40, o.wx === 'typhoon' ? 150 : 240);
  const camera = new T.PerspectiveCamera(62, 1, .1, 400);
  scene.add(new T.HemisphereLight(0x8a96c0, 0x1c1c24, .6), new T.AmbientLight(0xffffff, .18));
  const moon = new T.DirectionalLight(0xaab6ff, .3); moon.position.set(-60, 120, 40); scene.add(moon);
  const P3 = (x, y, h = 0) => new T.Vector3(x, h, -y);

  // ---------- roads ----------
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < net.x.length; i++) { minX = Math.min(minX, net.x[i]); maxX = Math.max(maxX, net.x[i]); minY = Math.min(minY, net.y[i]); maxY = Math.max(maxY, net.y[i]); }
  const ground = new T.Mesh(new T.PlaneGeometry(maxX - minX + 600, maxY - minY + 600), new T.MeshLambertMaterial({ color: 0x17191f }));
  ground.rotation.x = -PI / 2; ground.position.set((minX + maxX) / 2, 0, -(minY + maxY) / 2); scene.add(ground);
  const segs = [], nodeW = new Float32Array(net.x.length);
  net.ways.forEach((w, wi) => { const hw = WIDTH[net.cls[wi] ?? 1] / 2;
    for (let i = 1; i < w.length; i++) { const a = w[i - 1], b = w[i]; if (a === b) continue;
      segs.push({ a, b, ax: net.x[a], ay: net.y[a], bx: net.x[b], by: net.y[b], hw, c: net.cls[wi] ?? 1 });
      nodeW[a] = Math.max(nodeW[a], hw); nodeW[b] = Math.max(nodeW[b], hw); } });
  // spatial hash for "nearest road" and colliders
  const CS = 40, key = (x, y) => Math.floor(x / CS) + ',' + Math.floor(y / CS);
  const hash = () => new Map(), put = (h, x, y, v) => { const k = key(x, y); let a = h.get(k); if (!a) h.set(k, a = []); a.push(v); };
  const near = (h, x, y, f) => { const cx = Math.floor(x / CS), cy = Math.floor(y / CS); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = h.get((cx + i) + ',' + (cy + j)); if (a) for (const v of a) f(v); } };
  const segHash = hash();
  segs.forEach((s, i) => { const n = Math.max(1, Math.ceil(Math.hypot(s.bx - s.ax, s.by - s.ay) / CS)); const seen = new Set();
    for (let k = 0; k <= n; k++) { const x = s.ax + (s.bx - s.ax) * k / n, y = s.ay + (s.by - s.ay) * k / n, kk = key(x, y); if (!seen.has(kk)) { seen.add(kk); put(segHash, x, y, i); } } });
  const segDist = (s, x, y) => { const dx = s.bx - s.ax, dy = s.by - s.ay, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l)); return Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t); };
  // distance outside the nearest road's edge (negative = on the road)
  const offRoad = (x, y) => { let best = 99; near(segHash, x, y, i => { const s = segs[i]; best = Math.min(best, segDist(s, x, y) - s.hw); }); return best; };
  {
    const pos = [], col = [], idx = [];
    const quad = (a, b, c, d, cc) => { const n = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) col.push(...cc); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); };
    const asphalt = [[.16, .17, .19], [.19, .2, .23], [.21, .22, .25], [.23, .24, .27]];
    for (const s of segs) {
      const dx = s.bx - s.ax, dy = s.by - s.ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * s.hw, ny = dx / l * s.hw;
      quad([s.ax + nx, .02, -(s.ay + ny)], [s.ax - nx, .02, -(s.ay - ny)], [s.bx - nx, .02, -(s.by - ny)], [s.bx + nx, .02, -(s.by + ny)], asphalt[s.c]);
      if (s.c >= 2) { const mx = -dy / l * .1, my = dx / l * .1;   // dim centre line on bigger roads
        quad([s.ax + mx, .03, -(s.ay + my)], [s.ax - mx, .03, -(s.ay - my)], [s.bx - mx, .03, -(s.by - my)], [s.bx + mx, .03, -(s.by + my)], [.55, .48, .22]); }
    }
    for (let i = 0; i < net.x.length; i++) if (net.adj[i].length >= 3 && nodeW[i]) {   // junction discs fill the corners
      const n = pos.length / 3, r = nodeW[i] + .3; pos.push(net.x[i], .021, -net.y[i]); col.push(...asphalt[1]);
      for (let k = 0; k <= 10; k++) { const a = k / 10 * 2 * PI; pos.push(net.x[i] + Math.cos(a) * r, .021, -(net.y[i] + Math.sin(a) * r)); col.push(...asphalt[1]); if (k) idx.push(n, n + k + 1, n + k); }
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })));
  }

  // ---------- buildings lining the streets ----------
  let seed = 11; const rnd = (a, b) => a + (b - a) * ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const occ = new Set(), occKey = (x, y) => Math.floor(x / 4) + ',' + Math.floor(y / 4);
  const bHash = hash(), blds = [];
  for (const s of segs) {
    if (s.c === 0 || blds.length > 5000) continue;
    const dx = s.bx - s.ax, dy = s.by - s.ay, l = Math.hypot(dx, dy); if (l < 10) continue;
    const ux = dx / l, uy = dy / l, ang = Math.atan2(dy, dx);
    for (const side of [-1, 1]) for (let t = 3; t < l - 3;) {
      const bw = rnd(8, 15), bd = rnd(8, 18), off = s.hw + 3.5 + bd / 2;   // 3.5 m pavement so corners can be cut a little
      const cx = s.ax + ux * (t + bw / 2) - uy * side * off, cy = s.ay + uy * (t + bw / 2) + ux * side * off;
      t += bw + rnd(.5, 2.5);
      const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 0]].map(([i, j]) => [cx + ux * bw / 2 * i - uy * bd / 2 * j, cy + uy * bw / 2 * i + ux * bd / 2 * j]);
      if (corners.some(([x, y]) => offRoad(x, y) < 2)) continue;
      const cellsCovered = []; for (let i = -bw / 2; i <= bw / 2; i += 3) for (let j = -bd / 2; j <= bd / 2; j += 3) cellsCovered.push(occKey(cx + ux * i - uy * j, cy + uy * i + ux * j));
      if (cellsCovered.some(k => occ.has(k))) continue;
      cellsCovered.forEach(k => occ.add(k));
      const h = s.c === 3 ? rnd(24, 60) : s.c === 2 ? rnd(14, 40) : rnd(7, 24);
      const b = { x: cx, y: cy, c: Math.cos(ang), s: Math.sin(ang), hw: bw / 2, hd: bd / 2, h, ang }; blds.push(b); put(bHash, cx, cy, b);
    }
  }
  {
    const tc = document.createElement('canvas'); tc.width = 64; tc.height = 128; const g = tc.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 10) for (let x = 4; x < 60; x += 9) { const r = Math.random(); if (r < .45) { g.fillStyle = r < .1 ? '#9fd4ff' : r < .3 ? '#ffd88a' : '#f3e6c4'; g.fillRect(x, y, 5, 6); } }
    const tex = new T.CanvasTexture(tc);
    const geo = new T.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
    const mat = new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: .75 });
    const im = new T.InstancedMesh(geo, mat, blds.length), m = new T.Matrix4(), qt = new T.Quaternion(), col = new T.Color();
    const tones = [0x2a2f3a, 0x33303a, 0x2c3530, 0x3a3328, 0x26303d, 0x403a36];
    blds.forEach((b, i) => { qt.setFromAxisAngle(new T.Vector3(0, 1, 0), b.ang); m.compose(P3(b.x, b.y), qt, new T.Vector3(b.hw * 2, b.h, b.hd * 2)); im.setMatrixAt(i, m); im.setColorAt(i, col.set(tones[i % tones.length])); });
    scene.add(im);
  }
  // shop signs on the kerb in front of each place
  {
    const pl = (o.places || []).filter(p => p.x > minX && p.x < maxX && p.y > minY && p.y < maxY).slice(0, 1500);
    const geo = new T.BoxGeometry(2.6, 1, .25); geo.translate(0, 4.2, 0);
    const im = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ color: 0xffffff }), pl.length), m = new T.Matrix4(), qt = new T.Quaternion(), col = new T.Color();
    pl.forEach((p, i) => {
      let bs = null, bd = 99; near(segHash, p.x, p.y, k => { const d = segDist(segs[k], p.x, p.y); if (d < bd) { bd = d; bs = segs[k]; } });
      let x = p.x, y = p.y, ang = 0;
      if (bs) { const dx = bs.bx - bs.ax, dy = bs.by - bs.ay, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - bs.ax) * dx + (p.y - bs.ay) * dy) / l)), fx = bs.ax + dx * t, fy = bs.ay + dy * t, dd = Math.hypot(p.x - fx, p.y - fy) || 1;
        x = fx + (p.x - fx) / dd * (bs.hw + 1.6); y = fy + (p.y - fy) / dd * (bs.hw + 1.6); ang = Math.atan2(dy, dx); }
      qt.setFromAxisAngle(new T.Vector3(0, 1, 0), ang); m.compose(P3(x, y), qt, new T.Vector3(1, 1, 1)); im.setMatrixAt(i, m); im.setColorAt(i, col.set(p.color || '#ff9f43'));
    });
    scene.add(im);
  }

  // ---------- traffic lights ----------
  const lights = [];
  // signals only where a secondary-or-bigger road crosses
  for (let i = 0; i < net.x.length; i++) if (net.adj[i].length >= 4 && nodeW[i] >= 5 && lights.length < 400) lights.push({ n: i, x: net.x[i], y: net.y[i], r: nodeW[i] + 1, ph: rnd(0, CYCLE), inside: false });
  const lampGeo = new T.SphereGeometry(.45, 8, 6), lamps = new T.InstancedMesh(lampGeo, new T.MeshBasicMaterial({ color: 0xffffff }), lights.length * 2);
  const poles = new T.InstancedMesh(new T.CylinderGeometry(.12, .12, 5.2, 6).translate(0, 2.6, 0), new T.MeshLambertMaterial({ color: 0x555a63 }), lights.length * 2);
  { const m = new T.Matrix4(); let k = 0;
    for (const L of lights) for (const sgn of [1, -1]) { const x = L.x + sgn * L.r * .75, y = L.y + sgn * L.r * .75;
      m.makeTranslation(x, 0, -y); poles.setMatrixAt(k, m); m.makeTranslation(x, 5.3, -y); lamps.setMatrixAt(k, m); k++; } }
  for (let k = 0; k < lights.length * 2; k++) lamps.setColorAt(k, new T.Color(0x3cff8a));   // colours must exist before the first render
  scene.add(poles, lamps);
  const lightState = (L, t) => { const c = (t + L.ph) % CYCLE; return c < GREEN ? 'g' : c < AMBER ? 'a' : 'r'; };
  const LCOL = { g: new T.Color(0x3cff8a), a: new T.Color(0xffb02e), r: new T.Color(0xff3b3b) };

  // ---------- jams: stopped traffic you have to weave through ----------
  const npc = [], nHash = hash();
  for (const j of o.jams || []) for (const s of segs) {
    if (s.c === 0) continue;
    const mx = (s.ax + s.bx) / 2, my = (s.ay + s.by) / 2; if (Math.hypot(mx - j.x, my - j.y) > j.r) continue;
    const dx = s.bx - s.ax, dy = s.by - s.ay, l = Math.hypot(dx, dy); if (l < 8) continue;
    const ux = dx / l, uy = dy / l;
    for (let t = 4; t < l - 4; t += rnd(7, 11)) { if (rnd(0, 1) < .35) continue;
      const side = rnd(0, 1) < .5 ? 1 : -1, lane = s.hw * .5, x = s.ax + ux * t - uy * side * lane, y = s.ay + uy * t + ux * side * lane;
      if (Math.hypot(x - o.start.x, y - o.start.y) < 15) continue;
      const c = { x, y, ang: Math.atan2(side > 0 ? -dy : dy, side > 0 ? -dx : dx), r: 1.2 }; npc.push(c); put(nHash, x, y, c); }
  }
  if (npc.length) {
    const body = new T.InstancedMesh(new T.BoxGeometry(4.2, 1.4, 1.8).translate(0, .75, 0), new T.MeshLambertMaterial({ color: 0xffffff }), npc.length);
    const tail = new T.InstancedMesh(new T.BoxGeometry(.1, .25, 1.4).translate(-2.12, .9, 0), new T.MeshBasicMaterial({ color: 0xff2a2a }), npc.length);
    const m = new T.Matrix4(), qt = new T.Quaternion(), col = new T.Color(), cs = [0xd8d8d8, 0x2b2f38, 0x8a9099, 0xb8322b, 0x3b5d8f, 0xe9e4d6];
    npc.forEach((c, i) => { qt.setFromAxisAngle(new T.Vector3(0, 1, 0), c.ang); m.compose(P3(c.x, c.y), qt, new T.Vector3(1, 1, 1)); body.setMatrixAt(i, m); tail.setMatrixAt(i, m); body.setColorAt(i, col.set(cs[i % cs.length])); });
    scene.add(body, tail);
  }

  // ---------- your vehicle ----------
  const me = new T.Group(); me.rotation.order = 'YXZ'; scene.add(me);
  const box = (w, h, d, c, x, y, z, basic) => { const b = new T.Mesh(new T.BoxGeometry(w, h, d), basic ? new T.MeshBasicMaterial({ color: c }) : new T.MeshLambertMaterial({ color: c })); b.position.set(x, y, z); me.add(b); return b; };
  if (o.veh === 'car') {
    box(4.4, .75, 1.8, 0x7c6cff, 0, .7, 0); box(2.3, .6, 1.6, 0x1b2230, -.2, 1.35, 0);
    box(.06, .2, .45, 0xfff6d8, 2.21, .8, .55, true); box(.06, .2, .45, 0xfff6d8, 2.21, .8, -.55, true);
    box(.06, .2, .45, 0xff2a2a, -2.21, .85, .55, true); box(.06, .2, .45, 0xff2a2a, -2.21, .85, -.55, true);
  } else {
    box(1.8, .45, .45, 0x7c6cff, 0, .7, 0); box(.6, .6, .35, 0x7c6cff, .65, .95, 0);
    for (const x of [-.65, .65]) { const w = new T.Mesh(new T.CylinderGeometry(.33, .33, .14, 12), new T.MeshLambertMaterial({ color: 0x111111 })); w.rotation.x = PI / 2; w.position.set(x, .33, 0); me.add(w); }
    box(.45, .8, .5, 0x2a3b55, -.15, 1.45, 0); box(.32, .32, .32, 0xf2c53d, -.1, 2.05, 0); box(.55, .45, .55, 0x7c6cff, -.75, 1.25, 0);   // rider, helmet, delivery box
    box(.06, .16, .2, 0xfff6d8, .82, 1.05, 0, true);
  }
  const head = new T.SpotLight(0xfff1d0, 1.6, 70, .5, .6); head.position.set(1.8, 1.2, 0); head.target.position.set(20, 0, 0); me.add(head, head.target);

  // goal beacon + suggested-route ribbon
  const beacon = new T.Mesh(new T.CylinderGeometry(2.2, 2.2, 90, 20, 1, true).translate(0, 45, 0), new T.MeshBasicMaterial({ color: 0x9d8cff, transparent: true, opacity: .32, side: T.DoubleSide, depthWrite: false, blending: T.AdditiveBlending }));
  const ring = new T.Mesh(new T.RingGeometry(5, 6.2, 32), new T.MeshBasicMaterial({ color: 0xb6adff, transparent: true, opacity: .8, side: T.DoubleSide })); ring.rotation.x = -PI / 2; ring.position.y = .06;
  scene.add(beacon, ring);
  const ribbon = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x9d8cff, transparent: true, opacity: .55, depthWrite: false })); scene.add(ribbon);

  // rain
  let rain = null;
  if (o.wx !== 'sun') {
    const n = o.wx === 'typhoon' ? 2600 : 1400, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = rnd(-40, 40), y = rnd(0, 30), z = rnd(-40, 40); pos.set([x, y, z, x + .15, y - .9, z], i * 6); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: .35 })); scene.add(rain);
  }

  // ---------- state ----------
  const P = { x: o.start.x, y: o.start.y, a: o.start.a || 0, v: 0, st: 0 };
  let leg = 0, waiting = false, camMode = 'chase', t = 0, redRuns = 0, bumps = 0, contact = false, offT = 0, ev = '', evT = 0, ended = false;
  let routeNodes = [], routePts = [], routeLen = 0, routeT = 0;
  const keys = {}, pad = {};
  const goal = () => o.legs[leg];
  function placeBeacon() { const g = goal(); beacon.position.copy(P3(g.x, g.y)); ring.position.set(g.x, .06, -g.y); q('.dv-goal').textContent = g.label; routeT = 0; }
  placeBeacon();
  function reroute() {
    // start from the end of the road you are on that lies ahead of you, so the line never tells you to turn back
    const g = goal(); let from = null, bd = 25, c = Math.cos(P.a), s = Math.sin(P.a);
    near(segHash, P.x, P.y, i => { const sg = segs[i], d = segDist(sg, P.x, P.y); if (d < bd) { bd = d; from = (sg.bx - P.x) * c + (sg.by - P.y) * s >= (sg.ax - P.x) * c + (sg.ay - P.y) * s ? sg.b : sg.a; } });
    if (from == null) from = o.nearest(P.x, P.y);
    routeNodes = o.route(from, g.node); routePts = [[P.x, P.y], ...routeNodes.map(n => [net.x[n], net.y[n]]), [g.x, g.y]];
    routeLen = 0; for (let i = 1; i < routePts.length; i++) routeLen += Math.hypot(routePts[i][0] - routePts[i - 1][0], routePts[i][1] - routePts[i - 1][1]);
    const pos = [], idx = [];
    for (let i = 1; i < routePts.length; i++) { const [ax, ay] = routePts[i - 1], [bx, by] = routePts[i], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, nx = -dy / l * .7, ny = dx / l * .7, n = pos.length / 3;
      pos.push(ax + nx, .05, -(ay + ny), ax - nx, .05, -(ay - ny), bx - nx, .05, -(by - ny), bx + nx, .05, -(by + ny)); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); }
    ribbon.geometry.dispose(); const g2 = new T.BufferGeometry(); g2.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g2.setIndex(idx); ribbon.geometry = g2;
  }
  reroute();

  // ---------- minimap (north-up roads drawn once, then rotated so you always face up) ----------
  const MS = .32, mini = q('.dv-mini'), mctx = mini.getContext('2d'), off = document.createElement('canvas');
  off.width = Math.ceil((maxX - minX) * MS) + 2; off.height = Math.ceil((maxY - minY) * MS) + 2;
  { const g = off.getContext('2d'); g.strokeStyle = '#4a5266'; g.lineCap = 'round';
    for (const s of segs) { g.lineWidth = Math.max(1, s.hw * 2 * MS); g.beginPath(); g.moveTo((s.ax - minX) * MS, (maxY - s.ay) * MS); g.lineTo((s.bx - minX) * MS, (maxY - s.by) * MS); g.stroke(); } }
  function drawMini() {
    const W = mini.width, c = Math.cos(P.a), s = Math.sin(P.a), dx = minX - P.x, dy = maxY - P.y;
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.fillStyle = '#11141a'; mctx.fillRect(0, 0, W, W);
    mctx.setTransform(s, -c, c, s, W / 2 + MS * (dx * s - dy * c), W / 2 - MS * (dx * c + dy * s));
    mctx.drawImage(off, 0, 0);
    const toPx = (x, y) => [(x - minX) * MS, (maxY - y) * MS];
    mctx.strokeStyle = '#9d8cff'; mctx.lineWidth = 3; mctx.beginPath(); routePts.forEach(([x, y], i) => { const [px, py] = toPx(x, y); i ? mctx.lineTo(px, py) : mctx.moveTo(px, py); }); mctx.stroke();
    const [gx, gy] = toPx(goal().x, goal().y); mctx.fillStyle = '#f2c53d'; mctx.beginPath(); mctx.arc(gx, gy, 5, 0, 7); mctx.fill();
    for (const j of o.jams || []) { const [jx, jy] = toPx(j.x, j.y); mctx.fillStyle = 'rgba(255,93,93,.25)'; mctx.beginPath(); mctx.arc(jx, jy, j.r * MS, 0, 7); mctx.fill(); }
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(W / 2, W / 2 - 7); mctx.lineTo(W / 2 + 5, W / 2 + 6); mctx.lineTo(W / 2 - 5, W / 2 + 6); mctx.closePath(); mctx.fill();
  }

  // ---------- input ----------
  const KEYMAP = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'G', KeyW: 'G', ArrowDown: 'B', KeyS: 'B', Space: 'B' };
  const kd = e => { const k = KEYMAP[e.code]; if (k) { keys[k] = true; e.preventDefault(); } if (e.code === 'KeyV') toggleCam(); };
  const ku = e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; };
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  root.querySelectorAll('[data-k]').forEach(b => {
    const on = e => { e.preventDefault(); pad[b.dataset.k] = true; b.classList.add('on'); }, offf = () => { pad[b.dataset.k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', offf); b.addEventListener('pointercancel', offf); b.addEventListener('pointerleave', offf);
  });
  function toggleCam() { camMode = camMode === 'chase' ? 'pov' : 'chase'; me.visible = camMode === 'chase' || o.veh === 'moto'; }
  root.querySelector('[data-dv="cam"]').onclick = toggleCam;
  root.querySelector('[data-dv="quit"]').onclick = () => { if (confirm('放棄呢單？張單會返去等人接。')) finish(false); };
  const resize = () => { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();

  // ---------- physics ----------
  let lastHit = null;
  function hits(x, y) {
    let hit = false;
    near(bHash, x, y, b => { if (hit) return; const dx = x - b.x, dy = y - b.y, lx = dx * b.c + dy * b.s, ly = -dx * b.s + dy * b.c;
      const cx = Math.max(-b.hw, Math.min(b.hw, lx)), cy = Math.max(-b.hd, Math.min(b.hd, ly)); if (Math.hypot(lx - cx, ly - cy) < V.r) { hit = true; lastHit = b; } });
    near(nHash, x, y, c => { if (hit) return;   // stopped cars: a 4.2 m body, checked along its length
      const dx = x - c.x, dy = y - c.y, cu = Math.cos(c.ang), su = Math.sin(c.ang), al = Math.max(-1.3, Math.min(1.3, dx * cu + dy * su));
      if (Math.hypot(dx - cu * al, dy - su * al) < .95 + V.r) { hit = true; lastHit = c; } });
    return hit || x < minX - 50 || x > maxX + 50 || y < minY - 50 || y > maxY + 50;
  }
  function flash(msg, sec = 2.2) { ev = msg; evT = sec; }
  function physics(dt) {
    const gas = keys.G || pad.G, brake = keys.B || pad.B, steerIn = ((keys.L || pad.L) ? 1 : 0) - ((keys.R || pad.R) ? 1 : 0);
    const jam = (o.jams || []).some(j => Math.hypot(P.x - j.x, P.y - j.y) < j.r), offr = offRoad(P.x, P.y) > 1.2;
    let maxV = V.maxV * wet * (jam ? V.jam : 1); if (offr) maxV = Math.min(maxV, 4);
    if (waiting) { P.v = Math.max(0, P.v - 9 * dt); }
    else if (gas) P.v = P.v < 0 ? P.v + 9 * dt : Math.min(maxV, P.v + V.acc * dt);
    else if (brake) P.v = P.v > .3 ? P.v - 9 * dt : Math.max(-3, P.v - 2.5 * dt);
    else P.v -= Math.sign(P.v) * Math.min(Math.abs(P.v), 1.6 * dt);
    if (P.v > maxV) P.v = Math.max(maxV, P.v - 7 * dt);
    const ms = V.steer / (1 + Math.abs(P.v) / 10);
    P.st += (steerIn * ms - P.st) * Math.min(1, dt * 6);
    const na = P.a + P.v / V.wb * Math.tan(P.st) * dt, nx = P.x + Math.cos(na) * P.v * dt, ny = P.y + Math.sin(na) * P.v * dt;
    if (hits(nx, ny)) { if (!contact && Math.abs(P.v) > 2.5) { bumps++; flash('💥 撞到嘢！啲餐會瀉'); } contact = true; P.v = -P.v * .15; }
    else { P.x = nx; P.y = ny; P.a = na; contact = false; }
    if (offr && Math.abs(P.v) > 1) offT += dt;
    if (jam && !evT) ev = '🚗 塞車，兜開啲車';
    // red-light runs: count when you roll into a junction on red
    for (const L of lights) { const d = Math.hypot(P.x - L.x, P.y - L.y), inside = d < L.r;
      if (inside && !L.inside && lightState(L, t) === 'r' && Math.abs(P.v) > 2.5) { redRuns++; flash('🚨 衝紅燈！罰款'); }
      L.inside = inside; }
  }

  // ---------- loop ----------
  let last = performance.now(), frameN = 0, raf = 0, waitPoll = 0;
  // one simulation step; false once the trip has ended
  function update(dt) {
    t += dt;
    physics(dt);
    o.onTick(dt, waiting);
    if (ended) return false;   // the job may have been called off during the tick
    // arrival
    const g = goal();
    if (Math.hypot(P.x - g.x, P.y - g.y) < 14 && (waitPoll -= dt) <= 0) {
      waitPoll = .4;
      const r = o.onArrive(leg);
      if (r.state === 'go') { waiting = false; q('.dv-wait').hidden = true; flash(r.msg || '✅ 到咗', 2.5); if (++leg >= o.legs.length) { finish(true); return false; } placeBeacon(); reroute(); }
      else if (r.state === 'wait') { waiting = true; const w = q('.dv-wait'); w.hidden = false; w.textContent = r.msg; }
      else if (r.state === 'cancel') { finish(false, r.msg); return false; }
    }
    if ((routeT -= dt) <= 0) { routeT = 1.2; reroute(); }
    return true;
  }
  const loop = now => {
    if (ended) return;
    const dt = Math.min(.05, (now - last) / 1000); last = now; frameN++;
    if (!update(dt)) return;
    // traffic light colours
    if (frameN % 6 === 0) { let k = 0; for (const L of lights) { const c = LCOL[lightState(L, t)]; lamps.setColorAt(k++, c); lamps.setColorAt(k++, c); } if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true; }
    // camera + you
    me.position.set(P.x, 0, -P.y); me.rotation.y = P.a; me.rotation.x = o.veh === 'moto' ? -P.st * Math.min(1, Math.abs(P.v) / 8) * .6 : 0;   // bikes lean into the turn
    const c = Math.cos(P.a), s = Math.sin(P.a);
    if (camMode === 'chase') { const back = o.veh === 'car' ? 8 : 6; camera.position.lerp(P3(P.x - c * back, P.y - s * back, o.veh === 'car' ? 3.4 : 2.8), Math.min(1, dt * 5)); camera.lookAt(P3(P.x + c * 6, P.y + s * 6, 1)); }
    else { camera.position.copy(P3(P.x + c * (o.veh === 'car' ? .1 : .2), P.y + s * (o.veh === 'car' ? .1 : .2), o.veh === 'car' ? 1.25 : 2.0)); camera.lookAt(P3(P.x + c * 20, P.y + s * 20, 1)); }
    if (rain) { rain.position.set(camera.position.x, 0, camera.position.z); const p = rain.geometry.attributes.position; for (let i = 0; i < p.count; i += 2) { let y = p.getY(i) - dt * 28; if (y < 0) y += 30; p.setY(i, y); p.setY(i + 1, y - .9); } p.needsUpdate = true; }
    beacon.material.opacity = .22 + .12 * Math.sin(t * 3);
    renderer.render(scene, camera);
    // hud
    if (frameN % 3 === 0) {
      drawMini();
      q('.dv-spd b').textContent = Math.round(Math.abs(P.v) * 3.6);
      q('.dv-title').textContent = o.title(leg); q('.dv-info').textContent = o.info();
      const ahead = (() => { let acc = 0; for (let i = 1; i < routePts.length; i++) { acc += Math.hypot(routePts[i][0] - routePts[i - 1][0], routePts[i][1] - routePts[i - 1][1]); if (acc > 18) return routePts[i]; } return routePts[routePts.length - 1]; })();
      let rel = Math.atan2(ahead[1] - P.y, ahead[0] - P.x) - P.a; while (rel > PI) rel -= 2 * PI; while (rel < -PI) rel += 2 * PI;
      q('.dv-arrow').style.transform = `rotate(${-rel}rad)`;
      q('.dv-goal').textContent = goal().label + '・' + (routeLen < 1000 ? Math.round(routeLen) + ' m' : (routeLen / 1000).toFixed(1) + ' km');
      if (evT > 0) evT -= dt * 3; else if (ev && !ev.startsWith('🚗')) ev = '';
      q('.dv-ev').textContent = ev; if (ev.startsWith('🚗') && !(o.jams || []).some(j => Math.hypot(P.x - j.x, P.y - j.y) < j.r)) ev = '';
      // warn about the next light ahead
      if (!ev) for (const L of lights) { const d = Math.hypot(L.x - P.x, L.y - P.y); if (d < 45 && d > L.r) { let ra = Math.atan2(L.y - P.y, L.x - P.x) - P.a; while (ra > PI) ra -= 2 * PI; while (ra < -PI) ra += 2 * PI;
        if (Math.abs(ra) < .5) { const st = lightState(L, t); q('.dv-ev').textContent = st === 'r' ? '🔴 前面紅燈' : st === 'a' ? '🟡 黃燈' : ''; break; } } }
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  function finish(ok, msg) {
    if (ended) return; ended = true; cancelAnimationFrame(raf);
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    scene.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) [].concat(x.material).forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); }); });
    renderer.dispose(); if (renderer.forceContextLoss) renderer.forceContextLoss();
    root.hidden = true; root.innerHTML = '';
    o.onEnd({ ok, msg, redRuns, bumps, offRoadSec: offT, leg, at: { x: P.x, y: P.y, a: P.a } });
  }
  // keys/sim/state are for tests (index.html #dev): sim() runs the physics without waiting for animation frames
  return { finish, keys, sim: (sec, step = .05) => { for (let s = 0; s < sec && !ended; s += step) if (!update(step)) break; },
    get state() { return { ...P, leg, waiting, redRuns, bumps, ended, lastHit, offRoad: offRoad(P.x, P.y), lights: lights.length, buildings: blds.length, npc: npc.length, next: routePts.slice(0, 6) }; } };
}
window.StreetDrive = { start };
})();
