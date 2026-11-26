"use strict";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => (reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const token = (el) => (el._run = (el._run || 0) + 1);
const color = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const inr = (paise) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

/** Start a demo the first time it is mostly on screen; its Replay button runs it again. */
function whenVisible(el, start) {
  const button = $(".replay", el);
  if (button) button.addEventListener("click", start);
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      start();
    }
  }, { threshold: 0.35 });
  io.observe(el);
}

function sizeCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 640;
  const h = Math.round((w * 300) / 640);
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ---------- The Record: the same rules as KRIVANCE's lib/record/core.ts ---------- */

const GENESIS = "33eb59f203bbbc9cae5b3cb86787e178dd4d1864062f8aa020fae1a50b2c05b6";
const BODY = ["seq", "id", "stream", "series", "reference", "model", "commitment", "prev", "sealedAt", "deadline", "keyId"];
const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const sha256 = async (text) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

function canonical(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
const entryHash = (e) => sha256(canonical(Object.fromEntries(BODY.map((k) => [k, e[k]]))));

async function signatureCheck(keys) {
  const imported = new Map();
  for (const k of keys) {
    try {
      imported.set(k.id, await crypto.subtle.importKey("raw", fromHex(k.publicKey), { name: "Ed25519" }, false, ["verify"]));
    } catch {
      return null; // this browser cannot verify Ed25519
    }
  }
  return async (e, hash) => {
    const key = imported.get(e.keyId);
    if (!key) return false;
    try {
      return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64(e.signature), fromHex(hash));
    } catch {
      return false;
    }
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function describe(e) {
  if (e.stream === "half-life-monthly") {
    const [y, m] = e.reference.split("-");
    return `Forward Ledger for ${MONTHS[+m - 1]} ${y}`;
  }
  const [, m, d] = e.reference.split("-");
  return `${e.series} rate forecast for ${+d} ${MONTHS[+m - 1]}`;
}

function scramble(el, finalText, ms) {
  if (reduceMotion) { el.textContent = finalText; return Promise.resolve(); }
  const hexChars = "0123456789abcdef";
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const fixed = Math.floor(p * finalText.length);
      let out = finalText.slice(0, fixed);
      for (let i = fixed; i < finalText.length; i++) out += hexChars[(Math.random() * 16) | 0];
      el.textContent = out;
      if (p < 1) requestAnimationFrame(step); else { el.textContent = finalText; resolve(); }
    };
    requestAnimationFrame(step);
  });
}

async function initRecord() {
  const list = $("#chain");
  const status = $("#chain-status");
  const anchor = $("#chain-anchor");
  const tamperBtn = $("#tamper");
  if (!list) return;
  let record;
  try {
    record = await getJSON("assets/data/record.json");
  } catch (err) {
    status.textContent = "Could not load the record";
    status.className = "chain-status bad";
    return;
  }
  if (!window.crypto?.subtle) {
    status.textContent = "This page needs HTTPS to run its checks";
    status.className = "chain-status bad";
    return;
  }
  const original = record.entries;
  const sigCheck = await signatureCheck(record.keys);
  let tampered = false;

  list.innerHTML = original.map((e) => `
    <li class="link"><span class="seq" aria-hidden="true">${e.seq}</span>
      <span class="what-line"><b>${describe(e)}</b><code>········</code></span>
      <span class="mark">Waiting</span></li>`).join("");

  async function run(fast) {
    const run = token(list);
    const entries = tampered ? await coverUp(original, 7) : original;
    const rows = [...list.children];
    const states = entries.map(() => "pending");
    const announce = () => {
      window.recordState = { states: [...states], tampered };
      window.dispatchEvent(new CustomEvent("record:state", { detail: window.recordState }));
    };
    rows.forEach((r) => { r.className = "link"; $(".mark", r).textContent = "Waiting"; });
    announce();
    status.className = "chain-status";
    let prev = GENESIS;
    let good = 0;
    let firstBad = null;
    for (let i = 0; i < entries.length; i++) {
      if (run !== list._run) return;
      const e = entries[i];
      const row = rows[i];
      status.textContent = `Checking ${i + 1} of ${entries.length}`;
      const hash = await entryHash(e);
      await scramble($("code", row), hash, fast ? 90 : 230);
      const contentOk = hash === e.hash;
      const linkOk = e.prev === prev && e.seq === i;
      const sigOk = sigCheck ? await sigCheck(e, e.hash) : true;
      let verdict = "Verified";
      if (!linkOk) verdict = "Link broken";
      else if (!contentOk) verdict = "Contents altered";
      else if (!sigOk) verdict = "Signature fails";
      const ok = verdict === "Verified";
      row.classList.add(ok ? "done" : "fail");
      if (!linkOk) row.classList.add("broken-link");
      $(".mark", row).textContent = verdict;
      if (ok) good++; else if (firstBad === null) firstBad = verdict;
      states[i] = ok ? "ok" : "bad";
      announce();
      // Scroll only the panel, never the page: the visitor may be reading the headline.
      const bottom = row.offsetTop + row.offsetHeight - list.clientHeight + 6;
      if (!fast && bottom > list.scrollTop) list.scrollTo({ top: bottom, behavior: reduceMotion ? "auto" : "smooth" });
      prev = e.hash;
      await sleep(fast ? 20 : 60);
    }
    if (run !== list._run) return;
    if (good === entries.length) {
      status.textContent = sigCheck ? `All ${good} entries verify` : `All ${good} hashes and links verify`;
      status.className = "chain-status ok";
      const confirmed = record.receipts.filter((r) => r.status === "confirmed" && r.bitcoin.length);
      const last = confirmed.reduce((a, b) => (b.headSeq > a.headSeq ? b : a), confirmed[0]);
      anchor.innerHTML = last
        ? `Entries 0 to ${last.headSeq} are timestamped in <span class="btc">Bitcoin block ${Math.max(...last.bitcoin).toLocaleString("en-US")}</span>.`
        : "";
    } else {
      status.textContent = "Tampering caught";
      status.className = "chain-status bad";
      list.scrollTo({ top: rows[7].offsetTop - 12, behavior: reduceMotion ? "auto" : "smooth" });
      anchor.textContent = sigCheck
        ? "Entry 7 was edited and its hash recomputed to hide it. Its signature no longer matches, and entry 8 no longer links to it."
        : "Entry 7 was edited and its hash recomputed to hide it. Entry 8 no longer links to it.";
    }
    if (!sigCheck) $("#chain-fine").textContent = "This browser cannot check Ed25519 signatures, so only hashes and links were checked. A recent Chrome, Safari or Firefox checks all three.";
  }

  tamperBtn.addEventListener("click", () => {
    tampered = !tampered;
    tamperBtn.textContent = tampered ? "Undo the tampering" : "Tamper with entry 7";
    run(true);
  });
  run(false);
}

/** Edit one entry and recompute its hash to hide the edit, as a forger would. */
async function coverUp(entries, k) {
  const copy = entries.map((e) => ({ ...e }));
  const e = copy[k];
  e.commitment = e.commitment.slice(0, -1) + (e.commitment.endsWith("0") ? "1" : "0");
  e.hash = await entryHash(e);
  return copy;
}

/* ---------- Proofloom ---------- */

async function initProofloom() {
  const el = $('[data-demo="proofloom"]');
  if (!el) return;
  const d = await getJSON("assets/data/proofloom-settlement.json").catch(() => null);
  if (!d) return;
  const k = (name) => $(`[data-k="${name}"]`, el);
  const gross = d.payments.reduce((a, b) => a + b, 0);
  const consistent = gross - d.refunds - d.fees - d.tax === d.expected;
  whenVisible(el, async () => {
    const run = token(el);
    ["refunds", "fees", "tax", "expected", "reported", "diff"].forEach((n) => (k(n).textContent = ""));
    k("verdict").innerHTML = "";
    $(".ledger-row.diff", el).classList.remove("bad");
    let sum = 0;
    for (const p of d.payments) {
      if (run !== el._run) return;
      sum += p;
      k("gross").textContent = inr(sum);
      await sleep(55);
    }
    for (const [n, v] of [["refunds", d.refunds], ["fees", d.fees], ["tax", d.tax]]) {
      await sleep(260);
      if (run !== el._run) return;
      k(n).textContent = "− " + inr(v);
    }
    await sleep(320);
    k("expected").textContent = inr(d.expected);
    await sleep(420);
    k("reported").textContent = inr(d.reported);
    await sleep(380);
    if (run !== el._run) return;
    const diff = d.expected - d.reported;
    k("diff").textContent = inr(diff);
    $(".ledger-row.diff", el).classList.toggle("bad", diff !== 0);
    k("verdict").innerHTML = !consistent
      ? "The published records don't add up; this demo stopped."
      : diff === 0
        ? '<span class="stamp good stamp-in">Close allowed</span>'
        : `<span class="stamp bad stamp-in">Close refused</span><span>${Math.abs(diff)} paise unaccounted for</span>`;
  });
}

/* ---------- MarketReplay ---------- */

async function initBook() {
  const el = $('[data-demo="book"]');
  if (!el) return;
  const d = await getJSON("assets/data/itch-slice.json").catch(() => null);
  if (!d) return;
  const canvas = $("canvas", el);
  const k = (name) => $(`[data-k="${name}"]`, el);

  function draw(levels) {
    const { ctx, w, h } = sizeCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    // The 14 largest price levels, highest price first. The fixture's prices are synthetic, so no spread is implied.
    const rows = [...levels].map(([key, q]) => [key[0], +key.slice(1), q]).sort((a, b) => b[2] - a[2]).slice(0, 14).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[2]));
    const rowH = h / 14;
    const labelW = Math.min(118, w * 0.26);
    ctx.font = `500 ${Math.max(10, Math.min(12.5, w / 52))}px ${getComputedStyle(document.body).getPropertyValue("--mono") || "monospace"}`;
    ctx.textBaseline = "middle";
    rows.forEach(([side, price, q], i) => {
      const y = i * rowH;
      const barW = ((w - labelW - 64) * q) / max;
      ctx.fillStyle = side === "S" ? color("--refuse") : color("--proof");
      ctx.globalAlpha = 0.85;
      ctx.fillRect(labelW, y + rowH * 0.18, Math.max(2, barW), rowH * 0.64);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color("--muted");
      ctx.fillText(`${side === "S" ? "Sell" : "Buy"} $${(price / 10000).toFixed(4)}`, 0, y + rowH / 2);
      ctx.fillStyle = color("--ink");
      ctx.fillText(q.toLocaleString("en-US"), labelW + Math.max(2, barW) + 8, y + rowH / 2);
    });
  }

  whenVisible(el, async () => {
    const run = token(el);
    const orders = new Map();
    const levels = new Map();
    let checks = 0;
    const bump = (o, delta) => {
      const key = o.s + o.p;
      const next = (levels.get(key) || 0) + delta;
      if (next < 0) throw new Error("level underflow");
      if (next === 0) levels.delete(key); else levels.set(key, next);
    };
    const check = (o) => {
      let total = 0;
      for (const x of orders.values()) if (x.s === o.s && x.p === o.p) total += x.q;
      if ((levels.get(o.s + o.p) || 0) !== total) throw new Error(`invariant failed at ${o.s} ${o.p}`);
      checks++;
    };
    try {
      for (let i = 0; i < d.events.length; i++) {
        const ev = d.events[i];
        const o = orders.get(ev.r);
        if (ev.t === "A" || ev.t === "F") {
          const n = { s: ev.s, p: ev.p, q: ev.q };
          orders.set(ev.r, n); bump(n, n.q); check(n);
        } else if (ev.t === "E" || ev.t === "C" || ev.t === "X") {
          if (!o || ev.q > o.q) throw new Error("reduction exceeds resting shares");
          o.q -= ev.q; bump(o, -ev.q);
          if (o.q === 0) orders.delete(ev.r);
          check(o);
        } else if (ev.t === "D") {
          if (!o) throw new Error("delete of unknown order");
          orders.delete(ev.r); bump(o, -o.q); check(o);
        } else if (ev.t === "U") {
          if (!o) throw new Error("replace of unknown order");
          orders.delete(ev.r); bump(o, -o.q); check(o);
          const n = { s: o.s, p: ev.p, q: ev.q };
          orders.set(ev.n, n); bump(n, n.q); check(n);
        }
        if (!reduceMotion && i % 3 === 2) {
          if (run !== el._run) return;
          k("msgs").textContent = (i + 1).toLocaleString("en-US");
          k("orders").textContent = orders.size.toLocaleString("en-US");
          k("checks").textContent = checks.toLocaleString("en-US");
          draw(levels);
          await frame();
        }
      }
    } catch (err) {
      $(".fine", el).textContent = `Replay stopped: ${err.message}.`;
      return;
    }
    if (run !== el._run) return;
    k("msgs").textContent = d.events.length.toLocaleString("en-US");
    k("orders").textContent = orders.size.toLocaleString("en-US");
    k("checks").textContent = `${checks.toLocaleString("en-US")} passed`;
    draw(levels);
  });
}

/* ---------- TrustBench and Apex ---------- */

const APEX_URL = "https://krishna-v-gowda.github.io/EDA-InsightLab-Apex/assets/js/app.js";
const APEX_FINGERPRINT = "51a9853d2a465a71197a28e71d16821d69b3cbbebf6c1bdc753563c12a3688df";

function initApex() {
  const el = $('[data-demo="apex"]');
  if (!el) return;
  const k = (name) => $(`[data-k="${name}"]`, el);
  whenVisible(el, async () => {
    const run = token(el);
    k("before").style.width = "0";
    k("after").style.width = "0";
    k("verdict").innerHTML = "";
    const live = k("live");
    live.className = "";
    live.textContent = "Downloading the live app…";
    await sleep(150);
    k("before").style.width = `${(7 / 16) * 100}%`;
    k("after").style.width = `${(15 / 16) * 100}%`;
    let hash;
    try {
      const res = await fetch(APEX_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      hash = toHex(await crypto.subtle.digest("SHA-256", await res.arrayBuffer()));
    } catch {
      if (run !== el._run) return;
      live.textContent = "Not reachable right now";
      k("verdict").textContent = "The live app could not be downloaded. Press Check again in a moment.";
      return;
    }
    if (run !== el._run) return;
    await scramble(live, hash, 900);
    const match = hash === APEX_FINGERPRINT;
    live.className = match ? "match" : "nomatch";
    k("verdict").innerHTML = match
      ? '<span class="stamp good stamp-in">Match</span><span>The live app is exactly the build TrustBench verified.</span>'
      : '<span class="stamp bad stamp-in">Changed</span><span>The live app differs from the verified build.</span>';
  });
}

/* ---------- RiskLab ---------- */

const METHOD_NAMES = {
  equal_weight: "Equal weight",
  inverse_volatility: "Inverse volatility",
  sample_min_variance: "Minimum variance",
  oas_min_variance: "Minimum variance, shrunk",
  risk_parity: "Risk parity",
  minimum_cvar: "Minimum tail loss",
};
const REGIME_NAMES = { calm: "Calm", correlation_shock: "Crash", recovery: "Recovery", inflation_volatility: "Inflation scare" };

async function initRisk() {
  const el = $('[data-demo="risk"]');
  if (!el) return;
  const d = await getJSON("assets/data/risklab-wealth.json").catch(() => null);
  if (!d) return;
  const svg = $("svg", el);
  const W = 640, H = 300, L = 44, R = 12, T = 26, B = 24;
  const values = Object.values(d.curves).flat();
  const lo = Math.floor(Math.min(...values) * 10) / 10;
  const hi = Math.max(1.05, Math.ceil(Math.max(...values) * 10) / 10);
  const n = d.curves.equal_weight.length;
  const x = (i) => L + ((W - L - R) * i) / (n - 1);
  const xDay = (day) => L + ((W - L - R) * Math.min(day, d.days)) / d.days;
  const y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const ranked = Object.entries(d.curves).sort((a, b) => b[1].at(-1) - a[1].at(-1));
  const best = ranked[0][0];

  function render() {
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = "";
    const add = (tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      for (const [a, v] of Object.entries(attrs)) node.setAttribute(a, v);
      if (text) node.textContent = text;
      svg.appendChild(node);
      return node;
    };
    d.regimes.forEach((r, i) => {
      const x0 = xDay(r.start);
      const x1 = i + 1 < d.regimes.length ? xDay(d.regimes[i + 1].start) : W - R;
      if (i % 2 === 1) add("rect", { x: x0, y: T, width: x1 - x0, height: H - T - B, fill: color("--paper") });
      add("text", { x: x0 + 4, y: T - 8, fill: color("--muted"), "font-size": 11 }, REGIME_NAMES[r.name] || r.name);
    });
    for (const v of [1, 0.75, 0.5].filter((v) => v >= lo && v <= hi)) {
      add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: color("--rule"), "stroke-dasharray": v === 1 ? "" : "3 4" });
      add("text", { x: L - 6, y: y(v) + 4, fill: color("--muted"), "font-size": 11, "text-anchor": "end" }, `₹${v.toFixed(2)}`);
    }
    for (const [name, curve] of [...ranked].reverse()) {
      const strong = name === best || name === "equal_weight";
      const path = add("path", {
        d: curve.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""),
        fill: "none",
        stroke: name === best ? color("--proof") : name === "equal_weight" ? color("--ink") : color("--muted"),
        "stroke-width": strong ? 2.4 : 1.2,
        "stroke-opacity": strong ? 1 : 0.55,
        "stroke-linejoin": "round",
      });
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = reduceMotion ? "0" : `${len}`;
      path.dataset.len = len;
    }
    $('[data-k="legend"]', el).innerHTML = ranked.map(([name, curve]) => {
      const c = name === best ? color("--proof") : name === "equal_weight" ? color("--ink") : color("--muted");
      return `<li><i style="background:${c}"></i>${METHOD_NAMES[name] || name} <span class="num">₹${curve.at(-1).toFixed(2)}</span></li>`;
    }).join("");
  }

  whenVisible(el, async () => {
    render();
    if (reduceMotion) return;
    await frame();
    svg.querySelectorAll("path").forEach((p) => {
      p.style.transition = "stroke-dashoffset 2.6s cubic-bezier(.3,.1,.2,1)";
      p.style.strokeDashoffset = "0";
    });
  });
}

/* ---------- DATA301: gradient descent ---------- */

function initGradient() {
  const el = $('[data-demo="gd"]');
  if (!el) return;
  const canvas = $("canvas", el);
  const k = (name) => $(`[data-k="${name}"]`, el);
  let seed = 301;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pts = Array.from({ length: 36 }, () => {
    const px = rand();
    return [px, 0.18 + 0.62 * px + (rand() - 0.5) * 0.22];
  });
  const loss = (w, b) => pts.reduce((s, [px, py]) => s + (w * px + b - py) ** 2, 0) / pts.length;

  function draw(w, b) {
    const { ctx, w: cw, h } = sizeCanvas(canvas);
    const X = (v) => 16 + v * (cw - 32);
    const Y = (v) => h - 16 - v * (h - 32);
    ctx.clearRect(0, 0, cw, h);
    ctx.strokeStyle = color("--rule");
    ctx.lineWidth = 1;
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.moveTo(X(px), Y(py));
      ctx.lineTo(X(px), Y(w * px + b));
      ctx.stroke();
    }
    ctx.fillStyle = color("--ink");
    for (const [px, py] of pts) {
      ctx.beginPath();
      ctx.arc(X(px), Y(py), 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = color("--proof");
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(b));
    ctx.lineTo(X(1), Y(w + b));
    ctx.stroke();
  }

  whenVisible(el, async () => {
    const run = token(el);
    let w = -0.4, b = 0.85;
    const steps = 140, rate = 0.5;
    for (let s = 0; s <= steps; s++) {
      if (!reduceMotion || s === steps) {
        if (run !== el._run) return;
        draw(w, b);
        k("step").textContent = s;
        k("loss").textContent = loss(w, b).toFixed(4);
        if (!reduceMotion) await sleep(28);
      }
      let gw = 0, gb = 0;
      for (const [px, py] of pts) {
        const r = w * px + b - py;
        gw += (2 * r * px) / pts.length;
        gb += (2 * r) / pts.length;
      }
      if (s < steps) { w -= rate * gw; b -= rate * gb; }
    }
  });
}

/* ---------- Start ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initRecord();
  initProofloom();
  initBook();
  initApex();
  initRisk();
  initGradient();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => location.reload());
});
