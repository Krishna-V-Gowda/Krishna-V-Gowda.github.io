// Three.js scenes: the Record chain, the order-book landscape, and one signature object per project.
// Loaded only where WebGL works; they render only while on screen, and draw one still frame under reduced motion.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Renders while the canvas is on screen and the tab is visible; returns a function that asks for one more frame. */
function runWhenVisible(canvas, draw) {
  let visible = false;
  let raf = 0;
  const loop = (ms) => {
    draw(ms / 1000);
    raf = visible && !document.hidden && !reduceMotion ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) kick();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible) kick(); });
  return kick;
}

function makeRenderer(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return renderer;
}

function lights(THREE, scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(-6, -2, -4);
  scene.add(rim);
}

/* ---------- The chain: one interlocked link per sealed Record entry ---------- */

/** A chain link's centreline: two straights joined by half circles (a stadium), so links hook like real chain. */
function stadiumCurve(THREE, r, h) {
  class Stadium extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const per = 2 * Math.PI * r + 4 * h;
      let s = t * per;
      if (s < 2 * h) return target.set(-h + s, -r, 0);
      s -= 2 * h;
      if (s < Math.PI * r) { const a = -Math.PI / 2 + s / r; return target.set(h + r * Math.cos(a), r * Math.sin(a), 0); }
      s -= Math.PI * r;
      if (s < 2 * h) return target.set(h - s, r, 0);
      s -= 2 * h;
      const a = Math.PI / 2 + s / r;
      return target.set(-h + r * Math.cos(a), r * Math.sin(a), 0);
    }
  }
  return new Stadium();
}

async function chainScene(THREE) {
  const canvas = document.querySelector(".chain3d canvas");
  if (!canvas) return;
  const N = 17;
  // Bend radius R, half-straight H, wire T. Pitch 2(H+R) - 2T - 0.02 seats each bend inside the next link with clearance.
  const R = 0.26, H = 0.22, T = 0.075;
  const PITCH = 2 * (H + R) - 2 * T - 0.02;
  const renderer = makeRenderer(THREE, canvas);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  try {
    const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  } catch {
    lights(THREE, scene); // studio reflections unavailable; plain lighting still reads well
  }

  const group = new THREE.Group();
  scene.add(group);
  const geometry = new THREE.TubeGeometry(stadiumCurve(THREE, R, H), 160, T, 18, true);
  const palette = { pending: new THREE.Color("#b9c2cf"), ok: new THREE.Color(css("--proof")), bad: new THREE.Color(css("--refuse")) };
  const links = Array.from({ length: N }, (_, i) => {
    const material = new THREE.MeshPhysicalMaterial({ color: palette.pending.clone(), metalness: 1, roughness: 0.24, clearcoat: 0.7, clearcoatRoughness: 0.12 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.order = "ZXY";
    group.add(mesh);
    return { mesh, target: palette.pending.clone(), x: 0, tx: 0, drop: 0, tdrop: 0 };
  });
  const span = (N - 1) * PITCH;
  const place = (tampered) => links.forEach((l, i) => {
    l.tx = i * PITCH - span / 2 + (tampered && i >= 8 ? 0.7 : 0) - (tampered ? 0.35 : 0);
    l.tdrop = tampered && (i === 7 || i === 8) ? 0.12 : 0;
  });
  place(false);
  links.forEach((l) => { l.x = l.tx; });

  function fit() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const forWidth = (span + 1.6) / (0.84 * 2 * tan * camera.aspect);
    const forHeight = 1.9 / (2 * tan);
    camera.position.set(0, 0.25, Math.max(forWidth, forHeight));
    camera.lookAt(0, -0.22, 0);
    camera.updateProjectionMatrix();
  }
  fit();
  new ResizeObserver(() => { fit(); kick(); }).observe(canvas);

  // The chain answers the visitor: it leans toward the pointer, and a tap sends a ripple down the links.
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const plucks = [];
  if (!reduceMotion) {
    window.addEventListener("pointermove", (e) => {
      pointer.tx = (e.clientX / innerWidth) * 2 - 1;
      pointer.ty = (e.clientY / innerHeight) * 2 - 1;
    }, { passive: true });
    canvas.style.cursor = "pointer";
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      plucks.push({ u: ((e.clientX - r.left) / r.width) * 2 - 1, t0: null });
      if (plucks.length > 4) plucks.shift();
      if (navigator.vibrate) try { navigator.vibrate(10); } catch {}
      kick();
    });
  }
  const ripple = (t, ui) => plucks.reduce((sum, p) => {
    p.t0 ??= t;
    const dt = t - p.t0 - Math.abs(ui - p.u) * 0.55;
    return dt > 0 ? sum + 0.2 * Math.exp(-dt * 2.6) * Math.sin(dt * 13) : sum;
  }, 0);

  const draw = (t) => {
    const k = reduceMotion ? 1 : 0.1;
    const halfSpan = span / 2 + 0.8;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const sagDepth = 0.42 + (reduceMotion ? 0 : Math.sin(t * 0.6) * 0.05);
    links.forEach((l, i) => {
      l.x += (l.tx - l.x) * k;
      l.drop += (l.tdrop - l.drop) * k;
      const u = l.x / halfSpan;
      const wave = reduceMotion ? 0 : Math.sin(t * 1.3 - i * 0.5) * 0.025;
      // Drape along a gentle curve; each link turns to follow its slope, alternate links stand at right angles.
      l.mesh.position.set(l.x, -sagDepth * (1 - u * u) - l.drop + wave + (reduceMotion ? 0 : ripple(t, l.x / (span / 2))), 0);
      l.mesh.rotation.z = Math.atan((2 * sagDepth * u) / halfSpan);
      l.mesh.rotation.x = (i % 2 ? Math.PI / 2 : 0) + (reduceMotion ? 0 : Math.sin(t * 0.9 + i * 0.7) * 0.06);
      l.mesh.material.color.lerp(l.target, reduceMotion ? 1 : 0.12);
    });
    group.rotation.x = 0.42 + (reduceMotion ? 0 : Math.sin(t * 0.35) * 0.1 + pointer.y * 0.12);
    group.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.23) * 0.035 + pointer.x * 0.16;
    renderer.render(scene, camera);
  };
  const kick = runWhenVisible(canvas, draw);

  const apply = ({ states, tampered }) => {
    states.forEach((s, i) => { if (links[i]) links[i].target = palette[s] || palette.pending; });
    place(tampered);
    kick();
  };
  window.addEventListener("record:state", (event) => apply(event.detail));
  if (window.recordState) apply(window.recordState); // the check may finish before Three.js has loaded
}

/* ---------- The order book as a landscape, from the same 700 real messages ---------- */

async function terrainScene(THREE) {
  const canvas = document.querySelector(".terrain canvas");
  if (!canvas) return;
  const data = await fetch("/assets/data/itch-slice.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!data) return;

  const COLS = 30;
  const ROWS = 70;
  const prices = data.events.filter((e) => e.p).map((e) => e.p);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const bucket = (p) => Math.min(COLS - 1, Math.floor(((p - lo) / (hi - lo || 1)) * COLS));

  // Replay once, taking a snapshot of shares per price bucket every tenth message.
  const orders = new Map();
  const grid = [];
  const snapshot = () => {
    const row = new Array(COLS).fill(0);
    for (const o of orders.values()) row[bucket(o.p)] += o.q;
    grid.push(row);
  };
  data.events.forEach((e, i) => {
    const o = orders.get(e.r);
    if (e.t === "A" || e.t === "F") orders.set(e.r, { p: e.p, q: e.q });
    else if ((e.t === "E" || e.t === "C" || e.t === "X") && o) { o.q -= e.q; if (o.q <= 0) orders.delete(e.r); }
    else if (e.t === "D") orders.delete(e.r);
    else if (e.t === "U" && o) { orders.delete(e.r); orders.set(e.n, { p: e.p, q: e.q }); }
    if ((i + 1) % 10 === 0 && grid.length < ROWS) snapshot();
  });
  while (grid.length < ROWS) snapshot();
  // A light 3x3 blur turns isolated orders into readable terrain rather than needles.
  const smooth = grid.map((row, r) => row.map((_, c) => {
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const v = grid[r + dr]?.[c + dc];
      if (v !== undefined) { sum += v; n++; }
    }
    return sum / n;
  }));
  grid.splice(0, grid.length, ...smooth);
  const peak = Math.log1p(Math.max(1, ...grid.flat()));

  const renderer = makeRenderer(THREE, canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  lights(THREE, scene);

  const geometry = new THREE.PlaneGeometry(6, 5.2, COLS - 1, ROWS - 1);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(css("--paper"));
  const high = new THREE.Color(css("--proof"));
  const c = new THREE.Color();
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const idx = r * COLS + col;
      const h = Math.log1p(grid[r][col]) / peak;
      pos.setZ(idx, h * 1.05);
      c.copy(low).lerp(high, Math.min(1, 0.15 + h * 1.1));
      colors.set([c.r, c.g, c.b], idx * 3);
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }));
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: new THREE.Color(css("--ink")), transparent: true, opacity: 0.12 }));
  const land = new THREE.Group();
  land.add(surface, wire);
  land.rotation.x = -Math.PI / 2.35;
  const spin = new THREE.Group();
  spin.add(land);
  scene.add(spin);

  function fit() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 4.2, 8.6 / Math.min(1.5, Math.max(0.85, camera.aspect / 1.8)));
    camera.lookAt(0, 0.1, 0);
    camera.updateProjectionMatrix();
  }
  fit();
  const kick = runWhenVisible(canvas, (t) => {
    spin.rotation.y = reduceMotion ? -0.35 : Math.sin(t * 0.18) * 0.55;
    renderer.render(scene, camera);
  });
  new ResizeObserver(() => { fit(); kick(); }).observe(canvas);
}

/* ---------- Shared pieces for the signature scenes ---------- */

const buzz = (pattern) => { if (!reduceMotion && navigator.vibrate) try { navigator.vibrate(pattern); } catch {} };

/** Follow a demo in site.js: run fn on each event, and once now if the demo already reported. */
function follow(name, fn) {
  window.addEventListener(`demo:${name}`, (e) => fn(e.detail));
  if (window.demoState?.[name]) fn(window.demoState[name]);
}

/** Build a scene only when its canvas comes near the screen, so the page opens fast. */
function whenNear(canvas, build) {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) { io.disconnect(); build(); }
  }, { rootMargin: "300px" });
  io.observe(canvas);
}

/** A renderer, a scene lit by a studio environment, and a camera that keeps the canvas's shape. */
async function stage(THREE, canvas, fov = 30) {
  const renderer = makeRenderer(THREE, canvas);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  try {
    const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  } catch {
    lights(THREE, scene);
  }
  const fit = () => {
    renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
    camera.aspect = (canvas.clientWidth || 1) / (canvas.clientHeight || 1);
    camera.updateProjectionMatrix();
  };
  fit();
  return { renderer, scene, camera, fit };
}

function animate(canvas, s, draw) {
  const kick = runWhenVisible(canvas, (t) => { draw(t); s.renderer.render(s.scene, s.camera); });
  new ResizeObserver(() => { s.fit(); kick(); }).observe(canvas);
  return kick;
}

const metal = (THREE, color, rough = 0.3) => new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: rough, clearcoat: 0.5, clearcoatRoughness: 0.2 });

/* ---------- Proofloom: a balance that will not balance ---------- */

function balanceScene(THREE) {
  const canvas = document.querySelector('[data-sig="proofloom"] canvas');
  if (!canvas) return;
  whenNear(canvas, async () => {
    const s = await stage(THREE, canvas, 28);
    s.camera.position.set(0, 1.5, 7.4);
    s.camera.lookAt(0, 0.9, 0);
    const steel = metal(THREE, "#c3ccd8", 0.25);
    const coin = metal(THREE, "#f2c14e", 0.16);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); s.scene.add(m); return m; };
    add(new THREE.CylinderGeometry(0.75, 0.9, 0.18, 48), steel, 0, 0.09, 0);
    add(new THREE.CylinderGeometry(0.07, 0.07, 2.2, 24), steel, 0, 1.25, 0);
    const beam = new THREE.Group();
    beam.position.set(0, 2.36, 0);
    s.scene.add(beam);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.09, 0.12), steel);
    beam.add(bar);
    const pivot = add(new THREE.SphereGeometry(0.13, 32, 16), steel, 0, 2.36, 0);
    pivot.material = steel;
    // Each pan hangs from a beam end and stays level, so it is positioned in world space every frame.
    const pans = [-1, 1].map((side) => {
      const g = new THREE.Group();
      const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.07, 48), steel);
      g.add(pan);
      for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.05, 6), steel);
        cord.position.set(Math.cos(a) * 0.5 * 0.55, 0.52, Math.sin(a) * 0.5 * 0.55);
        cord.lookAt(0, 1.05, 0);
        cord.rotateX(Math.PI / 2);
        g.add(cord);
      }
      // Expected settlement on the left, the processor's report on the right: equal stacks to the eye.
      for (let i = 0; i < 9; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 40), coin);
        c.position.set(Math.sin(i * 2.1) * 0.012, 0.07 + i * 0.065, Math.cos(i * 1.7) * 0.012);
        g.add(c);
      }
      s.scene.add(g);
      return g;
    });
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.9, 64), new THREE.MeshBasicMaterial({ color: css("--refuse"), transparent: true, opacity: 0 }));
    glow.rotation.x = -Math.PI / 2;
    s.scene.add(glow);

    let angle = 0, velocity = 0, target = 0, state = "running";
    let kick = () => {};
    follow("proofloom", (d) => {
      state = d.state;
      // The books are short on the processor's side, so the left pan (what should be there) sinks.
      target = d.state === "refused" ? 0.13 : 0;
      if (d.state === "refused") velocity += 1.6; // the jolt of the refusal
      kick();
    });
    kick = animate(canvas, s, (t) => {
      if (reduceMotion) { angle = target; } else {
        const dt = 1 / 60;
        velocity += (-22 * (angle - target) - 3.2 * velocity) * dt;
        angle += velocity * dt;
      }
      beam.rotation.z = angle + (reduceMotion || state === "refused" ? 0 : Math.sin(t * 1.2) * 0.015);
      pans.forEach((g, i) => {
        const side = i ? 1 : -1;
        g.position.set(side * 1.6 * Math.cos(beam.rotation.z), 2.36 + side * 1.6 * Math.sin(beam.rotation.z) - 1.08, 0);
      });
      glow.position.set(pans[1].position.x, pans[1].position.y - 0.05, 0);
      glow.material.opacity += ((state === "refused" ? 0.55 + Math.sin(t * 4) * 0.2 : 0) - glow.material.opacity) * 0.1;
      s.scene.rotation.y = reduceMotion ? -0.3 : -0.3 + Math.sin(t * 0.3) * 0.12;
    });
  });
}

/* ---------- TrustBench and Apex: two fingerprints that must line up ---------- */

const APEX_FINGERPRINT = "51a9853d2a465a71197a28e71d16821d69b3cbbebf6c1bdc753563c12a3688df";

function ringsScene(THREE) {
  const canvas = document.querySelector('[data-sig="trustbench"] canvas');
  if (!canvas) return;
  whenNear(canvas, async () => {
    const s = await stage(THREE, canvas, 30);
    s.camera.position.set(0, 3.6, 5.6);
    s.camera.lookAt(0, 0.2, 0);
    const bytes = (hex) => hex.match(/../g).map((h) => parseInt(h, 16) / 255);
    const recorded = bytes(APEX_FINGERPRINT);
    const proof = new THREE.Color(css("--proof")), idle = new THREE.Color("#b9c2cf"), bad = new THREE.Color(css("--refuse"));
    const ring = (radius, mat) => {
      const g = new THREE.Group();
      const bars = recorded.map((_, i) => {
        const a = (i / 32) * Math.PI * 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1, 0.11), mat);
        m.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        m.rotation.y = -a;
        g.add(m);
        return m;
      });
      s.scene.add(g);
      return { g, bars, heights: recorded.map(() => 0.2), targets: recorded.map(() => 0.2) };
    };
    const inner = ring(1.15, new THREE.MeshPhysicalMaterial({ color: "#8f9bab", metalness: 0.5, roughness: 0.35 }));
    const outerMat = new THREE.MeshPhysicalMaterial({ color: idle.clone(), metalness: 0.25, roughness: 0.3, clearcoat: 0.6, emissive: new THREE.Color(0x000000) });
    const outer = ring(1.75, outerMat);
    inner.targets = recorded.map((v) => 0.15 + v * 1.2);
    let state = "running", colorTarget = idle;
    let kick = () => {};
    follow("apex", (d) => {
      state = d.state;
      if (d.hash) outer.targets = bytes(d.hash).map((v) => 0.15 + v * 1.2);
      colorTarget = d.state === "match" ? proof : d.state === "changed" ? bad : idle;
      kick();
    });
    const set = (r) => r.bars.forEach((m, i) => { m.scale.y = r.heights[i]; m.position.y = r.heights[i] / 2; });
    kick = animate(canvas, s, (t) => {
      const k = reduceMotion ? 1 : 0.08;
      inner.heights = inner.heights.map((h, i) => h + (inner.targets[i] - h) * k);
      outer.heights = outer.heights.map((h, i) => state === "running" && !reduceMotion
        ? 0.15 + (0.5 + 0.5 * Math.sin(t * 9 + i * 1.7)) * 1.2  // still computing: the live ring scrambles
        : h + (outer.targets[i] - h) * k);
      set(inner); set(outer);
      outerMat.color.lerp(colorTarget, reduceMotion ? 1 : 0.08);
      outerMat.emissive.lerp(state === "match" ? proof.clone().multiplyScalar(0.35) : new THREE.Color(0x000000), reduceMotion ? 1 : 0.08);
      const spin = reduceMotion ? 0.4 : t * 0.25;
      inner.g.rotation.y = spin;
      outer.g.rotation.y = spin; // locked together: byte i of each ring stays on the same bearing
    });
  });
}

/* ---------- RiskLab: six wealth paths as walls in depth ---------- */

function ribbonsScene(THREE) {
  const canvas = document.querySelector('[data-sig="risklab"] canvas');
  if (!canvas) return;
  whenNear(canvas, async () => {
    const data = await fetch("/assets/data/risklab-wealth.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data) return;
    const s = await stage(THREE, canvas, 32);
    s.camera.position.set(3.4, 2.6, 6.2);
    s.camera.lookAt(0, 0.7, 0);
    const ranked = Object.entries(data.curves).sort((a, b) => b[1].at(-1) - a[1].at(-1));
    const best = ranked[0][0];
    const L = 5.6;
    const walls = ranked.map(([name, curve], rank) => {
      const n = curve.length;
      const pos = new Float32Array(n * 2 * 3);
      curve.forEach((v, i) => {
        const x = -L / 2 + (L * i) / (n - 1), z = -1.1 + rank * 0.44, y = v * 1.5;
        pos.set([x, 0, z, x, y, z], i * 6);
      });
      const idx = [];
      for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const color = name === best ? css("--proof") : name === "equal_weight" ? css("--ink") : "#9aa6b6";
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: name === best ? 0.95 : name === "equal_weight" ? 0.6 : 0.5 }));
      s.scene.add(mesh);
      return { mesh, count: idx.length };
    });
    // The ₹1 starting line, so the losses read as losses.
    const start = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.6), new THREE.MeshBasicMaterial({ color: css("--proof"), transparent: true, opacity: 0.06, side: THREE.DoubleSide }));
    start.rotation.x = -Math.PI / 2;
    start.position.y = 1.5;
    s.scene.add(start);
    let t0 = null;
    animate(canvas, s, (t) => {
      t0 ??= t;
      const p = reduceMotion ? 1 : Math.min(1, (t - t0) / 3.2);
      walls.forEach((w) => w.mesh.geometry.setDrawRange(0, Math.floor((w.count / 6) * p) * 6));
      s.scene.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.2) * 0.18;
    });
  });
}

/* ---------- DATA301: the error surface, with gradient descent rolling down it ---------- */

function bowlScene(THREE) {
  const canvas = document.querySelector('[data-sig="data301"] canvas');
  if (!canvas) return;
  whenNear(canvas, async () => {
    // The same 36 points as the 2D lab (same seed and generator), so the ball follows the same path.
    let seed = 301;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pts = Array.from({ length: 36 }, () => { const px = rand(); return [px, 0.18 + 0.62 * px + (rand() - 0.5) * 0.22]; });
    const loss = (w, b) => pts.reduce((sum, [px, py]) => sum + (w * px + b - py) ** 2, 0) / pts.length;
    const W = [-0.9, 1.6], B = [-0.45, 1.25], SIZE = 4.4;
    const toX = (w) => ((w - W[0]) / (W[1] - W[0]) - 0.5) * SIZE;
    const toZ = (b) => ((b - B[0]) / (B[1] - B[0]) - 0.5) * SIZE;
    const height = (w, b) => Math.log1p(loss(w, b) * 10) * 0.55;

    const s = await stage(THREE, canvas, 32);
    s.camera.position.set(4.6, 3.0, 5.2);
    s.camera.lookAt(0, 0.12, 0);
    const SEG = 64;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const low = new THREE.Color(css("--proof")), high = new THREE.Color(css("--paper"));
    const c = new THREE.Color();
    let maxH = 0;
    const hs = [];
    for (let i = 0; i < pos.count; i++) {
      const w = W[0] + (pos.getX(i) / SIZE + 0.5) * (W[1] - W[0]);
      const b = B[0] + (pos.getZ(i) / SIZE + 0.5) * (B[1] - B[0]);
      const h = height(w, b);
      hs.push(h); maxH = Math.max(maxH, h);
      pos.setY(i, h);
    }
    hs.forEach((h, i) => { c.copy(low).lerp(high, Math.min(1, h / maxH)); colors.set([c.r, c.g, c.b], i * 3); });
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    s.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05 })));
    s.scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: css("--ink"), transparent: true, opacity: 0.06 })));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 16), metal(THREE, "#d9a93a", 0.2));
    s.scene.add(ball);
    const trail = [];
    const trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: css("--ink") }));
    s.scene.add(trailLine);
    const place = (w, b, step) => {
      if (step === 0) trail.length = 0;
      const p = new THREE.Vector3(toX(w), height(w, b) + 0.12, toZ(b));
      ball.position.copy(p);
      trail.push(p.clone().setY(p.y - 0.06));
      trailLine.geometry.setFromPoints(trail);
      kick?.();
    };
    let kick = null;
    place(-0.4, 0.85, 0);
    follow("gd", (d) => place(d.w, d.b, d.step));
    kick = animate(canvas, s, (t) => {
      s.scene.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.22) * 0.25;
    });
  });
}

/* ---------- Start ---------- */

if (!hasWebGL()) {
  document.documentElement.classList.add("no-webgl");
} else {
  import("three")
    .then((THREE) => {
      chainScene(THREE);
      terrainScene(THREE);
      balanceScene(THREE);
      ringsScene(THREE);
      ribbonsScene(THREE);
      bowlScene(THREE);
    })
    .catch(() => document.documentElement.classList.add("no-webgl"));
}
