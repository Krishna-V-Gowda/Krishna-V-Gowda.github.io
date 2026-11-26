// Two Three.js scenes: the Record's chain of sealed entries, and the order book as a landscape.
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

  const draw = (t) => {
    const k = reduceMotion ? 1 : 0.1;
    const halfSpan = span / 2 + 0.8;
    const sagDepth = 0.42 + (reduceMotion ? 0 : Math.sin(t * 0.6) * 0.05);
    links.forEach((l, i) => {
      l.x += (l.tx - l.x) * k;
      l.drop += (l.tdrop - l.drop) * k;
      const u = l.x / halfSpan;
      const wave = reduceMotion ? 0 : Math.sin(t * 1.3 - i * 0.5) * 0.025;
      // Drape along a gentle curve; each link turns to follow its slope, alternate links stand at right angles.
      l.mesh.position.set(l.x, -sagDepth * (1 - u * u) - l.drop + wave, 0);
      l.mesh.rotation.z = Math.atan((2 * sagDepth * u) / halfSpan);
      l.mesh.rotation.x = (i % 2 ? Math.PI / 2 : 0) + (reduceMotion ? 0 : Math.sin(t * 0.9 + i * 0.7) * 0.06);
      l.mesh.material.color.lerp(l.target, reduceMotion ? 1 : 0.12);
    });
    group.rotation.x = 0.42 + (reduceMotion ? 0 : Math.sin(t * 0.35) * 0.1);
    group.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.23) * 0.035;
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

/* ---------- Start ---------- */

if (!hasWebGL()) {
  document.documentElement.classList.add("no-webgl");
} else {
  import("three")
    .then((THREE) => {
      chainScene(THREE);
      terrainScene(THREE);
    })
    .catch(() => document.documentElement.classList.add("no-webgl"));
}
