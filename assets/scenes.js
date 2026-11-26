// Three.js scenes: the hero ledger of light, the order-book landscape, and one signature object per project, each following its demo.
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

/* ---------- The hero: KRIVANCE's Record as a chain of light. Each block is a real signed forecast ---------- */

function ledgerScene(THREE) {
  const canvas = document.querySelector("canvas.ledger3d");
  if (!canvas) return;
  const tip = document.querySelector(".ledger-label");
  const hint = document.querySelector(".ledger-hint");
  let built = null;
  // Built from the first report of the in-browser check, so every label is a real entry hash.
  follow("record", async (d) => {
    if (!built) built = build(d);
    (await built)(d);
  });

  async function build(first) {
    const N = first.hashes.length;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(css("--paper"));
    scene.fog = new THREE.Fog(css("--paper"), 9, 20);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.4, 12.5);
    let composer = null;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import("three/addons/postprocessing/EffectComposer.js"),
        import("three/addons/postprocessing/RenderPass.js"),
        import("three/addons/postprocessing/UnrealBloomPass.js"),
      ]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.5, 0.18));
    } catch {} // without bloom the chain still reads; it just doesn't glow

    const col = { pending: new THREE.Color(css("--g4")), ok: new THREE.Color("#ffffff"), head: new THREE.Color(css("--proof")), bad: new THREE.Color(css("--refuse")), shell: new THREE.Color(css("--g1")) };
    const world = new THREE.Group();
    scene.add(world);
    const spin = new THREE.Group();
    world.add(spin);

    // A rising helix: page 0 at the bottom, the newest page at the top.
    const pos = Array.from({ length: N }, (_, i) => { const a = i * 0.62; return new THREE.Vector3(Math.cos(a) * 1.95, (i - (N - 1) / 2) * 0.28, Math.sin(a) * 1.95); });
    const shellGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.56, 0.56, 0.56));
    const coreGeo = new THREE.BoxGeometry(0.17, 0.17, 0.17);
    const hitGeo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const label = (text, c) => {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 64;
      const g = cv.getContext("2d");
      g.font = `400 30px ${css("--mono") || "monospace"}`;
      g.fillStyle = c;
      g.fillText(text, 4, 42);
      return new THREE.CanvasTexture(cv);
    };
    const nodes = pos.map((p, i) => {
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.set(i * 0.31, i * 0.53, 0);
      const shell = new THREE.LineSegments(shellGeo, new THREE.LineBasicMaterial({ color: css("--g1"), transparent: true, opacity: 0.55 }));
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: col.pending.clone() }));
      const hit = new THREE.Mesh(hitGeo, hitMat);
      hit.userData.i = i;
      g.add(shell, core, hit);
      spin.add(g);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(first.hashes[i].slice(0, 8), css("--g2")), transparent: true, opacity: 0.85, depthWrite: false }));
      sprite.scale.set(1.05, 0.26, 1);
      sprite.position.copy(p).add(new THREE.Vector3(0.8, 0.28, 0));
      spin.add(sprite);
      return { g, shell, core, hit, sprite, hash: first.hashes[i], target: col.pending.clone(), flash: 0, push: 0, state: "pending" };
    });
    // One link per pair, so a broken link can show on its own.
    const curve = new THREE.CatmullRomCurve3(pos);
    const links = pos.slice(1).map((_, i) => {
      const pts = curve.getPoints((N - 1) * 16).slice(i * 16, i * 16 + 17);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col.head.clone(), transparent: true, opacity: 0.15 }));
      spin.add(line);
      return { line, target: 0.15, color: col.head.clone() };
    });
    // A faint field of construction lines for depth.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const field = [];
    for (let i = 0; i < 90; i++) {
      const a = new THREE.Vector3(rnd() * 12, rnd() * 9, rnd() * 7 - 1);
      field.push(a, a.clone().add(new THREE.Vector3(rnd() * 3, rnd() * 3, rnd())));
    }
    world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(field), new THREE.LineBasicMaterial({ color: css("--g4"), transparent: true, opacity: 0.5 })));

    let wide = true;
    const fit = () => {
      const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
      camera.aspect = w / h;
      wide = camera.aspect > 1.15;
      // Beside the words on wide screens; on narrow ones, smaller and centred in the space left below them (the hero pads 380px for it).
      const visible = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      world.position.set(wide ? Math.min(3.2, camera.aspect * 1.45) : 0, wide ? 0 : (0.5 - (1 - 200 / h)) * visible, 0);
      world.scale.setScalar(wide ? 1 : 0.62);
      nodes.forEach((n) => { n.sprite.visible = wide; });
      camera.updateProjectionMatrix();
    };
    fit();

    // Drag to turn, with inertia; the pointer gives a little parallax; a tap forges a page.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let lastMove = null;
    let yaw = 0, vyaw = reduceMotion ? 0 : 0.0016, tilt = 0, mx = 0, my = 0, drag = null, hover = -1, shake = 0;
    const pick = (e) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(nodes.map((n) => n.hit))[0]?.object.userData.i ?? -1;
    };
    const showTip = (e, i) => {
      if (i < 0) { tip.classList.remove("on"); return; }
      const r = canvas.getBoundingClientRect();
      const n = nodes[i];
      const word = { ok: "Verified", bad: "Caught", pending: "Checking" }[n.state];
      tip.innerHTML = `<b>Page ${i}</b>, ${current.labels[i]}. ${word}. <code>${n.hash.slice(0, 10)}…</code>`;
      tip.style.left = `${Math.min(e.clientX - r.left, r.width - 330)}px`;
      tip.style.top = `${e.clientY - r.top - 28}px`;
      tip.classList.add("on");
    };
    canvas.addEventListener("pointermove", (e) => {
      mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5;
      if (drag) {
        const dx = e.clientX - drag.x;
        vyaw = dx * 0.004; yaw += vyaw;
        tilt = Math.max(-0.45, Math.min(0.45, tilt + (e.clientY - drag.y) * 0.003));
        drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
        drag.x = e.clientX; drag.y = e.clientY;
      } else {
        lastMove = e;
        const i = pick(e);
        if (i !== hover) { hover = i; if (i >= 0) window.feel?.tick(); }
        canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
        showTip(e, hover);
      }
      kick();
    });
    canvas.addEventListener("pointerleave", () => { hover = -1; tip.classList.remove("on"); });
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0, i: pick(e) }; canvas.setPointerCapture(e.pointerId); hint?.classList.add("gone"); kick(); });
    const up = (e, cancelled) => {
      if (!drag) return;
      if (!cancelled && drag.moved < 8 && drag.i >= 0) {
        window.feel?.tap();
        window.dispatchEvent(new CustomEvent("record:forge", { detail: drag.i }));
      }
      if (reduceMotion) vyaw = 0;
      drag = null;
    };
    canvas.addEventListener("pointerup", (e) => up(e, false));
    canvas.addEventListener("pointercancel", (e) => up(e, true));
    new ResizeObserver(() => { fit(); kick(); }).observe(canvas);

    let current = first;
    const kick = runWhenVisible(canvas, (t) => {
      const k = reduceMotion ? 1 : 0.12;
      if (!drag && !reduceMotion) { yaw += vyaw; vyaw += (0.0016 - vyaw) * 0.02; }
      spin.rotation.y = yaw;
      world.rotation.x = tilt + (reduceMotion ? 0 : my * 0.18);
      world.rotation.y = reduceMotion ? 0 : mx * 0.25;
      nodes.forEach((n, i) => {
        n.core.material.color.lerp(n.target, k);
        n.flash *= reduceMotion ? 0 : 0.9;
        n.push += ((n.state === "bad" ? 0.35 : 0) - n.push) * k;
        const s = 1 + n.flash * 0.9 + (i === hover ? 0.5 : 0);
        n.core.scale.setScalar(s);
        n.shell.scale.setScalar(1 + n.flash * 0.25 + (i === hover ? 0.12 : 0));
        n.shell.material.color.copy(n.state === "bad" ? col.bad : n.target === col.head ? col.head : col.shell);
        n.g.position.copy(pos[i]).multiplyScalar(1 + n.push * 0.25);
        if (!reduceMotion) n.g.rotation.y += 0.004 + n.flash * 0.05;
      });
      links.forEach((l) => {
        l.line.material.opacity += (l.target - l.line.material.opacity) * k;
        l.line.material.color.lerp(l.color, k);
      });
      shake *= 0.9;
      camera.position.x = reduceMotion ? 0 : Math.sin(t * 60) * shake;
      if (composer) composer.render(); else renderer.render(scene, camera);
    });

    return (d) => {
      current = d;
      d.verdicts.forEach((v, i) => {
        const n = nodes[i];
        const state = v === "Verified" ? "ok" : v === "Waiting" ? "pending" : "bad";
        if (state !== n.state && state !== "pending") n.flash = 1; // light runs up the chain as each page checks out
        if (state === "bad" && n.state !== "bad") shake = 0.06;
        n.state = state;
        n.target = state === "bad" ? col.bad : state === "pending" ? col.pending : i === N - 1 ? col.head : col.ok;
        if (d.hashes[i] !== n.hash) {
          n.hash = d.hashes[i];
          n.sprite.material.map.dispose();
          n.sprite.material.map = label(n.hash.slice(0, 8), css(i === d.forged ? "--refuse" : "--g2"));
        }
        if (i === hover && lastMove) showTip(lastMove, i); // keep an open tooltip in step with the check
        if (i > 0) {
          const l = links[i - 1];
          const broken = v === "Link broken";
          l.target = broken ? 0.9 : state === "ok" ? 0.75 : 0.15;
          l.color = broken ? col.bad : col.head;
        }
      });
      kick();
    };
  }
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
  const high = new THREE.Color(css("--c-marketreplay"));
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
  // A glass sheet marks the message the panel beside it has replayed up to.
  const scanMat = new THREE.MeshBasicMaterial({ color: css("--c-marketreplay"), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 1.3), scanMat);
  scan.rotation.x = Math.PI / 2;
  scan.position.set(0, 2.6, 0.62);
  const land = new THREE.Group();
  land.add(surface, wire, scan);
  let scanY = 2.6;
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
    scan.position.y += (scanY - scan.position.y) * (reduceMotion ? 1 : 0.2);
    spin.rotation.y = reduceMotion ? -0.35 : Math.sin(t * 0.18) * 0.55;
    renderer.render(scene, camera);
  });
  new ResizeObserver(() => { fit(); kick(); }).observe(canvas);
  follow("book", (d) => {
    scanY = 2.6 - 5.2 * Math.min(1, d.n / (ROWS * 10));
    scanMat.color.set(d.error ? css("--refuse") : css("--c-marketreplay"));
    scanMat.opacity = d.error ? 0.5 : d.n >= d.total ? 0 : 0.22; // only while replaying or scrubbing
    kick();
  });
}

/* ---------- Shared pieces for the signature scenes ---------- */

const buzz = (pattern) => { if (!reduceMotion && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) try { navigator.vibrate(pattern); } catch {} };

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
    const coin = new THREE.MeshPhysicalMaterial({ color: css("--anchor"), metalness: 0.45, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 });
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
      const was = state;
      state = d.state;
      // Short on the processor's side and the left pan (what should be there) sinks; over, and the right one does.
      target = d.state === "refused" ? Math.max(-0.24, Math.min(0.24, 0.08 * Math.sign(d.diff) + (d.diff / 300) * 0.16)) : 0;
      if (d.state !== was && d.state !== "running") velocity += d.state === "refused" ? 1.6 : -0.8; // the jolt of the verdict
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
      const color = css(["--proof", "--ink", "--g1", "--g2", "--g3", "--g4"][rank]);
      const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide, transparent: true, opacity: name === best ? 0.95 : 0.6 }));
      s.scene.add(mesh);
      return { name, mesh, count: idx.length, show: 1 };
    });
    // The ₹1 starting line, so the losses read as losses.
    const start = new THREE.Mesh(new THREE.PlaneGeometry(L, 1.6), new THREE.MeshBasicMaterial({ color: css("--proof"), transparent: true, opacity: 0.06, side: THREE.DoubleSide }));
    start.rotation.x = -Math.PI / 2;
    start.position.y = 1.5;
    s.scene.add(start);
    let t0 = null;
    let hidden = [];
    const kick = animate(canvas, s, (t) => {
      t0 ??= t;
      const p = reduceMotion ? 1 : Math.min(1, (t - t0) / 3.2);
      walls.forEach((w) => {
        w.mesh.geometry.setDrawRange(0, Math.floor((w.count / 6) * p) * 6);
        w.show += ((hidden.includes(w.name) ? 0 : 1) - w.show) * (reduceMotion ? 1 : 0.15);
        w.mesh.scale.y = Math.max(0.001, w.show);
        w.mesh.visible = w.show > 0.01;
      });
      s.scene.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.2) * 0.18;
    });
    follow("risk", (d) => { hidden = d.hidden; kick(); });
  });
}

/* ---------- DATA301: the error surface for the visitor's points, with gradient descent rolling down it ---------- */

function bowlScene(THREE) {
  const canvas = document.querySelector('[data-sig="data301"] canvas');
  if (!canvas) return;
  whenNear(canvas, async () => {
    // Starts from the same 36 points as the 2D lab (same seed and generator); then follows whatever the visitor does there.
    let seed = 301;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let pts = Array.from({ length: 36 }, () => { const px = rand(); return [px, 0.18 + 0.62 * px + (rand() - 0.5) * 0.22]; });
    const loss = (w, b) => pts.reduce((sum, [px, py]) => sum + (w * px + b - py) ** 2, 0) / pts.length;
    const W = [-0.9, 1.6], B = [-0.45, 1.25], SIZE = 4.4;
    const toX = (w) => ((w - W[0]) / (W[1] - W[0]) - 0.5) * SIZE;
    const toZ = (b) => ((b - B[0]) / (B[1] - B[0]) - 0.5) * SIZE;
    const height = (w, b) => Math.log1p(loss(w, b) * 10) * 0.55;

    const s = await stage(THREE, canvas, 32);
    s.camera.position.set(4.6, 3.0, 5.2);
    s.camera.lookAt(0, 0.12, 0);
    const SEG = 48;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const low = new THREE.Color(css("--c-data301")), high = new THREE.Color(css("--paper"));
    const c = new THREE.Color();
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: css("--ink"), transparent: true, opacity: 0.06 }));
    function reshape() {
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
      pos.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
      wire.geometry.dispose();
      wire.geometry = new THREE.WireframeGeometry(geo);
    }
    reshape();
    s.scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 })), wire);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 16), metal(THREE, "#e8edf3", 0.15));
    s.scene.add(ball);
    const trail = [];
    const trailLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: css("--ink") }));
    s.scene.add(trailLine);
    let kick = () => {};
    let version = 0, dirty = false, last = { w: -0.4, b: 0.85, step: 0 };
    const place = ({ w, b, step }) => {
      if (step === 0) trail.length = 0;
      const p = new THREE.Vector3(toX(w), height(w, b) + 0.12, toZ(b));
      ball.position.copy(p);
      trail.push(p.clone().setY(p.y - 0.06));
      if (trail.length > 400) trail.shift();
      trailLine.geometry.setFromPoints(trail);
    };
    place(last);
    follow("gd", (d) => {
      if (d.version !== version) { version = d.version; pts = d.pts.map((p) => [...p]); dirty = true; trail.length = 0; }
      last = d;
      kick();
    });
    kick = animate(canvas, s, (t) => {
      if (dirty) { dirty = false; reshape(); } // at most once a frame, however fast the visitor drags
      place(last);
      s.scene.rotation.y = reduceMotion ? 0 : Math.sin(t * 0.22) * 0.25;
    });
  });
}

/* ---------- Apex: 120 production runs regrouping into Apex's own PCA view. Drag to spin ---------- */

function apexScenes(THREE) {
  document.querySelectorAll("canvas[data-apex3d]").forEach((canvas) => whenNear(canvas, async () => {
    const data = await fetch("/assets/data/apex-pca.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data) return;
    const s = await stage(THREE, canvas, 32);
    s.camera.position.set(4.4, 3.0, 6.6);
    s.camera.lookAt(0, -0.1, 0);
    const n = data.points.length;
    // The percentages beside the cloud come from the same file it draws, so they can never disagree.
    const demo = canvas.closest(".demo");
    const dds = demo?.querySelectorAll(".counters dd");
    if (dds?.length >= 2) { dds[0].textContent = `${(data.exp[0] * 100).toFixed(1)}%`; dds[1].textContent = `${(data.exp[1] * 100).toFixed(1)}%`; }
    const reach = (pick) => Math.max(...data.points.flatMap(pick).map(Math.abs)) || 1;
    const sScale = 1.9 / reach((p) => p.s), pScale = 2.2 / reach((p) => p.p);
    const lineColor = { A: css("--line-a"), B: css("--line-b"), C: css("--line-c"), D: css("--line-d") };
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 20, 12), new THREE.MeshPhysicalMaterial({ metalness: 0.2, roughness: 0.3, clearcoat: 0.6 }), n);
    data.points.forEach((p, i) => dots.setColorAt(i, new THREE.Color(lineColor[p.line] || lineColor.D)));
    const cloud = new THREE.Group();
    cloud.add(dots);
    s.scene.add(cloud);
    // Faint cube for the raw measurements, faint plane for the PCA view; each fades in with its phase.
    const cube = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(3.8, 3.8, 3.8)), new THREE.LineBasicMaterial({ color: css("--muted"), transparent: true, opacity: 0.25 }));
    const plane = new THREE.GridHelper(4.8, 12, css("--c-apex"), css("--c-apex"));
    plane.material.transparent = true;
    plane.material.opacity = 0;
    cloud.add(cube, plane);
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    const ease = (x) => x * x * (3 - 2 * x);
    let t0 = null, mode = null, k = 0;
    const say = (view) => window.dispatchEvent(new CustomEvent("demo:apexview", { detail: view }));
    const button = demo?.querySelector(".replay");
    if (button) button.addEventListener("click", () => { t0 = null; mode = null; say(null); window.feel?.tap(); kick(); });
    follow("apexpca", (d) => { mode = d.view; kick(); });
    // Drag to spin, with a little inertia; a vertical drag tilts within limits.
    let yaw = 0.5, pitch = 0, vy = 0, drag = null, auto = true;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; auto = false; canvas.setPointerCapture(e.pointerId); window.feel?.tick(); kick(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      vy = (e.clientX - drag.x) * 0.01;
      yaw += vy;
      pitch = Math.max(-0.5, Math.min(0.6, pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
      kick();
    });
    const up = () => { drag = null; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    // One cycle when left alone: hold the raw view, glide into PCA, hold, glide back.
    const phase = (u) => (u < 2.5 ? 0 : u < 4.5 ? ease((u - 2.5) / 2) : u < 8 ? 1 : u < 10 ? 1 - ease((u - 8) / 2) : 0);
    const kick = animate(canvas, s, (t) => {
      t0 ??= t;
      const goal = mode === "raw" ? 0 : mode === "pca" ? 1 : phase((t - t0) % 10.5);
      k = reduceMotion ? goal : mode ? k + (goal - k) * 0.08 : goal;
      data.points.forEach((p, i) => {
        const a = [p.s[0] * sScale, p.s[1] * sScale, p.s[2] * sScale];
        const b = [p.p[0] * pScale, 0, p.p[1] * pScale];
        v.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
        dots.setMatrixAt(i, m.makeTranslation(v.x, v.y, v.z));
      });
      dots.instanceMatrix.needsUpdate = true;
      cube.material.opacity = 0.25 * (1 - k);
      plane.material.opacity = 0.3 * k;
      if (!drag) { yaw += vy; vy *= 0.94; }
      if (auto && !reduceMotion) yaw = 0.5 + Math.sin(t * 0.2) * 0.35;
      cloud.rotation.set(pitch, yaw, 0);
    });
  }));
}

/* ---------- Start ---------- */

if (!hasWebGL()) {
  document.documentElement.classList.add("no-webgl");
} else {
  import("three")
    .then((THREE) => {
      ledgerScene(THREE);
      terrainScene(THREE);
      balanceScene(THREE);
      ringsScene(THREE);
      ribbonsScene(THREE);
      bowlScene(THREE);
      apexScenes(THREE);
    })
    .catch(() => document.documentElement.classList.add("no-webgl"));
}
