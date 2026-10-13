<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref } from "vue";
import TodoCard from "./TodoCard.vue";
import type { Todo, TodoLane } from "../types";

// Direct adaptation of FlightBoard.vue (same absolute-positioned "sky", corridors, taxi
// routing and puck-travel animation) for the to-do board — 4 lanes (Taxiing/In-flight/
// Holding/Landed) instead of 5, no Parked column (so the V-mid corridor and its rail node
// are dropped entirely), and TodoCard instead of Strip. Everything else — geometry, the
// Dijkstra rail router, the trapezoidal-velocity taxi physics, overflow drawers — is the
// same engine, unchanged in shape, just retyped from Aircraft/Lane to Todo/TodoLane.
// "Taxiing" (not "open") for the backlog lane's LABEL — the internal TodoLane value stays
// "open" (no data/API impact), but CONCEPT.md's own metaphor already names the pre-departure
// phase "Taxiing" (Parked → Taxiing → In-flight → ...), and reusing "Parked" here would clash
// with the session board's own, differently-meant "Parked" (a triaged "needs you" strip).

const props = defineProps<{ todos: Todo[]; now: number }>();
const emit = defineEmits<{
  add: [text: string];
  move: [id: string, lane: TodoLane, order: string[]];
  remove: [id: string];
  setText: [id: string, text: string];
  setNote: [id: string, note: string];
  removeNote: [id: string];
  setLink: [id: string, link: string];
  removeLink: [id: string];
}>();

const LANE_COLOR: Record<string, string> = { open: "#7d8590", inflight: "#3fb950", holding: "#e0a92e", landed: "#4cc38a" };

function byLane(lane: TodoLane): Todo[] {
  return props.todos.filter((t) => t.lane === lane).sort((a, b) => a.position - b.position);
}
const openL = computed(() => byLane("open"));
const inflight = computed(() => byLane("inflight"));
const holding = computed(() => byLane("holding"));
const landed = computed(() => byLane("landed"));
const laneCount = computed<Record<TodoLane, number>>(() => ({ open: openL.value.length, inflight: inflight.value.length, holding: holding.value.length, landed: landed.value.length }));

const stage = ref<HTMLElement | null>(null);
const skyW = ref(1400);
const skyH = ref(760);
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    const el = stage.value;
    if (el) { skyW.value = el.clientWidth; skyH.value = el.clientHeight; }
  });
  if (stage.value) ro.observe(stage.value);
});
onBeforeUnmount(() => ro?.disconnect());

const travelMs = 800; // fixed pace (FlightBoard exposes this as a debug slider; not needed here)

// geometry (fixed, desktop) — identical constants to FlightBoard.vue
const GAP = 8;
const TOP = 8;
const LABEL_W = 14;
const LGAP = 4;
const LANE_PAD = 6;
const COR = 52;
const RAIL_W = 240;
const CARD_W = 220;
const CARD_H = 134;
const ROW_H = 132;
const RAIL_H = 124;
const ADD_H = 40; // compact height for the "add a task" tile — just an input + button, not a full card
const PUCK_W = 44;
const PUCK_H = 34;
const IN_MAX_ROWS = 1;

interface Rect { x: number; y: number; w: number; h: number }
interface Pt { x: number; y: number }

const L = computed(() => {
  const W = skyW.value;
  const H = skyH.value;
  const contentX = RAIL_W + COR;
  const contentW = Math.max(360, W - contentX);
  const laneL = contentX + LANE_PAD;
  const cardX = laneL + LABEL_W + LGAP;
  const bandRight = contentX + contentW - LANE_PAD;
  const cols = Math.max(1, Math.floor((bandRight - cardX + GAP) / (CARD_W + GAP)));
  const infRows = Math.min(IN_MAX_ROWS, Math.max(1, Math.ceil(inflight.value.length / cols)));
  const corH1y = TOP + infRows * (CARD_H + GAP) + LANE_PAD;
  const midTop = corH1y + COR + LANE_PAD;
  const landedY = H - CARD_H - 6;
  const corH2y = landedY - LANE_PAD - COR;
  return { W, H, contentX, contentW, laneL, cardX, bandRight, cols, infRows, corH1y, midTop, corH2y, landedY };
});

const cap = computed(() => {
  const l = L.value;
  const midCap = Math.max(1, Math.floor((l.corH2y - LANE_PAD - l.midTop + GAP) / ROW_H));
  return {
    inflight: l.infRows * l.cols,
    holding: midCap,
    landed: l.cols,
    // the compact "add a task" tile's footprint is reserved first; remaining height splits into normal rows
    open: Math.max(0, Math.floor((l.H - 6 - TOP - (ADD_H + GAP) + GAP) / (RAIL_H + GAP))),
  };
});

const rail = computed(() => {
  const l = L.value;
  return { xRailV: RAIL_W + COR / 2, yTop: l.corH1y + COR / 2, yBot: l.corH2y + COR / 2 };
});

const rects = computed<Record<string, Rect>>(() => {
  const l = L.value;
  const c = cap.value;
  const r: Record<string, Rect> = {};
  inflight.value.slice(0, c.inflight).forEach((t, i) => { r[t.id] = { x: l.cardX + (i % l.cols) * (CARD_W + GAP), y: TOP + Math.floor(i / l.cols) * (CARD_H + GAP), w: CARD_W, h: CARD_H }; });
  const holdW = l.bandRight - l.cardX;
  holding.value.slice(0, c.holding).forEach((t, i) => { r[t.id] = { x: l.cardX, y: l.midTop + i * ROW_H, w: holdW, h: ROW_H - GAP }; });
  landed.value.slice(0, c.landed).forEach((t, i) => { r[t.id] = { x: l.cardX + i * (CARD_W + GAP), y: l.landedY, w: CARD_W, h: CARD_H }; });
  const openCardX = LABEL_W + LGAP;
  // real cards start below the compact "add a task" tile (see addTileRect)
  openL.value.slice(0, c.open).forEach((t, i) => { r[t.id] = { x: openCardX, y: TOP + (ADD_H + GAP) + i * (RAIL_H + GAP), w: RAIL_W - LANE_PAD - openCardX, h: RAIL_H }; });
  return r;
});

const addTileRect = computed<Rect>(() => {
  const openCardX = LABEL_W + LGAP;
  return { x: openCardX, y: TOP, w: RAIL_W - LANE_PAD - openCardX, h: ADD_H };
});

const zones = computed(() => {
  const l = L.value;
  const midH = l.corH2y - LANE_PAD - l.midTop;
  return [
    { k: "open" as TodoLane, label: "Taxiing", x: 0, y: TOP, w: RAIL_W, h: l.H - TOP - 6, c: "var(--gray)" },
    { k: "inflight" as TodoLane, label: "In-flight", x: l.laneL, y: TOP, w: l.contentW - LANE_PAD * 2, h: l.corH1y - LANE_PAD - TOP, c: "var(--green)" },
    { k: "holding" as TodoLane, label: "Holding", x: l.laneL, y: l.midTop, w: l.contentW - LANE_PAD * 2, h: midH, c: "var(--amber)" },
    { k: "landed" as TodoLane, label: "Landed", x: l.laneL, y: l.landedY, w: l.contentW - LANE_PAD * 2, h: CARD_H, c: "#4cc38a" },
  ];
});

const corridors = computed(() => {
  const l = L.value;
  const R = 14;
  return [
    { x: RAIL_W, y: 0, w: COR, h: l.H, radius: `${R}px` },
    { x: l.contentX, y: l.corH1y, w: l.contentW, h: COR, radius: `0 ${R}px ${R}px 0` },
    { x: l.contentX, y: l.corH2y, w: l.contentW, h: COR, radius: `0 ${R}px ${R}px 0` },
  ];
});

const taxiPath = computed(() => {
  const l = L.value;
  const g = rail.value;
  const xR = g.xRailV;
  const yT = g.yTop;
  const yB = g.yBot;
  const right = l.contentX + l.contentW;
  const H = l.H;
  const r = Math.min(24, COR * 0.45);
  const STOP = 16;
  const CB = 11;
  const arc = (jx: number, jy: number, dx: number, dy: number) =>
    `M ${jx} ${jy + dy * r} A ${r} ${r} 0 0 ${dx === dy ? 1 : 0} ${jx + dx * r} ${jy}`;
  return [
    `M ${xR} ${STOP} L ${xR} ${H - STOP}`,
    `M ${xR + r} ${yT} L ${right - STOP} ${yT}`,
    `M ${xR + r} ${yB} L ${right - STOP} ${yB}`,
    arc(xR, yT, 1, 1), arc(xR, yT, 1, -1),
    arc(xR, yB, 1, 1), arc(xR, yB, 1, -1),
    `M ${xR - CB} ${STOP} L ${xR + CB} ${STOP}`,
    `M ${xR - CB} ${H - STOP} L ${xR + CB} ${H - STOP}`,
    `M ${right - STOP} ${yT - CB} L ${right - STOP} ${yT + CB}`,
    `M ${right - STOP} ${yB - CB} L ${right - STOP} ${yB + CB}`,
  ].join(" ");
});

const placed = computed(() => [...inflight.value, ...holding.value, ...landed.value, ...openL.value].filter((t) => rects.value[t.id]));

// ---- overflow drawers: cards beyond a lane's capacity live in an openable drawer ----
const overflow = computed<Record<string, Todo[]>>(() => {
  const c = cap.value;
  return { inflight: inflight.value.slice(c.inflight), holding: holding.value.slice(c.holding), landed: landed.value.slice(c.landed), open: openL.value.slice(c.open) };
});

function drawerAnchor(k: string): Pt {
  const l = L.value;
  const c = cap.value;
  if (k === "holding") return { x: l.cardX + 30, y: l.midTop + c.holding * ROW_H + 4 };
  if (k === "open") return { x: LABEL_W + LGAP + 30, y: TOP + (ADD_H + GAP) + c.open * (RAIL_H + GAP) + 4 };
  if (k === "landed") return { x: Math.min(l.cardX + c.landed * (CARD_W + GAP), l.bandRight - 52), y: l.landedY + CARD_H / 2 };
  return { x: l.bandRight - 52, y: TOP + (l.infRows - 1) * (CARD_H + GAP) + CARD_H / 2 }; // inflight
}

const drawers = computed(() =>
  (["inflight", "holding", "landed", "open"] as const)
    .filter((k) => overflow.value[k].length)
    .map((k) => ({ k, n: overflow.value[k].length, ...drawerAnchor(k), color: LANE_COLOR[k] })),
);

const openDrawer = ref<string | null>(null);
const drawerItems = computed<Todo[]>(() => (openDrawer.value ? overflow.value[openDrawer.value] ?? [] : []));

// ---- corridor router: dock each lane to its rail, shortest path over the rail graph ----
function dock(lane: TodoLane, r: Rect): { p: Pt; railName: string } {
  const g = rail.value;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (lane === "inflight") return { p: { x: cx, y: g.yTop }, railName: "hTop" };
  if (lane === "landed") return { p: { x: cx, y: g.yBot }, railName: "hBot" };
  return { p: { x: g.xRailV, y: cy }, railName: "vRail" }; // holding + open dock to the V-rail
}

function routeCenters(sLane: TodoLane, s: Rect, dLane: TodoLane, d: Rect): Pt[] {
  const g = rail.value;
  const S = dock(sLane, s);
  const D = dock(dLane, d);
  const nodes: Record<string, Pt> = { S: S.p, D: D.p, TL: { x: g.xRailV, y: g.yTop }, BL: { x: g.xRailV, y: g.yBot } };
  const railCorners: Record<string, string[]> = { vRail: ["TL", "BL"], hTop: ["TL"], hBot: ["BL"] };
  const adj: Record<string, string[]> = {};
  const edge = (a: string, b: string) => { (adj[a] ||= []).push(b); (adj[b] ||= []).push(a); };
  edge("TL", "BL");
  for (const c of railCorners[S.railName]) edge("S", c);
  for (const c of railCorners[D.railName]) edge("D", c);
  if (S.railName === D.railName) edge("S", "D");
  const dist = (a: string, b: string) => Math.abs(nodes[a].x - nodes[b].x) + Math.abs(nodes[a].y - nodes[b].y);
  const Q = new Set(Object.keys(nodes));
  const best: Record<string, number> = {};
  const prev: Record<string, string> = {};
  for (const k of Q) best[k] = Infinity;
  best.S = 0;
  while (Q.size) {
    let u: string | null = null;
    let b = Infinity;
    for (const k of Q) if (best[k] < b) { b = best[k]; u = k; }
    if (u === null) break;
    Q.delete(u);
    if (u === "D") break;
    for (const v of adj[u] ?? []) if (Q.has(v)) { const nd = best[u] + dist(u, v); if (nd < best[v]) { best[v] = nd; prev[v] = u; } }
  }
  const via: Pt[] = [];
  let cur: string | undefined = "D";
  if (prev.D === undefined) return [S.p, D.p];
  while (cur) { via.unshift(nodes[cur]); if (cur === "S") break; cur = prev[cur]; }
  return via;
}

// ---- animation ----------------------------------------------------------------------
let prevRects: Record<string, Rect> = {};
let prevLane: Record<string, TodoLane> = {};
let prevOverflow: Record<string, string> = {};
let prevW = 0;
let prevH = 0;
let lastAnimSig = "";

function travelDuration(dist: number): number {
  const REF = 700;
  const d = travelMs * (dist / REF);
  return Math.max(140, Math.min(d, travelMs * 3));
}
function morphMs(): number {
  return Math.max(220, Math.min(520, travelMs * 0.2));
}

function planTaxi(sLane: TodoLane, from: Rect, dLane: TodoLane, to: Rect) {
  const via = routeCenters(sLane, from, dLane, to);
  const pts = [{ x: from.x + from.w / 2, y: from.y + from.h / 2 }, ...via, { x: to.x + to.w / 2, y: to.y + to.h / 2 }];
  const segLen: number[] = [];
  let S = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segLen.push(d); S += d; }
  const V = 700 / travelMs;
  const TaNom = Math.max(120, travelMs * 0.22);
  const a = V / TaNom;
  const daFull = 0.5 * V * TaNom;
  let Vp = V;
  let Taeff = TaNom;
  let da = daFull;
  let dc = 0;
  let Tc = 0;
  if (S >= 2 * daFull) { dc = S - 2 * daFull; Tc = dc / V; }
  else if (S > 0) { Vp = Math.sqrt(S * a); Taeff = Vp / a; da = 0.5 * Vp * Taeff; }
  else { Taeff = 0; da = 0; }
  const T = 2 * Taeff + Tc;
  const sOf = (t: number): number => {
    if (t <= Taeff) return 0.5 * a * t * t;
    if (t <= Taeff + Tc) return da + Vp * (t - Taeff);
    const td = t - (Taeff + Tc);
    return da + dc + Vp * td - 0.5 * a * td * td;
  };
  const pointAt = (s: number) => {
    let acc = 0;
    for (let i = 0; i < segLen.length; i++) {
      const lg = segLen[i];
      if (s <= acc + lg || i === segLen.length - 1) { const f = lg > 0 ? (s - acc) / lg : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f }; }
      acc += lg;
    }
    return pts[pts.length - 1];
  };
  const timeForArc = (lq: number): number => {
    if (lq <= da) return Math.sqrt((2 * lq) / a);
    if (lq <= da + dc) return Taeff + (lq - da) / Vp;
    const rem = lq - da - dc;
    return Taeff + Tc + (Vp - Math.sqrt(Math.max(0, Vp * Vp - 2 * a * rem))) / a;
  };
  return { S, T, sOf, pointAt, firstLegDist: segLen[0] ?? 0, timeForArc };
}

function exitClearTime(sLane: TodoLane, from: Rect, dLane: TodoLane, to: Rect): number {
  const plan = planTaxi(sLane, from, dLane, to);
  return morphMs() + plan.timeForArc(plan.firstLegDist) + 40;
}

function glide(el: HTMLElement, from: Rect, to: Rect, delay = 0): void {
  const dist = Math.hypot(to.x + to.w / 2 - (from.x + from.w / 2), to.y + to.h / 2 - (from.y + from.h / 2));
  el.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.w}px`, height: `${from.h}px` },
      { transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.w}px`, height: `${to.h}px` },
    ],
    { duration: travelDuration(dist), delay, easing: "cubic-bezier(.4,.05,.2,1)", fill: delay > 0 ? "backwards" : "none" },
  );
}

function puckTravel(el: HTMLElement, sLane: TodoLane, from: Rect, dLane: TodoLane, to: Rect): void {
  const plan = planTaxi(sLane, from, dLane, to);
  if (plan.S <= 0.5 || plan.T <= 1) { glide(el, from, to); return; }
  el.style.setProperty("--puck", LANE_COLOR[dLane] ?? "#7d8590");
  el.classList.add("traveling");

  const morph = morphMs();
  const dur = morph + plan.T + morph;
  const m1 = morph / dur;
  const m2 = (morph + plan.T) / dur;

  const kf: Keyframe[] = [{ transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.w}px`, height: `${from.h}px`, offset: 0, easing: "ease-in" }];
  const N = Math.max(8, Math.min(30, Math.round(plan.T / 35)));
  for (let k = 0; k <= N; k++) {
    const t = plan.T * (k / N);
    const s = Math.max(0, Math.min(plan.S, plan.sOf(t)));
    const p = plan.pointAt(s);
    kf.push({ transform: `translate(${p.x - PUCK_W / 2}px, ${p.y - PUCK_H / 2}px)`, width: `${PUCK_W}px`, height: `${PUCK_H}px`, offset: m1 + (m2 - m1) * (k / N), easing: k === N ? "ease-out" : "linear" });
  }
  kf.push({ transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.w}px`, height: `${to.h}px`, offset: 1 });

  const anim = el.animate(kf, { duration: dur, fill: "none" });
  anim.onfinish = () => el.classList.remove("traveling");
  anim.oncancel = () => el.classList.remove("traveling");
}

function fadeIn(el: HTMLElement): void {
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
}

function makeGhost(color: string): HTMLElement {
  const g = document.createElement("div");
  g.className = "puck-ghost";
  g.style.setProperty("--puck", color);
  stage.value?.appendChild(g);
  return g;
}
function flyToDrawer(from: Rect, anchor: Pt, color: string): void {
  const g = makeGhost(color);
  const a = g.animate(
    [
      { transform: `translate(${from.x}px, ${from.y}px)`, width: `${from.w}px`, height: `${from.h}px`, borderRadius: "8px", opacity: 1, offset: 0, easing: "cubic-bezier(.5,.1,.3,1)" },
      { transform: `translate(${anchor.x - PUCK_W / 2}px, ${anchor.y - PUCK_H / 2}px)`, width: `${PUCK_W}px`, height: `${PUCK_H}px`, borderRadius: "8px", opacity: 1, offset: 0.72, easing: "ease-in" },
      { transform: `translate(${anchor.x - 7}px, ${anchor.y - 7}px)`, width: "14px", height: "14px", borderRadius: "50%", opacity: 0, offset: 1 },
    ],
    { duration: morphMs() + 260, fill: "forwards" },
  );
  const done = () => g.remove();
  a.onfinish = done;
  a.oncancel = done;
}
function flyFromDrawer(anchor: Pt, to: Rect, color: string, el: HTMLElement): void {
  el.style.opacity = "0";
  const g = makeGhost(color);
  const a = g.animate(
    [
      { transform: `translate(${anchor.x - 7}px, ${anchor.y - 7}px)`, width: "14px", height: "14px", borderRadius: "50%", opacity: 0, offset: 0, easing: "ease-out" },
      { transform: `translate(${anchor.x - PUCK_W / 2}px, ${anchor.y - PUCK_H / 2}px)`, width: `${PUCK_W}px`, height: `${PUCK_H}px`, borderRadius: "8px", opacity: 1, offset: 0.28, easing: "cubic-bezier(.5,.1,.3,1)" },
      { transform: `translate(${to.x}px, ${to.y}px)`, width: `${to.w}px`, height: `${to.h}px`, borderRadius: "8px", opacity: 1, offset: 1 },
    ],
    { duration: morphMs() + 260, fill: "forwards" },
  );
  const done = () => { g.remove(); el.style.opacity = ""; };
  a.onfinish = done;
  a.oncancel = done;
}

function animateChanges(): void {
  const root = stage.value;
  if (!root) return;
  const cur = rects.value;
  const ovf = overflow.value;
  const sig =
    `${skyW.value}x${skyH.value}|` +
    placed.value.map((a) => `${a.id}:${a.lane}:${cur[a.id]?.x},${cur[a.id]?.y},${cur[a.id]?.w},${cur[a.id]?.h}`).join(";") +
    "|" +
    Object.keys(ovf).map((k) => `${k}:${ovf[k].map((a) => a.id).join(",")}`).join(";");
  if (sig === lastAnimSig) return;
  lastAnimSig = sig;
  const currentIds = new Set(Object.keys(cur));
  const currentOverflow: Record<string, string> = {};
  for (const k of Object.keys(ovf)) for (const a of ovf[k]) currentOverflow[a.id] = k;

  const resized = prevW !== skyW.value || prevH !== skyH.value;
  prevW = skyW.value;
  prevH = skyH.value;

  const arrived = new Set<TodoLane>();
  const closeDelays = new Map<TodoLane, number>();
  for (const a of placed.value) {
    const from = prevRects[a.id];
    const to = cur[a.id];
    const pLane = prevLane[a.id];
    const lane = a.lane;
    if (from && to && pLane && pLane !== lane) {
      arrived.add(lane);
      closeDelays.set(pLane, Math.max(closeDelays.get(pLane) ?? 0, exitClearTime(pLane, from, lane, to)));
    }
  }

  for (const a of placed.value) {
    const to = cur[a.id];
    if (!to) continue;
    const el = root.querySelector<HTMLElement>(`[data-fid="${a.id}"]`);
    if (!el) continue;
    const from = prevRects[a.id];
    const lane = a.lane;
    const pLane = prevLane[a.id];
    if (!from) {
      if (!resized && prevOverflow[a.id]) flyFromDrawer(drawerAnchor(prevOverflow[a.id]), to, LANE_COLOR[lane] ?? "#7d8590", el);
      else fadeIn(el);
    } else if (resized) {
      continue;
    } else if (pLane && pLane !== lane) {
      puckTravel(el, pLane, from, lane, to);
    } else if (from.x !== to.x || from.y !== to.y || from.w !== to.w || from.h !== to.h) {
      const closing = closeDelays.has(lane) && !arrived.has(lane);
      glide(el, from, to, closing ? (closeDelays.get(lane) ?? 0) : 0);
    }
  }

  if (!resized) {
    for (const id of Object.keys(prevRects)) {
      if (currentIds.has(id)) continue;
      const laneNow = currentOverflow[id];
      if (laneNow) flyToDrawer(prevRects[id], drawerAnchor(laneNow), LANE_COLOR[laneNow] ?? "#7d8590");
    }
  }

  prevRects = { ...cur };
  prevLane = Object.fromEntries(placed.value.map((a) => [a.id, a.lane]));
  prevOverflow = currentOverflow;
}
onUpdated(animateChanges);

// ---- add form (Taxiing zone) ---------------------------------------------------------
const draft = ref("");
function submit() {
  const text = draft.value.trim();
  if (!text) return;
  emit("add", text);
  draft.value = "";
}

// ---- drag & drop: native HTML5 drag, dropped anywhere in a zone moves the card there.
// No live reflow preview during the drag (this board is absolutely positioned, not a
// flex/grid list) — the browser's own semi-transparent drag ghost is enough feedback while
// dragging; the actual landing animates via the SAME puckTravel path as a button click. ---
const dragId = ref<string | null>(null);
function onDragStart(id: string, e: DragEvent) {
  dragId.value = id;
  e.dataTransfer?.setData("text/plain", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}
function onDragEnd() { dragId.value = null; }
function onStageDrop(e: DragEvent) {
  const id = dragId.value;
  dragId.value = null;
  if (!id || !stage.value) return;
  const r = stage.value.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const zone = zones.value.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
  if (!zone) return;
  const target = zone.k;
  const current = props.todos.find((t) => t.id === id);
  if (!current || current.lane === target) return;
  emit("move", id, target, [...byLane(target).map((t) => t.id), id]);
}

function onSetLane(id: string, lane: TodoLane) {
  emit("move", id, lane, [...byLane(lane).map((t) => t.id), id]);
}
</script>

<template>
  <div class="sky" @dragover.prevent @drop.prevent="onStageDrop">
    <div ref="stage" class="stage">
      <div v-for="(c, i) in corridors" :key="'c' + i" class="corridor" :style="{ transform: `translate(${c.x}px, ${c.y}px)`, width: c.w + 'px', height: c.h + 'px', borderRadius: c.radius }"></div>
      <svg class="taxi-svg" :viewBox="`0 0 ${skyW} ${skyH}`" preserveAspectRatio="none"><path :d="taxiPath" /></svg>

      <div v-for="z in zones" :key="z.k" class="lane-label" :style="{ transform: `translate(${z.x}px, ${z.y}px)`, width: LABEL_W + 'px', height: z.h + 'px', color: z.c }"><span>{{ z.label }}<span class="lane-count">{{ laneCount[z.k] }}</span></span></div>

      <!-- "add a task" tile — always the first slot in the Taxiing column, styled like a
           card (spine + rounded shell) but dashed, so it reads as the add affordance -->
      <div class="add-tile" :style="{ transform: `translate(${addTileRect.x}px, ${addTileRect.y}px)`, width: addTileRect.w + 'px', height: addTileRect.h + 'px' }">
        <div class="spine"></div>
        <form class="add-body" @submit.prevent="submit">
          <input v-model="draft" class="todo-input" placeholder="Neue Aufgabe…" spellcheck="false" />
          <button type="submit" class="todo-add-btn" aria-label="hinzufügen"><i class="ti ti-plus"></i></button>
        </form>
      </div>

        <div
          v-for="t in placed"
          :key="t.id"
          class="slot"
          :data-fid="t.id"
          :style="{ transform: `translate(${rects[t.id].x}px, ${rects[t.id].y}px)`, width: rects[t.id].w + 'px', height: rects[t.id].h + 'px' }"
        >
          <TodoCard
            :todo="t"
            :now="now"
            :dragging="t.id === dragId"
            draggable="true"
            @dragstart="onDragStart(t.id, $event)"
            @dragend="onDragEnd"
            @remove="emit('remove', t.id)"
            @set-lane="onSetLane(t.id, $event)"
            @set-text="(text) => emit('setText', t.id, text)"
            @set-note="(note) => emit('setNote', t.id, note)"
            @remove-note="emit('removeNote', t.id)"
            @set-link="(link) => emit('setLink', t.id, link)"
            @remove-link="emit('removeLink', t.id)"
          />
          <div class="puck"></div>
        </div>

        <button
          v-for="d in drawers"
          :key="'dw' + d.k"
          class="drawer-chip"
          :style="{ transform: `translate(${d.x}px, ${d.y}px)`, color: d.color }"
          :title="d.n + ' more'"
          @click="openDrawer = d.k"
        >
          <i class="ti ti-layers-subtract"></i> {{ d.n }}
        </button>
      </div>

      <div v-if="openDrawer && drawerItems.length" class="drawer-overlay" @click.self="openDrawer = null">
        <div class="drawer-panel">
          <div class="drawer-panel-h">
            <span><i class="ti ti-layers-subtract"></i> {{ openDrawer }} — {{ drawerItems.length }} more</span>
            <button class="icon" aria-label="close" @click="openDrawer = null"><i class="ti ti-x"></i></button>
          </div>
          <div class="drawer-panel-grid">
            <TodoCard
              v-for="t in drawerItems"
              :key="t.id"
              :todo="t"
              :now="now"
              :dragging="false"
              @remove="emit('remove', t.id)"
              @set-lane="onSetLane(t.id, $event)"
              @set-text="(text) => emit('setText', t.id, text)"
              @set-note="(note) => emit('setNote', t.id, note)"
              @remove-note="emit('removeNote', t.id)"
              @set-link="(link) => emit('setLink', t.id, link)"
              @remove-link="emit('removeLink', t.id)"
            />
          </div>
        </div>
      </div>
    </div>
</template>

<style scoped>
/* the "add a task" tile — same shell as .todo-card (spine + rounded), dashed border to
   read as an affordance rather than a real card */
.add-tile { position: absolute; top: 0; left: 0; z-index: 2; display: flex; background: var(--strip); border: 0.5px dashed var(--border); border-radius: 8px; overflow: hidden; }
.add-tile .spine { width: 4px; flex: none; background: var(--gray); }
.add-body { flex: 1; min-width: 0; padding: 0 8px; display: flex; align-items: center; gap: 6px; }
.todo-input { flex: 1; min-width: 0; font-size: 12px; padding: 4px 8px; height: 26px; }
.todo-add-btn { all: unset; cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0.5px solid var(--border); border-radius: 6px; color: var(--text-dim); }
.todo-add-btn:hover { color: var(--text-hi); border-color: var(--gray); }

.sky { position: relative; flex: 1; min-height: 0; overflow: hidden; margin-top: 8px; }
.stage { position: absolute; inset: 16px; }
.corridor { position: absolute; top: 0; left: 0; background: #090c11; pointer-events: none; }
.taxi-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
.taxi-svg path { fill: none; stroke: #d9a441; stroke-width: 1.5; stroke-linecap: round; opacity: 0.3; }
.lane-label { position: absolute; top: 0; left: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 3; }
.lane-label span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 10px; font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; color: currentColor; white-space: nowrap; }
/* same lane count as the session board's FlightBoard: out of flow so the centred name never shifts */
.lane-label span { position: relative; }
.lane-label .lane-count { position: absolute; inset-inline-start: 100%; inset-block-start: 0; writing-mode: inherit; transform: none; font-variant-numeric: tabular-nums; letter-spacing: 0.5px; }
.lane-label .lane-count::before { content: "·"; margin-inline: 5px; }
.slot { position: absolute; top: 0; left: 0; overflow: hidden; z-index: 2; cursor: grab; }
.slot :deep(.todo-card) { height: 100%; transition: opacity 0.18s ease; }
.puck { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: color-mix(in srgb, var(--puck, #7d8590) 22%, var(--strip)); border: 1px solid color-mix(in srgb, var(--puck, #7d8590) 55%, transparent); opacity: 0; pointer-events: none; }
.slot.traveling { z-index: 5; }
.slot.traveling .puck { opacity: 1; }
.slot.traveling :deep(.todo-card) { opacity: 0; }

.puck-ghost { position: absolute; top: 0; left: 0; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: color-mix(in srgb, var(--puck, #7d8590) 22%, var(--strip)); border: 1px solid color-mix(in srgb, var(--puck, #7d8590) 55%, transparent); z-index: 5; pointer-events: none; }

.drawer-chip { position: absolute; top: 0; left: 0; z-index: 4; all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: currentColor; background: var(--panel); border: 0.5px solid var(--border); border-radius: 999px; padding: 2px 9px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
.drawer-chip:hover { border-color: currentColor; }
.drawer-chip i { font-size: 12px; }
.drawer-overlay { position: absolute; inset: 0; z-index: 40; background: rgba(6, 9, 13, 0.66); display: flex; align-items: center; justify-content: center; padding: 28px; }
.drawer-panel { width: min(1100px, 92%); max-height: 84%; display: flex; flex-direction: column; background: var(--panel); border: 0.5px solid var(--border); border-radius: 12px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5); overflow: hidden; }
.drawer-panel-h { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 0.5px solid var(--border-soft); font-size: 13px; font-weight: 500; color: var(--text); text-transform: capitalize; }
.drawer-panel-h .icon { all: unset; cursor: pointer; display: inline-flex; padding: 4px; border-radius: 6px; color: var(--text-faint); font-size: 15px; }
.drawer-panel-h .icon:hover { background: rgba(255, 255, 255, 0.08); color: var(--text-dim); }
.drawer-panel-grid { flex: 1; min-height: 0; overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); grid-auto-rows: 132px; gap: 8px; padding: 12px 14px; align-content: start; }
</style>
