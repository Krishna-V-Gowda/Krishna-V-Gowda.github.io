"use strict";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;
const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => (reduceMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const token = (el) => (el._run = (el._run || 0) + 1);
const color = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();
const inr = (paise) => (paise < 0 ? "−₹" : "₹") + (Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------- Feel: a short vibration at meaningful moments, where the device has it (Android) ---------- */

/** A short vibration at meaningful moments. iOS ignores it; reduced motion turns it off. */
const buzz = (pattern) => { if (!reduceMotion && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) try { navigator.vibrate(pattern); } catch {} };
const feel = {
  tap: () => buzz(8),
  tick: () => buzz(3),
  good: () => buzz([12, 40, 12]),
  bad: () => buzz([30, 50, 90]),
  alarm: () => buzz([40, 60, 40, 60, 90]),
};
/** Slider ticks, at most one every 45 ms so a fast drag is a purr, not a buzz. */
let lastTick = 0;
const tickThrottled = () => { const now = performance.now(); if (now - lastTick > 45) { lastTick = now; feel.tick(); } };
window.feel = feel; // the 3D scenes share the same feel

/** Tell the 3D scenes what a demo just did; the latest state is kept in case a scene loads afterwards. */
const tell = (name, detail) => {
  (window.demoState ||= {})[name] = detail;
  window.dispatchEvent(new CustomEvent(`demo:${name}`, { detail }));
};

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

/** Start a demo the first time it is mostly on screen; its Replay button runs it again. */
function whenVisible(el, start) {
  const button = $(".replay", el);
  if (button) button.addEventListener("click", () => { feel.tap(); start(); });
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
  }, { threshold: 0.3 });
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

/** Paint a range input's filled part in its accent colour. */
const fillRange = (input) => input.style.setProperty("--fill", `${((input.value - input.min) / (input.max - input.min || 1)) * 100}%`);

/** Primary buttons lean toward a mouse pointer. */
function initMagnets() {
  if (reduceMotion || !finePointer) return;
  document.querySelectorAll(".btn").forEach((b) => {
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty("--mx", `${(e.clientX - r.left - r.width / 2) * 0.22}px`);
      b.style.setProperty("--my", `${(e.clientY - r.top - r.height / 2) * 0.3}px`);
    });
    b.addEventListener("pointerleave", () => { b.style.setProperty("--mx", "0px"); b.style.setProperty("--my", "0px"); });
    b.addEventListener("pointerdown", () => feel.tap());
  });
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

/** Edit one entry and recompute its hash to hide the edit, as a forger would. */
async function coverUp(entries, k) {
  const copy = entries.map((e) => ({ ...e }));
  const e = copy[k];
  e.commitment = e.commitment.slice(0, -1) + (e.commitment.endsWith("0") ? "1" : "0");
  e.hash = await entryHash(e);
  return copy;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(e) {
  const [y, m, d] = e.reference.split("-");
  return e.stream === "half-life-monthly"
    ? { name: "Ledger", when: `${MONTHS[+m - 1]} ${y}`, long: `the Forward Ledger for ${MONTHS[+m - 1]} ${y}` }
    : { name: e.series, when: `for ${+d} ${MONTHS[+m - 1]}`, long: `the ${e.series} rate forecast for ${+d} ${MONTHS[+m - 1]}` };
}
const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const sealedOn = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`; };

async function initRecord() {
  const list = $("#tiles");
  if (!list) return;
  const status = $("#chain-status");
  const detail = $("#tile-detail");
  const undo = $("#record-undo");
  let record;
  try {
    record = await getJSON("/assets/data/record.json");
  } catch {
    status.textContent = "Could not load the record";
    status.className = "board-status bad";
    return;
  }
  if (!window.crypto?.subtle) {
    status.textContent = "This page needs HTTPS to run its checks";
    status.className = "board-status bad";
    return;
  }
  const original = record.entries;
  const sigCheck = await signatureCheck(record.keys);
  const confirmed = record.receipts.filter((r) => r.status === "confirmed" && r.bitcoin.length);
  const receipt = confirmed.reduce((a, b) => (b.headSeq > a.headSeq ? b : a), confirmed[0]);
  const anchorLine = receipt ? `Pages 0 to ${receipt.headSeq} are also timestamped in <span class="btc">Bitcoin block ${Math.max(...receipt.bitcoin).toLocaleString("en-US")}</span>, which proves they existed by then.` : "";
  let forged = null; // index of the page the visitor tampered with
  let entries = original;
  let verdicts = original.map(() => "Waiting");

  list.innerHTML = original.map((e, i) => {
    const l = label(e);
    return `<li><button type="button" class="tile" data-i="${i}" aria-label="Page ${e.seq}, ${l.long}. Tap to tamper with it.">
      <span class="t-seq">${e.seq}</span><span class="t-name">${l.name}</span><span class="t-when">${l.when}</span><span class="t-mark" aria-hidden="true"></span></button></li>`;
  }).join("");
  const tiles = [...list.querySelectorAll(".tile")];
  let checked = false;
  const idle = () => { if (forged === null) detail.innerHTML = checked && anchorLine ? anchorLine : "Hover or focus a page to see exactly what your browser checked."; };

  function explain(i) {
    const e = entries[i];
    const l = label(e);
    const v = verdicts[i];
    const msg = {
      Verified: `Its fingerprint <code>${short(e.hash)}</code> matches its contents, it links to page ${i ? i - 1 : "zero"}, and KRIVANCE&rsquo;s signature checks out.`,
      "Signature fails": "You changed one character. A forger would recompute the fingerprint so it still matches, but they can&rsquo;t forge KRIVANCE&rsquo;s signature. Caught.",
      "Link broken": `This page still points at the old fingerprint <code>${short(e.prev)}</code> of page ${i - 1}, which no longer exists. Caught again.`,
      "Contents altered": "Its contents no longer match its fingerprint.",
      Waiting: "Waiting to be checked.",
    }[v];
    detail.innerHTML = `<b>Page ${e.seq}: ${l.long}</b>, sealed ${sealedOn(e.sealedAt)}. ${msg}`;
  }
  tiles.forEach((t, i) => {
    t.addEventListener("pointerenter", () => explain(i));
    t.addEventListener("focus", () => explain(i));
    t.addEventListener("click", () => {
      forged = forged === i ? null : i;
      feel.tap();
      run(true).then(() => forged !== null && explain(i));
    });
  });
  list.addEventListener("pointerleave", idle);
  undo.addEventListener("click", () => { forged = null; feel.tap(); run(true); });
  // The hero's 3D chain can forge a page too; the board below catches it the same way.
  window.addEventListener("record:forge", (e) => { forged = forged === e.detail ? null : e.detail; run(true); });
  const ticker = $("#ticker");
  const report = (state) => {
    tell("record", { verdicts: [...verdicts], forged, hashes: entries.map((e) => e.hash), labels: original.map((e) => label(e).long), state });
    if (!ticker) return;
    const n = entries.length;
    ticker.className = `ticker ${state === "ok" ? "ok" : state === "bad" ? "bad" : ""}`;
    $("span", ticker).innerHTML = state === "ok"
      ? `Your browser just verified ${n} signed forecasts${receipt ? `, anchored in Bitcoin block ${Math.max(...receipt.bitcoin).toLocaleString("en-US")}` : ""}.`
      : state === "bad" ? `Forgery caught on page ${forged}. <a href="#record">See how</a>` : `Your browser is verifying ${n} signed forecasts…`;
  };

  async function run(fast) {
    const r = token(list);
    entries = forged === null ? original : await coverUp(original, forged);
    if (r !== list._run) return;
    verdicts = entries.map(() => "Waiting");
    undo.hidden = forged === null;
    tiles.forEach((t) => { t.className = "tile"; });
    if (forged !== null) tiles[forged].classList.add("forged");
    status.className = "board-status";
    report("checking");
    let prev = GENESIS;
    let bad = 0;
    for (let i = 0; i < entries.length; i++) {
      if (r !== list._run) return;
      const e = entries[i];
      status.textContent = `Checking page ${i} of ${entries.length - 1}`;
      const hash = await entryHash(e);
      const contentOk = hash === e.hash;
      const linkOk = e.prev === prev && e.seq === i;
      const sigOk = sigCheck ? await sigCheck(e, e.hash) : true;
      const v = !linkOk ? "Link broken" : !contentOk ? "Contents altered" : !sigOk ? "Signature fails" : "Verified";
      if (r !== list._run) return;
      verdicts[i] = v;
      tiles[i].classList.add(v === "Verified" ? "ok" : "bad");
      $(".t-mark", tiles[i]).textContent = v === "Verified" ? "✓" : "✕";
      if (v !== "Verified") { $(".t-when", tiles[i]).textContent = v; bad++; }
      prev = e.hash;
      report("checking");
      await sleep(fast ? 35 : 70);
    }
    if (r !== list._run) return;
    tiles.forEach((t, i) => { if (verdicts[i] === "Verified") $(".t-when", t).textContent = label(entries[i]).when; });
    if (!bad) {
      status.textContent = sigCheck ? `All ${entries.length} pages verify` : `All ${entries.length} fingerprints and links verify`;
      status.className = "board-status ok";
      if (fast) feel.good(); else buzz(12);
      checked = true;
      idle();
      report("ok");
    } else {
      status.textContent = `Tampering caught on page ${forged}`;
      status.className = "board-status bad";
      report("bad");
      feel.alarm();
    }
    if (!sigCheck) $("#chain-fine").textContent = "This browser cannot check Ed25519 signatures, so only fingerprints and links were checked. A recent Chrome, Safari or Firefox checks all three.";
  }
  idle();
  run(false);
}

/* ---------- Proofloom ---------- */

async function initProofloom() {
  const el = $('[data-demo="proofloom"]');
  if (!el) return;
  const d = await getJSON("/assets/data/proofloom-settlement.json").catch(() => null);
  if (!d) return;
  const k = (name) => $(`[data-k="${name}"]`, el);
  const gross = d.payments.reduce((a, b) => a + b, 0);
  const consistent = gross - d.refunds - d.fees - d.tax === d.expected;
  const slider = k("slider");
  slider.min = d.expected - 300;
  slider.max = d.expected + 300;
  slider.value = d.reported;
  fillRange(slider);
  let lastDiff = null;

  function judge(reported, quiet) {
    const diff = d.expected - reported;
    k("reported").textContent = inr(reported);
    k("diff").textContent = inr(diff);
    $(".ledger-row.diff", el).classList.toggle("bad", diff !== 0);
    const refused = consistent && diff !== 0;
    tell("proofloom", { state: refused ? "refused" : "allowed", diff });
    if (!quiet && (lastDiff === null || (lastDiff === 0) !== (diff === 0))) (diff === 0 ? feel.good : feel.bad)();
    if (lastDiff === null || (lastDiff === 0) !== (diff === 0) || !consistent) {
      k("verdict").innerHTML = !consistent
        ? "The published records don&rsquo;t add up; this demo stopped."
        : diff === 0
          ? '<span class="stamp good stamp-in">Close allowed</span><span>Every paisa is accounted for.</span>'
          : `<span class="stamp bad stamp-in">Close refused</span><span data-k="gap"></span>`;
    }
    const gap = k("gap");
    if (gap) gap.textContent = `${Math.abs(diff)} paise ${diff > 0 ? "missing" : "too many"}. No model or reviewer can override this.`;
    lastDiff = diff;
  }

  slider.addEventListener("input", () => { fillRange(slider); tickThrottled(); judge(+slider.value); });
  k("match").addEventListener("click", () => { slider.value = d.expected; fillRange(slider); judge(d.expected); });
  k("real").addEventListener("click", () => { slider.value = d.reported; fillRange(slider); feel.tap(); judge(d.reported); });

  whenVisible(el, async () => {
    const run = token(el);
    slider.disabled = true;
    lastDiff = null;
    tell("proofloom", { state: "running" });
    ["refunds", "fees", "tax", "expected", "reported", "diff"].forEach((n) => (k(n).textContent = ""));
    k("verdict").innerHTML = "";
    $(".ledger-row.diff", el).classList.remove("bad");
    let sum = 0;
    for (const p of d.payments) {
      if (run !== el._run) return;
      sum += p;
      k("gross").textContent = inr(sum);
      await sleep(50);
    }
    for (const [n, v] of [["refunds", d.refunds], ["fees", d.fees], ["tax", d.tax]]) {
      await sleep(240);
      if (run !== el._run) return;
      k(n).textContent = "− " + inr(v);
    }
    await sleep(300);
    k("expected").textContent = inr(d.expected);
    await sleep(400);
    if (run !== el._run) return;
    slider.value = d.reported;
    fillRange(slider);
    judge(d.reported);
    slider.disabled = false;
  });
}

/* ---------- MarketReplay ---------- */

/** Replay the first n messages, checking the level invariant after each; corruptAt adds phantom shares at one message. */
function replay(events, n, corruptAt = -1) {
  const orders = new Map();
  const levels = new Map();
  let checks = 0;
  let i = 0;
  const bump = (o, delta) => {
    const key = o.s + o.p;
    const next = (levels.get(key) || 0) + delta + (i === corruptAt ? 100 : 0);
    if (next < 0) throw new Error("a price level went below zero");
    if (next === 0) levels.delete(key); else levels.set(key, next);
  };
  const check = (o) => {
    let total = 0;
    for (const x of orders.values()) if (x.s === o.s && x.p === o.p) total += x.q;
    if ((levels.get(o.s + o.p) || 0) !== total) {
      throw new Error(`the ${o.s === "S" ? "sell" : "buy"} level at $${(o.p / 10000).toFixed(4)} says ${(levels.get(o.s + o.p) || 0).toLocaleString("en-US")} shares, but the orders resting there add up to ${total.toLocaleString("en-US")}`);
    }
    checks++;
  };
  try {
    for (; i < n; i++) {
      const ev = events[i];
      const o = orders.get(ev.r);
      if (ev.t === "A" || ev.t === "F") {
        const x = { s: ev.s, p: ev.p, q: ev.q };
        orders.set(ev.r, x); bump(x, x.q); check(x);
      } else if (ev.t === "E" || ev.t === "C" || ev.t === "X") {
        if (!o || ev.q > o.q) throw new Error("a reduction exceeded the resting shares");
        o.q -= ev.q; bump(o, -ev.q);
        if (o.q === 0) orders.delete(ev.r);
        check(o);
      } else if (ev.t === "D") {
        if (!o) throw new Error("a delete named an unknown order");
        orders.delete(ev.r); bump(o, -o.q); check(o);
      } else if (ev.t === "U") {
        if (!o) throw new Error("a replace named an unknown order");
        orders.delete(ev.r); bump(o, -o.q); check(o);
        const x = { s: o.s, p: ev.p, q: ev.q };
        orders.set(ev.n, x); bump(x, x.q); check(x);
      }
    }
  } catch (err) {
    return { orders, levels, checks, n: i, error: err.message };
  }
  return { orders, levels, checks, n };
}

async function initBook() {
  const el = $('[data-demo="book"]');
  if (!el) return;
  const d = await getJSON("/assets/data/itch-slice.json").catch(() => null);
  if (!d) return;
  const canvas = $("canvas", el);
  const k = (name) => $(`[data-k="${name}"]`, el);
  const scrub = k("scrub");
  const note = k("note");
  const noteText = note.textContent;
  scrub.max = d.events.length;
  let pos = 0, corruptAt = -1, playing = false, failed = false;

  function draw(levels, flash) {
    const { ctx, w, h } = sizeCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    // The 14 largest price levels, highest price first. The fixture's prices are synthetic, so no spread is implied.
    const rows = [...levels].map(([key, q]) => [key[0], +key.slice(1), q]).sort((a, b) => b[2] - a[2]).slice(0, 14).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[2]));
    const rowH = h / 14;
    const labelW = Math.min(118, w * 0.26);
    ctx.font = `500 ${Math.max(10, Math.min(12.5, w / 52))}px ${color("--mono") || "monospace"}`;
    ctx.textBaseline = "middle";
    rows.forEach(([side, price, q], i) => {
      const y = i * rowH;
      const barW = ((w - labelW - 64) * q) / max;
      ctx.fillStyle = side === "S" ? color("--g2") : color("--proof");
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.roundRect(labelW, y + rowH * 0.18, Math.max(3, barW), rowH * 0.64, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color("--muted");
      ctx.fillText(`${side === "S" ? "Sell" : "Buy"} $${(price / 10000).toFixed(4)}`, 0, y + rowH / 2);
      ctx.fillStyle = color("--ink");
      ctx.fillText(q.toLocaleString("en-US"), labelW + Math.max(3, barW) + 8, y + rowH / 2);
    });
    if (flash) { ctx.fillStyle = color("--refuse"); ctx.globalAlpha = 0.12; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
  }

  function show(n) {
    const s = replay(d.events, n, corruptAt);
    pos = s.n;
    scrub.value = pos;
    fillRange(scrub);
    k("msgs").textContent = pos.toLocaleString("en-US");
    k("orders").textContent = s.orders.size.toLocaleString("en-US");
    k("checks").textContent = s.error ? "Failed" : pos === d.events.length ? `${s.checks.toLocaleString("en-US")} passed` : s.checks.toLocaleString("en-US");
    tell("book", { n: pos, total: d.events.length, error: Boolean(s.error) });
    draw(s.levels, Boolean(s.error));
    if (!s.error && failed) { note.textContent = noteText; note.style.color = ""; }
    if (s.error && !failed) {
      playing = false;
      note.innerHTML = `<b>Replay stopped at message ${pos + 1}:</b> ${s.error}. This is the check that guards the real engine, after every message.`;
      note.style.color = color("--refuse");
      feel.alarm();
    }
    if (s.error) playing = false;
    failed = Boolean(s.error);
    return s;
  }

  async function play(from = 0) {
    const run = token(el);
    playing = true;
    for (let n = reduceMotion ? d.events.length : from; n < d.events.length; n += 3) {
      if (run !== el._run || !playing) return;
      if (show(n).error) return;
      await frame();
    }
    if (run !== el._run || !playing) return;
    if (!show(d.events.length).error) buzz(10);
    playing = false;
  }

  scrub.addEventListener("input", () => {
    token(el);
    playing = false;
    if (show(+scrub.value).error) return;
    tickThrottled();
  });
  k("corrupt").addEventListener("click", () => {
    feel.tap();
    if (pos >= d.events.length) pos = 0;
    corruptAt = pos;
    play(pos);
  });

  whenVisible(el, () => {
    corruptAt = -1;
    note.textContent = noteText;
    note.style.color = "";
    play(0);
  });
}

/* ---------- TrustBench: the live fingerprint check, and a fingerprint you can poke ---------- */

const APEX_URL = "https://krishna-v-gowda.github.io/EDA-InsightLab-Apex/assets/js/app.js";
const APEX_FINGERPRINT = "51a9853d2a465a71197a28e71d16821d69b3cbbebf6c1bdc753563c12a3688df";

function initApex() {
  const el = $('[data-demo="apex"]');
  if (!el) return;
  const k = (name) => $(`[data-k="${name}"]`, el);

  const input = k("text");
  const grid = k("hex");
  if (input && grid && window.crypto?.subtle) {
    grid.innerHTML = "<span></span>".repeat(64);
    const cells = [...grid.children];
    let last = null;
    const update = async () => {
      const h = await sha256(input.value);
      let changed = 0;
      cells.forEach((c, i) => {
        c.textContent = h[i];
        const diff = last !== null && last[i] !== h[i];
        if (diff) changed++;
        c.classList.toggle("chg", diff);
      });
      if (last !== null) {
        requestAnimationFrame(() => setTimeout(() => cells.forEach((c) => c.classList.remove("chg")), 260));
        k("changed").textContent = `${changed} of 64 characters changed. A match with the recorded fingerprint means the code is identical, byte for byte.`;
        tickThrottled();
      }
      last = h;
    };
    input.addEventListener("input", update);
    update();
  }

  whenVisible(el, async () => {
    const run = token(el);
    tell("apex", { state: "running" });
    k("before").style.width = "0";
    k("after").style.width = "0";
    k("verdict").innerHTML = "<span>Downloading the live app and fingerprinting it…</span>";
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
      k("verdict").textContent = "The live app could not be downloaded. Press Check again in a moment.";
      return;
    }
    if (run !== el._run) return;
    await sleep(500);
    const match = hash === APEX_FINGERPRINT;
    tell("apex", { state: match ? "match" : "changed", hash });
    (match ? feel.good : feel.bad)();
    k("verdict").innerHTML = match
      ? `<span class="stamp good stamp-in">Match</span><span>The live app hashes to <code>${short(hash)}</code>, exactly the build TrustBench verified.</span>`
      : `<span class="stamp bad stamp-in">Changed</span><span>The live app hashes to <code>${short(hash)}</code>, not the verified <code>${short(APEX_FINGERPRINT)}</code>.</span>`;
  });
}

/** The Apex PCA view buttons drive the 3D scene. */
function initApexView() {
  const el = $('[data-demo="apexpca"]');
  if (!el) return;
  el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    feel.tap();
    el.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    tell("apexpca", { view: b.dataset.view });
  }));
  window.addEventListener("demo:apexview", (e) => el.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.view === e.detail))));
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
  const d = await getJSON("/assets/data/risklab-wealth.json").catch(() => null);
  if (!d) return;
  const svg = $("svg", el);
  const ns = "http://www.w3.org/2000/svg";
  const W = 640, H = 300, L = 44, R = 12, T = 26, B = 24;
  const values = Object.values(d.curves).flat();
  const lo = Math.floor(Math.min(...values) * 10) / 10;
  const hi = Math.max(1.05, Math.ceil(Math.max(...values) * 10) / 10);
  const n = d.curves.equal_weight.length;
  const x = (i) => L + ((W - L - R) * i) / (n - 1);
  const xDay = (day) => L + ((W - L - R) * Math.min(day, d.days)) / d.days;
  const y = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const ranked = Object.entries(d.curves).sort((a, b) => b[1].at(-1) - a[1].at(-1));
  const palette = ["--proof", "--ink", "--g1", "--g2", "--g3", "--g4"];
  const hue = Object.fromEntries(ranked.map(([name], i) => [name, color(palette[i])]));
  const hidden = new Set();
  const paths = {};
  const legend = $('[data-k="legend"]', el);
  const readout = $('[data-k="readout"]', el);
  const add = (tag, attrs, text, parent = svg) => {
    const node = document.createElementNS(ns, tag);
    for (const [a, v] of Object.entries(attrs)) node.setAttribute(a, v);
    if (text) node.textContent = text;
    parent.appendChild(node);
    return node;
  };

  function render() {
    svg.innerHTML = "";
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
      const p = add("path", {
        d: curve.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(""),
        fill: "none", stroke: hue[name], "stroke-width": name === ranked[0][0] ? 2.6 : 1.7, "stroke-linejoin": "round",
      });
      p.style.transition = "opacity .3s";
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = reduceMotion ? "0" : `${len}`;
      paths[name] = p;
    }
    const cross = add("g", { opacity: 0 });
    add("line", { x1: 0, x2: 0, y1: T, y2: H - B, stroke: color("--ink"), "stroke-width": 1 }, null, cross);
    const dots = Object.fromEntries(ranked.map(([name]) => [name, add("circle", { r: 4, fill: hue[name], stroke: color("--surface"), "stroke-width": 2 }, null, cross)]));
    svg._cross = { g: cross, dots };
    legend.innerHTML = ranked.map(([name, curve]) => `<li><button type="button" aria-pressed="true" data-m="${name}"><i style="background:${hue[name]}"></i>${METHOD_NAMES[name] || name} <span class="num">₹${curve.at(-1).toFixed(2)}</span></button></li>`).join("");
    legend.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const m = b.dataset.m;
      if (hidden.has(m)) hidden.delete(m); else if (hidden.size < ranked.length - 1) hidden.add(m); else return;
      feel.tap();
      b.setAttribute("aria-pressed", String(!hidden.has(m)));
      paths[m].style.opacity = hidden.has(m) ? "0" : "1";
      tell("risk", { hidden: [...hidden] });
    }));
  }

  function scrubAt(clientX) {
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - L) / (W - L - R)) * (n - 1))));
    const day = Math.round((i / (n - 1)) * d.days);
    const regime = [...d.regimes].reverse().find((g) => day >= g.start);
    const { g, dots } = svg._cross;
    g.setAttribute("opacity", 1);
    g.firstChild.setAttribute("x1", x(i)); g.firstChild.setAttribute("x2", x(i));
    const shown = ranked.filter(([m]) => !hidden.has(m));
    for (const [m, c] of ranked) { dots[m].setAttribute("cx", x(i)); dots[m].setAttribute("cy", y(c[i])); dots[m].setAttribute("opacity", hidden.has(m) ? 0 : 1); }
    const sorted = [...shown].sort((a, b) => b[1][i] - a[1][i]);
    readout.innerHTML = `<b>Day ${day}, ${REGIME_NAMES[regime.name]}.</b> Ahead: ${METHOD_NAMES[sorted[0][0]]} at ₹${sorted[0][1][i].toFixed(2)}. Behind: ${METHOD_NAMES[sorted.at(-1)[0]]} at ₹${sorted.at(-1)[1][i].toFixed(2)}.`;
    if (svg._i !== undefined && Math.abs(svg._i - i) >= 3) tickThrottled();
    svg._i = i;
  }
  svg.addEventListener("pointermove", (e) => scrubAt(e.clientX));
  svg.addEventListener("pointerdown", (e) => scrubAt(e.clientX));
  svg.addEventListener("pointerleave", () => svg._cross && svg._cross.g.setAttribute("opacity", 0));

  whenVisible(el, async () => {
    render();
    hidden.clear();
    tell("risk", { hidden: [] });
    if (reduceMotion) return;
    await frame();
    Object.values(paths).forEach((p) => {
      p.style.transition = "stroke-dashoffset 2.4s cubic-bezier(.3,.1,.2,1), opacity .3s";
      p.style.strokeDashoffset = "0";
    });
  });
}

/* ---------- DATA301: gradient descent on points you can move ---------- */

function seedPoints() {
  let seed = 301;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: 36 }, () => { const px = rand(); return [px, 0.18 + 0.62 * px + (rand() - 0.5) * 0.22]; });
}

function initGradient() {
  const el = $('[data-demo="gd"]');
  if (!el) return;
  const canvas = $("canvas", el);
  const k = (name) => $(`[data-k="${name}"]`, el);
  let pts = seedPoints();
  let w = -0.4, b = 0.85, step = 0, version = 0, drag = -1, raf = 0;
  const rate = 0.5, MAX_STEPS = 400, MAX_POINTS = 80;
  const loss = () => pts.reduce((s, [px, py]) => s + (w * px + b - py) ** 2, 0) / pts.length;
  const geom = () => { const cw = canvas.clientWidth || 640; const h = Math.round((cw * 300) / 640); return { cw, h, X: (v) => 16 + v * (cw - 32), Y: (v) => h - 16 - v * (h - 32) }; };

  function draw() {
    const { ctx, w: cw, h } = sizeCanvas(canvas);
    const { X, Y } = geom();
    ctx.clearRect(0, 0, cw, h);
    ctx.strokeStyle = color("--rule");
    ctx.lineWidth = 1.2;
    for (const [px, py] of pts) { ctx.beginPath(); ctx.moveTo(X(px), Y(py)); ctx.lineTo(X(px), Y(w * px + b)); ctx.stroke(); }
    pts.forEach(([px, py], i) => {
      ctx.fillStyle = i === drag ? color("--c-data301") : color("--ink");
      ctx.beginPath(); ctx.arc(X(px), Y(py), i === drag ? 7 : 4.2, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = color("--c-data301");
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(X(0), Y(b)); ctx.lineTo(X(1), Y(w + b)); ctx.stroke();
    k("step").textContent = step;
    k("loss").textContent = loss().toFixed(4);
    k("count").textContent = pts.length;
  }
  function descend() {
    let gw = 0, gb = 0;
    for (const [px, py] of pts) { const r = w * px + b - py; gw += (2 * r * px) / pts.length; gb += (2 * r) / pts.length; }
    w -= rate * gw; b -= rate * gb; step++;
    return Math.hypot(gw, gb);
  }
  const report = () => tell("gd", { w, b, step, pts, version });
  function loop() {
    raf = 0;
    if (reduceMotion) { while (step < MAX_STEPS) descend(); draw(); report(); return; }
    const g = descend();
    draw();
    report();
    if (step < MAX_STEPS && (g > 1e-4 || drag >= 0)) raf = requestAnimationFrame(loop);
  }
  const restart = () => { step = 0; version++; if (!raf) raf = requestAnimationFrame(loop); };

  const toData = (e) => {
    const r = canvas.getBoundingClientRect();
    const { cw, h } = geom();
    const sx = ((e.clientX - r.left) / r.width) * cw, sy = ((e.clientY - r.top) / r.height) * h;
    return [Math.min(1, Math.max(0, (sx - 16) / (cw - 32))), Math.min(1, Math.max(0, (h - 16 - sy) / (h - 32))), sx, sy];
  };
  canvas.addEventListener("pointerdown", (e) => {
    const [dx, dy, sx, sy] = toData(e);
    const { X, Y } = geom();
    let best = -1, bestD = 22;
    pts.forEach(([px, py], i) => { const dd = Math.hypot(X(px) - sx, Y(py) - sy); if (dd < bestD) { bestD = dd; best = i; } });
    if (best < 0) {
      if (pts.length >= MAX_POINTS) pts.shift();
      pts.push([dx, dy]);
      best = pts.length - 1;
    }
    drag = best;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("grab");
    feel.tap();
    restart();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag < 0) return;
    const [dx, dy] = toData(e);
    pts[drag] = [dx, dy];
    version++;
    tickThrottled();
    if (!raf) raf = requestAnimationFrame(loop);
  });
  const release = () => { if (drag < 0) return; drag = -1; canvas.classList.remove("grab"); restart(); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  whenVisible(el, () => {
    pts = seedPoints();
    w = -0.4; b = 0.85;
    restart();
  });
}

/* ---------- Dayflow: its leave-impact rules (backend/app/routes/decisions.py), on a sample team ---------- */

/** The decision for one request, exactly as Dayflow's /api/decisions/leave/{id}/impact computes it. */
function leaveImpact(leave, requests, team) {
  const total = team.length;
  const overlapping = requests.filter((q) => q !== leave && q.start <= leave.end && q.end >= leave.start);
  const approved = overlapping.filter((q) => q.status === "approved");
  const pending = overlapping.filter((q) => q.status === "pending");
  const currentAbsent = new Set(approved.map((q) => q.who)).size;
  const projectedAbsent = new Set([...approved, leave].map((q) => q.who)).size;
  const pct = (present) => (total ? Math.round((Math.max(0, present) / total) * 1000) / 10 : 0);
  const current = pct(total - currentAbsent);
  const projected = pct(total - projectedAbsent);
  const delta = Math.round((projected - current) * 10) / 10;
  let risk, recommendation;
  if (projected < 60 || projectedAbsent >= 3) [risk, recommendation] = ["high", "Review coverage plan before approving"];
  else if (projected < 80 || pending.length) [risk, recommendation] = ["moderate", "Approve only after confirming team coverage"];
  else [risk, recommendation] = ["low", "Coverage remains healthy; approve if policy allows"];
  const reasons = [`${total} employees are in Engineering.`, `${currentAbsent} approved absence(s) overlap the requested dates.`];
  if (pending.length) reasons.push(`${pending.length} other pending request(s) overlap the requested dates.`);
  reasons.push(`Approving this request changes coverage by ${delta > 0 ? "+" : ""}${delta} percentage points.`);
  return { current, projected, delta, risk, recommendation, reasons, overlapping };
}
// Self-check against the Python rules, run once: a lone request in a team of 5 with nothing else is low risk at 80%.
console.assert(leaveImpact({ who: 0, start: 0, end: 0 }, [], [0, 1, 2, 3, 4]).risk === "low", "Dayflow rules self-check failed");

function initDayflow() {
  const el = $('[data-demo="dayflow"]');
  if (!el) return;
  const cal = $('[data-k="cal"]', el);
  const box = $('[data-k="decision"]', el);
  const team = ["Arjun Rao", "Meera Shah", "Kavya Iyer", "Rohan Das", "Sana Khan"];
  // The next ten weekdays, from next Monday. Requests are stored as day numbers (calendar days from that Monday).
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const days = Array.from({ length: 10 }, (_, i) => i + (i >= 5 ? 2 : 0));
  const dateOf = (n) => { const x = new Date(monday); x.setDate(x.getDate() + n); return x; };
  const fmt = (n) => dateOf(n).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const seed = () => [
    { who: 1, start: 1, end: 2, status: "approved" },
    { who: 3, start: 8, end: 9, status: "approved" },
    { who: 4, start: 2, end: 3, status: "pending" },
  ];
  let requests = seed();
  let draft = null;

  function stateOf(who, day) {
    if (draft && draft.who === who && day >= draft.start && day <= draft.end) return "draft";
    const q = requests.find((r) => r.who === who && day >= r.start && day <= r.end);
    return q ? q.status : "";
  }
  function render() {
    const head = `<span></span>${days.map((n, i) => `<span class="day${i === 5 ? " wk" : ""}"><span class="wd-long">${dateOf(n).toLocaleDateString("en-GB", { weekday: "short" })}</span><span class="wd-short">${dateOf(n).toLocaleDateString("en-GB", { weekday: "narrow" })}</span><b>${dateOf(n).getDate()}</b></span>`).join("")}`;
    const rows = team.map((name, who) => `<span class="who" title="${name}">${name.split(" ")[0]}</span>${days.map((n, i) => {
      const s = stateOf(who, n);
      const what = { draft: "your request", approved: "approved leave", pending: "pending request", "": "available" }[s];
      return `<button type="button" class="cell ${s}${i === 5 ? " wk" : ""}" data-who="${who}" data-day="${n}" aria-label="${name}, ${fmt(n)}: ${what}"></button>`;
    }).join("")}`).join("");
    const cover = `<span class="cov-label">Here</span>${days.map((n) => {
      const away = team.filter((_, who) => ["approved", "draft"].includes(stateOf(who, n))).length;
      const pct = ((team.length - away) / team.length) * 100;
      return `<span class="cov" title="${Math.round(pct)}% in on ${fmt(n)}"><i class="${pct < 60 ? "low" : pct < 80 ? "mid" : ""}" style="height:${Math.max(6, pct)}%"></i></span>`;
    }).join("")}`;
    cal.innerHTML = head + rows + cover;
    decide();
  }
  function decide() {
    if (!draft) {
      box.innerHTML = `<p class="key"><span><i style="background:var(--acc);border-color:var(--acc)"></i>Your request</span><span><i style="background:var(--muted)"></i>Approved</span><span><i style="background:repeating-linear-gradient(135deg,var(--muted) 0 2px,transparent 2px 5px)"></i>Pending</span></p><p>Tap a day in anyone&rsquo;s row to request leave for them, then tap another day in the same row to stretch it. Dayflow shows HR the consequences before they decide.</p>`;
      return;
    }
    const r = leaveImpact(draft, requests, team);
    const length = draft.end - draft.start + 1;
    box.innerHTML = `
      <h4>${team[draft.who]}, ${length} day${length > 1 ? "s" : ""} from ${fmt(draft.start)} <span class="risk-tag ${r.risk}">${r.risk[0].toUpperCase() + r.risk.slice(1)} risk</span></h4>
      <dl class="nums"><div><dt>Coverage now</dt><dd>${r.current}%</dd></div><div><dt>If approved</dt><dd>${r.projected}%</dd></div><div><dt>Change</dt><dd>${r.delta > 0 ? "+" : ""}${r.delta}</dd></div></dl>
      <p><b>${r.recommendation}.</b></p>
      <ul>${r.reasons.map((x) => `<li>${x}</li>`).join("")}</ul>
      <div class="control-row"><button type="button" class="chip" data-act="approve">Approve</button><button type="button" class="chip" data-act="decline">Decline</button></div>`;
    $('[data-act="approve"]', box).addEventListener("click", () => { requests.push({ ...draft, status: "approved" }); draft = null; feel.good(); render(); });
    $('[data-act="decline"]', box).addEventListener("click", () => { draft = null; feel.tap(); render(); });
    tell("dayflow", { risk: r.risk, projected: r.projected });
  }
  cal.addEventListener("click", (e) => {
    const c = e.target.closest(".cell");
    if (!c) return;
    const who = +c.dataset.who, day = +c.dataset.day;
    const s = stateOf(who, day);
    if (s === "approved" || s === "pending") {
      c.classList.remove("nope"); void c.offsetWidth; c.classList.add("nope");
      buzz([10, 30, 10]);
      return;
    }
    if (s === "draft") draft = null;
    else if (draft && draft.who === who) draft = { who, start: Math.min(draft.start, day), end: Math.max(draft.end, day) };
    else draft = { who, start: day, end: day };
    // A request can't swallow someone's existing leave in the same row.
    if (draft && requests.some((q) => q.who === who && q.start <= draft.end && q.end >= draft.start)) draft = { who, start: day, end: day };
    feel.tap();
    render();
    if (draft) { const r = leaveImpact(draft, requests, team); if (r.risk === "high") buzz([20, 40, 20]); }
  });
  $(".replay", el).addEventListener("click", () => { requests = seed(); draft = null; feel.tap(); render(); });
  render();
}

/** The KRIVANCE wordmark settles from wide tracking into place once, as it comes into view. */
function initWordmark() {
  const mark = $(".krivance .wordmark");
  if (!mark || reduceMotion) return;
  mark.classList.add("pending");
  const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); requestAnimationFrame(() => mark.classList.remove("pending")); } }, { threshold: 0.6 });
  io.observe(mark);
}

/* ---------- Start ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initMagnets();
  initRecord();
  initProofloom();
  initBook();
  initApex();
  initApexView();
  initRisk();
  initGradient();
  initDayflow();
  initWordmark();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => location.reload());
});
