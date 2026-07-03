import type { OptionChain, OcRow } from "@/lib/nse.functions";
import type { Quote } from "@/lib/market.functions";

// ── Color convention for the Pro page ────────────────────────────────────────
// CALL side = rose (call writing builds resistance → bearish pressure)
// PUT  side = emerald (put writing builds support → bullish pressure)
export const CALL = "#f43f5e"; // rose-500
export const PUT = "#10b981"; // emerald-500
export const CALL_SOFT = "rgba(244,63,94,0.16)";
export const PUT_SOFT = "rgba(16,185,129,0.16)";

export type Bias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type Tone = "bullish" | "bearish" | "neutral";

export interface Driver {
  label: string;
  detail: string;
  tone: Tone;
  weight: number; // absolute contribution to the score
}

export interface Level {
  strike: number;
  oi: number;
  oiChg: number;
  strengthPct: number; // 0..100 relative to the strongest wall on that side
  distPct: number; // distance from spot, signed %
}

export interface BuildupBucket {
  longBuildup: number;
  shortBuildup: number;
  shortCovering: number;
  longUnwinding: number;
  neutral: number;
}

export interface ProAnalysis {
  ok: boolean;
  spot: number;
  atmStrike: number;
  step: number;

  pcr: number;
  pcrPrev: number;
  pcrChange: number;
  pcrZone: string;

  maxPain: number;
  maxPainDistPct: number;

  score: number; // 0..100 (50 = neutral)
  bias: Bias;
  confidence: number; // 0..100
  headline: string;
  drivers: Driver[];

  resistances: Level[]; // nearest → far, above spot
  supports: Level[]; // nearest → far, below spot

  totalCeOi: number;
  totalPeOi: number;
  totalCeOiChg: number;
  totalPeOiChg: number;

  callWriting: { strike: number; oiChg: number } | null;
  putWriting: { strike: number; oiChg: number } | null;
  callUnwinding: { strike: number; oiChg: number } | null;
  putUnwinding: { strike: number; oiChg: number } | null;

  buildup: BuildupBucket;

  atmStraddle: number;
  atmIv: number;
  expectedHigh: number;
  expectedLow: number;
  expectedMovePct: number;

  narrative: string[];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function pcrZoneLabel(pcr: number): string {
  if (pcr >= 1.3) return "Strong Bullish";
  if (pcr >= 1.05) return "Bullish";
  if (pcr <= 0.6) return "Strong Bearish";
  if (pcr <= 0.85) return "Bearish";
  return "Neutral";
}

function detectStep(rows: OcRow[]): number {
  if (rows.length < 2) return 50;
  const diffs: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const d = Math.abs(rows[i].strike - rows[i - 1].strike);
    if (d > 0) diffs.push(d);
  }
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 50;
}

/**
 * Full AI-style OI analysis derived purely from the live/EOD option chain and
 * the underlying quote. Deterministic — no random / mock data.
 */
export function analyzeOptionChain(oc: OptionChain | null | undefined, quote?: Quote | null): ProAnalysis {
  const empty: ProAnalysis = {
    ok: false, spot: 0, atmStrike: 0, step: 50,
    pcr: 0, pcrPrev: 0, pcrChange: 0, pcrZone: "—",
    maxPain: 0, maxPainDistPct: 0,
    score: 50, bias: "NEUTRAL", confidence: 0, headline: "Awaiting data",
    drivers: [], resistances: [], supports: [],
    totalCeOi: 0, totalPeOi: 0, totalCeOiChg: 0, totalPeOiChg: 0,
    callWriting: null, putWriting: null, callUnwinding: null, putUnwinding: null,
    buildup: { longBuildup: 0, shortBuildup: 0, shortCovering: 0, longUnwinding: 0, neutral: 0 },
    atmStraddle: 0, atmIv: 0, expectedHigh: 0, expectedLow: 0, expectedMovePct: 0,
    narrative: [],
  };
  if (!oc || !Array.isArray(oc.rows) || oc.rows.length === 0) return empty;

  const rows = [...oc.rows].sort((a, b) => a.strike - b.strike);
  const spot = quote?.price || oc.spot || 0;
  const step = detectStep(rows);

  // ATM
  const atmRow = rows.reduce((prev, cur) =>
    Math.abs(cur.strike - spot) < Math.abs(prev.strike - spot) ? cur : prev
  );
  const atmStrike = atmRow.strike;

  // Totals
  const totalCeOi = oc.totals?.ceOi ?? rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0);
  const totalPeOi = oc.totals?.peOi ?? rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0);
  const totalCeOiChg = oc.totals?.ceOiChg ?? rows.reduce((a, r) => a + (r.ce?.oiChg ?? 0), 0);
  const totalPeOiChg = oc.totals?.peOiChg ?? rows.reduce((a, r) => a + (r.pe?.oiChg ?? 0), 0);

  // PCR (current + previous from OI change)
  const pcr = totalCeOi > 0 ? totalPeOi / totalCeOi : 0;
  const prevCe = Math.max(1, totalCeOi - totalCeOiChg);
  const prevPe = Math.max(0, totalPeOi - totalPeOiChg);
  const pcrPrev = prevCe > 0 ? prevPe / prevCe : pcr;
  const pcrChange = pcr - pcrPrev;
  const pcrZone = pcrZoneLabel(pcr);

  // Max pain (strike where combined writer payout is minimum)
  let maxPain = atmStrike;
  let minPain = Infinity;
  for (const test of rows) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < test.strike) pain += (r.ce?.oi ?? 0) * (test.strike - r.strike);
      if (r.strike > test.strike) pain += (r.pe?.oi ?? 0) * (r.strike - test.strike);
    }
    if (pain < minPain) { minPain = pain; maxPain = test.strike; }
  }
  const maxPainDistPct = spot > 0 ? ((spot - maxPain) / spot) * 100 : 0;

  // Support / Resistance walls
  const maxCe = Math.max(1, ...rows.map((r) => r.ce?.oi ?? 0));
  const maxPe = Math.max(1, ...rows.map((r) => r.pe?.oi ?? 0));
  const toLevel = (r: OcRow, side: "ce" | "pe", maxOi: number): Level => ({
    strike: r.strike,
    oi: r[side]?.oi ?? 0,
    oiChg: r[side]?.oiChg ?? 0,
    strengthPct: Math.round(((r[side]?.oi ?? 0) / maxOi) * 100),
    distPct: spot > 0 ? ((r.strike - spot) / spot) * 100 : 0,
  });
  const resistances = rows
    .filter((r) => r.strike >= atmStrike && (r.ce?.oi ?? 0) > 0)
    .sort((a, b) => (b.ce?.oi ?? 0) - (a.ce?.oi ?? 0))
    .slice(0, 3)
    .sort((a, b) => a.strike - b.strike)
    .map((r) => toLevel(r, "ce", maxCe));
  const supports = rows
    .filter((r) => r.strike <= atmStrike && (r.pe?.oi ?? 0) > 0)
    .sort((a, b) => (b.pe?.oi ?? 0) - (a.pe?.oi ?? 0))
    .slice(0, 3)
    .sort((a, b) => b.strike - a.strike)
    .map((r) => toLevel(r, "pe", maxPe));

  // Fresh OI action (writing / unwinding extremes)
  let callWriting: ProAnalysis["callWriting"] = null;
  let putWriting: ProAnalysis["putWriting"] = null;
  let callUnwinding: ProAnalysis["callUnwinding"] = null;
  let putUnwinding: ProAnalysis["putUnwinding"] = null;
  for (const r of rows) {
    const ceC = r.ce?.oiChg ?? 0;
    const peC = r.pe?.oiChg ?? 0;
    if (!callWriting || ceC > callWriting.oiChg) callWriting = { strike: r.strike, oiChg: ceC };
    if (!putWriting || peC > putWriting.oiChg) putWriting = { strike: r.strike, oiChg: peC };
    if (!callUnwinding || ceC < callUnwinding.oiChg) callUnwinding = { strike: r.strike, oiChg: ceC };
    if (!putUnwinding || peC < putUnwinding.oiChg) putUnwinding = { strike: r.strike, oiChg: peC };
  }

  // Buildup distribution from per-leg signals
  const buildup: BuildupBucket = { longBuildup: 0, shortBuildup: 0, shortCovering: 0, longUnwinding: 0, neutral: 0 };
  const tally = (sig?: string) => {
    if (!sig || sig === "Neutral") { buildup.neutral++; return; }
    if (sig.includes("Long Buildup")) buildup.longBuildup++;
    else if (sig.includes("Short Buildup")) buildup.shortBuildup++;
    else if (sig.includes("Short Cover")) buildup.shortCovering++;
    else if (sig.includes("Long Unwinding")) buildup.longUnwinding++;
    else buildup.neutral++;
  };
  for (const r of rows) { tally(r.ce?.signal); tally(r.pe?.signal); }

  // Expected range from ATM straddle + IV
  const atmStraddle = (atmRow.ce?.ltp ?? 0) + (atmRow.pe?.ltp ?? 0);
  const atmIv = ((atmRow.ce?.iv ?? 0) + (atmRow.pe?.iv ?? 0)) / (((atmRow.ce?.iv ?? 0) > 0 ? 1 : 0) + ((atmRow.pe?.iv ?? 0) > 0 ? 1 : 0) || 1);
  const expectedHigh = spot + atmStraddle;
  const expectedLow = Math.max(0, spot - atmStraddle);
  const expectedMovePct = spot > 0 ? (atmStraddle / spot) * 100 : 0;

  // ── SCORING ────────────────────────────────────────────────────────────────
  const drivers: Driver[] = [];
  let score = 50;

  // 1. PCR level
  const pcrContrib = clamp((pcr - 1) * 42, -20, 20);
  score += pcrContrib;
  drivers.push({
    label: `PCR ${pcr.toFixed(2)} — ${pcrZone}`,
    detail: pcr >= 1 ? "More puts than calls open; writers are defending downside (supportive)." : "More calls than puts open; writers are capping upside (heavy above).",
    tone: pcrContrib > 3 ? "bullish" : pcrContrib < -3 ? "bearish" : "neutral",
    weight: Math.abs(pcrContrib),
  });

  // 2. PCR trend intraday
  const pcrTrendContrib = clamp(pcrChange * 30, -8, 8);
  score += pcrTrendContrib;
  if (Math.abs(pcrChange) > 0.02) {
    drivers.push({
      label: `PCR ${pcrChange >= 0 ? "rising" : "falling"} (${pcrChange >= 0 ? "+" : ""}${pcrChange.toFixed(2)})`,
      detail: pcrChange >= 0 ? "Fresh put writing outpacing calls — bias improving intraday." : "Fresh call writing outpacing puts — bias weakening intraday.",
      tone: pcrTrendContrib > 1 ? "bullish" : pcrTrendContrib < -1 ? "bearish" : "neutral",
      weight: Math.abs(pcrTrendContrib),
    });
  }

  // 3. Net fresh OI writing (put writing bullish, call writing bearish)
  const totalChgMag = Math.abs(totalCeOiChg) + Math.abs(totalPeOiChg) || 1;
  const writeBias = (totalPeOiChg - totalCeOiChg) / totalChgMag; // -1..1
  const writeContrib = clamp(writeBias * 16, -16, 16);
  score += writeContrib;
  drivers.push({
    label: totalPeOiChg >= totalCeOiChg ? "Net Put writing dominant" : "Net Call writing dominant",
    detail: totalPeOiChg >= totalCeOiChg
      ? "Option writers are adding puts — building a floor beneath the market."
      : "Option writers are adding calls — building a ceiling above the market.",
    tone: writeContrib > 2 ? "bullish" : writeContrib < -2 ? "bearish" : "neutral",
    weight: Math.abs(writeContrib),
  });

  // 4. Buildup skew
  const bullCount = buildup.longBuildup + buildup.shortCovering;
  const bearCount = buildup.shortBuildup + buildup.longUnwinding;
  const buildTotal = bullCount + bearCount || 1;
  const buildContrib = clamp(((bullCount - bearCount) / buildTotal) * 12, -12, 12);
  score += buildContrib;

  // 5. Price momentum today
  const chgPct = quote?.changePct ?? 0;
  const momoContrib = clamp(chgPct * 3, -10, 10);
  score += momoContrib;
  if (Math.abs(chgPct) > 0.05) {
    drivers.push({
      label: `Spot ${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}% today`,
      detail: chgPct >= 0 ? "Underlying trending up on the session." : "Underlying trending down on the session.",
      tone: momoContrib > 1 ? "bullish" : momoContrib < -1 ? "bearish" : "neutral",
      weight: Math.abs(momoContrib),
    });
  }

  // 6. Max pain gravity
  const painContrib = clamp(-maxPainDistPct * 2.2, -8, 8);
  score += painContrib;
  drivers.push({
    label: `Max Pain ${maxPain} (${maxPainDistPct >= 0 ? "+" : ""}${maxPainDistPct.toFixed(2)}% vs spot)`,
    detail: Math.abs(maxPainDistPct) < 0.15
      ? "Spot pinned near max pain — expiry magnet, expect range-bound action."
      : maxPainDistPct > 0
        ? "Spot trading above max pain — writers may pull price lower into expiry."
        : "Spot trading below max pain — writers may lift price higher into expiry.",
    tone: painContrib > 1 ? "bullish" : painContrib < -1 ? "bearish" : "neutral",
    weight: Math.abs(painContrib),
  });

  score = clamp(Math.round(score), 2, 98);
  const bias: Bias = score >= 58 ? "BULLISH" : score <= 42 ? "BEARISH" : "NEUTRAL";

  // Confidence = agreement of weighted drivers with the final bias
  const dir = bias === "BULLISH" ? 1 : bias === "BEARISH" ? -1 : 0;
  const totalWeight = drivers.reduce((a, d) => a + d.weight, 0) || 1;
  const agreeWeight = drivers.reduce((a, d) => {
    const dTone = d.tone === "bullish" ? 1 : d.tone === "bearish" ? -1 : 0;
    return a + (dir !== 0 && dTone === dir ? d.weight : 0);
  }, 0);
  let confidence = dir === 0
    ? clamp(100 - Math.abs(score - 50) * 4, 30, 70)
    : clamp(Math.round(45 + (agreeWeight / totalWeight) * 55), 30, 96);

  // Sort drivers strongest first
  drivers.sort((a, b) => b.weight - a.weight);

  const headline = buildHeadline(bias, pcr, maxPain, spot, resistances, supports);
  const narrative = buildNarrative({
    bias, score, pcr, pcrZone, pcrChange, maxPain, maxPainDistPct, spot, atmStrike,
    resistances, supports, totalPeOiChg, totalCeOiChg, expectedMovePct, expectedHigh, expectedLow,
    callWriting, putWriting,
  });

  return {
    ok: true, spot, atmStrike, step,
    pcr, pcrPrev, pcrChange, pcrZone,
    maxPain, maxPainDistPct,
    score, bias, confidence, headline, drivers,
    resistances, supports,
    totalCeOi, totalPeOi, totalCeOiChg, totalPeOiChg,
    callWriting, putWriting, callUnwinding, putUnwinding,
    buildup,
    atmStraddle, atmIv, expectedHigh, expectedLow, expectedMovePct,
    narrative,
  };
}

function buildHeadline(bias: Bias, pcr: number, maxPain: number, spot: number, res: Level[], sup: Level[]): string {
  const r = res[0]?.strike;
  const s = sup[0]?.strike;
  if (bias === "BULLISH") return `Bullish OI structure — buyers defended ${s ?? "support"}, upside capped near ${r ?? "resistance"}.`;
  if (bias === "BEARISH") return `Bearish OI structure — sellers active at ${r ?? "resistance"}, ${s ?? "support"} is the line to watch.`;
  return `Balanced OI structure — market boxed between ${s ?? "support"} and ${r ?? "resistance"}, awaiting a trigger.`;
}

function fmtShort(n: number): string {
  const v = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (v >= 1e7) return `${s}${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${s}${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${s}${(v / 1e3).toFixed(1)}K`;
  return `${s}${Math.round(v)}`;
}

function buildNarrative(a: {
  bias: Bias; score: number; pcr: number; pcrZone: string; pcrChange: number;
  maxPain: number; maxPainDistPct: number; spot: number; atmStrike: number;
  resistances: Level[]; supports: Level[]; totalPeOiChg: number; totalCeOiChg: number;
  expectedMovePct: number; expectedHigh: number; expectedLow: number;
  callWriting: { strike: number; oiChg: number } | null;
  putWriting: { strike: number; oiChg: number } | null;
}): string[] {
  const out: string[] = [];
  const r1 = a.resistances[0]?.strike;
  const s1 = a.supports[0]?.strike;

  out.push(
    `The option chain reads ${a.bias.toLowerCase()} with a sentiment score of ${a.score}/100. ` +
    `Put-Call Ratio sits at ${a.pcr.toFixed(2)} (${a.pcrZone})${Math.abs(a.pcrChange) > 0.02 ? `, and is ${a.pcrChange >= 0 ? "rising" : "slipping"} through the session` : ""}.`
  );

  if (r1 && s1) {
    out.push(
      `The heaviest call wall is at ${r1} (immediate resistance) while the strongest put base is at ${s1} (immediate support). ` +
      `As long as price holds above ${s1}, dips are likely to be bought; a break below opens room toward the next put base.`
    );
  }

  out.push(
    `Max pain is at ${a.maxPain} — ${Math.abs(a.maxPainDistPct) < 0.15 ? "almost exactly where spot is trading, a classic expiry pin" : a.maxPainDistPct > 0 ? "below the current spot, so writers have an incentive to drag price lower into expiry" : "above the current spot, so writers may let price drift higher into expiry"}.`
  );

  if (a.putWriting && a.callWriting) {
    const bigger = Math.abs(a.putWriting.oiChg) >= Math.abs(a.callWriting.oiChg) ? "put" : "call";
    out.push(
      `Today's freshest writing: ${fmtShort(a.putWriting.oiChg)} puts added at ${a.putWriting.strike} vs ${fmtShort(a.callWriting.oiChg)} calls at ${a.callWriting.strike}. ` +
      `The ${bigger}-side activity is leading, ${bigger === "put" ? "reinforcing the floor" : "reinforcing the ceiling"}.`
    );
  }

  out.push(
    `ATM straddle implies roughly a ${a.expectedMovePct.toFixed(2)}% move, an expected band of about ${Math.round(a.expectedLow)} – ${Math.round(a.expectedHigh)} into expiry.`
  );

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEG BUILDUP CLASSIFIER (live OI-change based, price-direction aware)
// ═══════════════════════════════════════════════════════════════════════════
export type BuildupKind = "LONG_BUILDUP" | "SHORT_BUILDUP" | "SHORT_COVER" | "LONG_UNWIND" | "NEUTRAL";

export interface LegBuildup {
  kind: BuildupKind;
  label: string;
  color: string;
  soft: string;
}

/**
 * Classify a single option leg's action from its live OI change and the option
 * premium's direction (a call gains when the underlying rises, a put when it
 * falls — so `priceUp` is passed per side). This yields the classic 4-quadrant
 * read used by pro OI terminals.
 */
export function classifyLegBuildup(oiChgPct: number, priceUp: boolean): LegBuildup {
  const m = Math.abs(oiChgPct);
  if (m < 1.5) return { kind: "NEUTRAL", label: "Neutral", color: "#94a3b8", soft: "rgba(100,116,139,0.14)" };
  const isStrong = m >= 15;
  const strong = isStrong ? "Strong" : "Weak";
  const oiUp = oiChgPct > 0;
  // Colour purely by impact & direction (no other hues):
  //   green  = option gaining  (Long Buildup / Short Cover)
  //   red    = option losing   (Short Buildup / Long Unwinding)
  //   Strong = dark/vivid shade, Weak = light/pale shade.
  const green = isStrong
    ? { color: "#16a34a", soft: "rgba(22,163,74,0.22)" }
    : { color: "#86efac", soft: "rgba(134,239,172,0.12)" };
  const red = isStrong
    ? { color: "#dc2626", soft: "rgba(220,38,38,0.22)" }
    : { color: "#fca5a5", soft: "rgba(252,165,165,0.12)" };
  if (priceUp && oiUp) return { kind: "LONG_BUILDUP", label: `${strong} Long Buildup`, ...green };
  if (!priceUp && oiUp) return { kind: "SHORT_BUILDUP", label: `${strong} Short Buildup`, ...red };
  if (priceUp && !oiUp) return { kind: "SHORT_COVER", label: `${strong} Short Cover`, ...green };
  return { kind: "LONG_UNWIND", label: `${strong} Long Unwinding`, ...red };
}

// ═══════════════════════════════════════════════════════════════════════════
//  INDIA VIX INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════
export interface VixRead {
  value: number;
  changePct: number;
  regime: string;
  color: string;
  band: number; // 0..100 marker position on the gradient
  note: string;
  tone: Tone;
}

export function readVix(value: number, changePct: number): VixRead {
  if (!value || value <= 0) {
    return { value: 0, changePct: 0, regime: "Unavailable", color: "#64748b", band: 0, note: "India VIX feed unavailable right now.", tone: "neutral" };
  }
  let regime: string, color: string, band: number, note: string, tone: Tone;
  if (value < 12) {
    regime = "LOW · Complacency"; color = "#10b981"; band = 15;
    tone = "neutral";
    note = "Volatility is cheap — option premiums are thin. Great regime for option buyers and directional bets; watch for a volatility expansion off these lows.";
  } else if (value < 15) {
    regime = "CALM · Balanced"; color = "#22c55e"; band = 38;
    tone = "neutral";
    note = "Volatility is subdued and orderly. Trends can extend smoothly; premium selling works but keep sizing modest.";
  } else if (value < 19) {
    regime = "ELEVATED · Caution"; color = "#f59e0b"; band = 62;
    tone = "bearish";
    note = "Volatility is picking up — hedging demand rising. Expect wider swings; sellers earn richer premium but risk is higher.";
  } else if (value < 25) {
    regime = "HIGH · Fear"; color = "#f97316"; band = 82;
    tone = "bearish";
    note = "Fear is elevated. Sharp two-way moves likely. Favour defined-risk trades; naked selling is dangerous here.";
  } else {
    regime = "EXTREME · Panic"; color = "#f43f5e"; band = 95;
    tone = "bearish";
    note = "Panic-level volatility. Premiums are fat but whipsaw risk is severe — protection is expensive, position tiny.";
  }
  return { value, changePct, regime, color, band, note, tone };
}

// ═══════════════════════════════════════════════════════════════════════════
//  SMART MONEY FOOTPRINT & RISK MATRIX
// ═══════════════════════════════════════════════════════════════════════════
export interface SmartMoney {
  bias: string;
  biasTone: Tone;
  maxPain: number;
  ceWall: number;
  peWall: number;
  rangeLow: number;
  rangeHigh: number;
  gammaZone: number; // strike carrying the largest combined OI (pin risk)
  freshCe: number;
  freshPe: number;
  note: string;
  insights: string[];
}

export function computeSmartMoney(a: ProAnalysis): SmartMoney {
  const ceWall = a.resistances[0]?.strike ?? a.atmStrike;
  const peWall = a.supports[0]?.strike ?? a.atmStrike;
  const rangeLow = Math.min(ceWall, peWall);
  const rangeHigh = Math.max(ceWall, peWall);
  const writersBearish = a.totalCeOiChg >= a.totalPeOiChg;
  const bias = writersBearish ? "Call Writers (Bearish)" : "Put Writers (Bullish)";
  const biasTone: Tone = writersBearish ? "bearish" : "bullish";

  const insights: string[] = [];
  insights.push(
    writersBearish
      ? `Institutions added more calls (${short(a.totalCeOiChg)}) than puts (${short(a.totalPeOiChg)}) — building an overhead supply zone.`
      : `Institutions added more puts (${short(a.totalPeOiChg)}) than calls (${short(a.totalCeOiChg)}) — building a demand floor below price.`
  );
  if (a.callWriting) insights.push(`Heaviest fresh call writing at ${a.callWriting.strike} — the ceiling smart money is defending.`);
  if (a.putWriting) insights.push(`Heaviest fresh put writing at ${a.putWriting.strike} — the floor smart money is defending.`);
  insights.push(
    Math.abs(a.maxPainDistPct) < 0.2
      ? `Spot is pinned to max pain (${a.maxPain}) — expiry-magnet, range-bound bias.`
      : a.maxPainDistPct > 0
        ? `Spot is above max pain (${a.maxPain}); writers are incentivised to pull it lower into expiry.`
        : `Spot is below max pain (${a.maxPain}); writers may let it drift higher into expiry.`
  );

  const note = `Max Pain sits at ${a.maxPain}. Option writing frames a likely trading band between ${rangeLow} (support) and ${rangeHigh} (resistance) — trade the edges, fade the middle.`;

  return {
    bias, biasTone,
    maxPain: a.maxPain, ceWall, peWall, rangeLow, rangeHigh,
    gammaZone: a.atmStrike, freshCe: a.totalCeOiChg, freshPe: a.totalPeOiChg,
    note, insights,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AI BUYER & SELLER ACTION PLAN
// ═══════════════════════════════════════════════════════════════════════════
export interface ActionPlan {
  buyer: {
    biasLabel: string;
    biasTone: Tone;
    bullTrigger: number;
    bullTarget: number;
    bullStop: number;
    bearTrigger: number;
    bearTarget: number;
    bearStop: number;
    note: string;
  };
  seller: {
    strategy: string;
    tone: Tone;
    legs: string;
    note: string;
  };
}

export function buildActionPlan(a: ProAnalysis, vix: number): ActionPlan {
  const step = a.step || 50;
  const r1 = a.resistances[0]?.strike ?? a.atmStrike + step;
  const s1 = a.supports[0]?.strike ?? a.atmStrike - step;
  const band = Math.max(step, r1 - s1);

  const buyer = {
    biasLabel: a.bias === "BULLISH" ? "UP BIAS" : a.bias === "BEARISH" ? "DOWN BIAS" : "RANGE BIAS",
    biasTone: (a.bias === "BULLISH" ? "bullish" : a.bias === "BEARISH" ? "bearish" : "neutral") as Tone,
    bullTrigger: r1,
    bullTarget: r1 + band,
    bullStop: a.atmStrike,
    bearTrigger: s1,
    bearTarget: s1 - band,
    bearStop: a.atmStrike,
    note: `Score ${a.score}/100 · PCR ${a.pcr.toFixed(2)}. ${
      a.bias === "BULLISH"
        ? `Buy dips toward ${s1}; a close above ${r1} opens ${r1 + band}.`
        : a.bias === "BEARISH"
          ? `Sell rallies toward ${r1}; a close below ${s1} opens ${s1 - band}.`
          : `Boxed between ${s1}-${r1}; trade the breakout, avoid the middle.`
    }`,
  };

  const vixHi = vix >= 15;
  let strategy: string, legs: string, tone: Tone, note: string;
  if (a.bias === "BEARISH") {
    strategy = "Bear Call Spread";
    legs = `Sell ${r1} CE · Buy ${r1 + 2 * step} CE`;
    tone = "bearish";
    note = `Resistance heavy at ${r1}. Collect premium while price stays below ${r1}. ${vixHi ? "VIX rich — premium favourable." : "VIX low — premium thin, keep size small."}`;
  } else if (a.bias === "BULLISH") {
    strategy = "Bull Put Spread";
    legs = `Sell ${s1} PE · Buy ${s1 - 2 * step} PE`;
    tone = "bullish";
    note = `Support firm at ${s1}. Collect premium while price holds above ${s1}. ${vixHi ? "VIX rich — premium favourable." : "VIX low — premium thin, keep size small."}`;
  } else {
    strategy = "Iron Condor";
    legs = `Sell ${s1} PE & ${r1} CE · Buy wings ±${2 * step}`;
    tone = "neutral";
    note = `Range-bound structure between ${s1}-${r1}. Harvest theta as long as price stays inside. ${vixHi ? "Elevated VIX = fatter credit." : "Thin VIX = modest credit, tight management."}`;
  }

  return { buyer, seller: { strategy, tone, legs, note } };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AI LIVE COMMENTARY — real-time signal generator
// ═══════════════════════════════════════════════════════════════════════════
export type SignalIcon = "writing" | "surge" | "pain" | "vix" | "gamma" | "pcr" | "bolt";

export interface LiveSignal {
  id: string;
  icon: SignalIcon;
  title: string;
  bias: Bias;
  detail: string;
  entry?: string;
  target?: string;
  sl?: string;
  conviction: number; // 0..100
  insight: string;
  time: string;
}

export function buildLiveSignals(
  oc: OptionChain | null | undefined,
  a: ProAnalysis,
  vix: VixRead,
  symbol: string,
  asOf?: number
): LiveSignal[] {
  const out: Omit<LiveSignal, "time">[] = [];
  if (!a.ok) return [];
  const step = a.step || 50;
  const rows = oc?.rows ? [...oc.rows].sort((x, y) => x.strike - y.strike) : [];

  // 1. Call writing cluster (bearish)
  if (a.callWriting && a.callWriting.oiChg > 0) {
    const conv = clamp(Math.round(52 + (a.callWriting.oiChg / (a.totalCeOiChg || a.callWriting.oiChg)) * 40), 52, 92);
    out.push({
      id: "call-writing",
      icon: "writing",
      title: `Call Writing Cluster at ${a.callWriting.strike}`,
      bias: "BEARISH",
      detail: `${symbol} ${a.callWriting.strike} CE saw ${short(a.callWriting.oiChg)} fresh OI — institutions stacking resistance. A ceiling is forming at ${a.callWriting.strike}.`,
      entry: `Sell ${a.callWriting.strike} CE / buy ${a.callWriting.strike - step} PE`,
      target: `${a.supports[0]?.strike ?? a.atmStrike - step}`,
      sl: `Spot closes above ${a.callWriting.strike + step}`,
      conviction: conv,
      insight: "Heavy overhead call supply — sellers in control of that strike.",
    });
  }

  // 2. Put writing cluster (bullish)
  if (a.putWriting && a.putWriting.oiChg > 0) {
    const conv = clamp(Math.round(52 + (a.putWriting.oiChg / (a.totalPeOiChg || a.putWriting.oiChg)) * 40), 52, 92);
    out.push({
      id: "put-writing",
      icon: "writing",
      title: `Put Writing at ${a.putWriting.strike}`,
      bias: "BULLISH",
      detail: `${symbol} ${a.putWriting.strike} PE added ${short(a.putWriting.oiChg)} fresh OI — put writers defending. A solid floor is forming at ${a.putWriting.strike}.`,
      entry: `Buy ${a.resistances[0]?.strike ?? a.atmStrike} CE above spot`,
      target: `${(a.resistances[0]?.strike ?? a.atmStrike) + step}`,
      sl: `Spot below ${a.putWriting.strike}`,
      conviction: conv,
      insight: "Put writing at a key level signals smart-money support.",
    });
  }

  // 3. Gamma squeeze / pin risk (fresh OI concentrated near ATM)
  const nearAtm = rows.filter((r) => Math.abs(r.strike - a.atmStrike) <= step * 1.5);
  let gStrike = a.atmStrike, gMag = 0;
  for (const r of nearAtm) {
    const mag = Math.abs(r.ce?.oiChg ?? 0) + Math.abs(r.pe?.oiChg ?? 0);
    if (mag > gMag) { gMag = mag; gStrike = r.strike; }
  }
  if (gMag > 0) {
    const highVol = vix.value > 0 && vix.value >= 15;
    const conv = clamp(Math.round(48 + (gMag / ((a.totalCeOi + a.totalPeOi) || gMag)) * 400 + (highVol ? 8 : 0)), 48, 88);
    out.push({
      id: "gamma",
      icon: "gamma",
      title: `Gamma Zone at ${gStrike}`,
      bias: "NEUTRAL",
      detail: `Dense fresh OI (${short(gMag)}) is piling around ${gStrike}, the ATM gamma zone. Dealers hedging here can accelerate moves once ${gStrike} breaks${highVol ? " — and VIX is elevated, raising squeeze risk" : ""}.`,
      entry: `Straddle/strangle around ${gStrike} for a break`,
      target: `Range expansion beyond ${a.expectedLow.toFixed(0)}–${a.expectedHigh.toFixed(0)}`,
      sl: `Time-decay if price stalls at ${gStrike}`,
      conviction: conv,
      insight: "Gamma concentration near spot — expect an accelerated move on a break, or a pin if it holds.",
    });
  }

  // 4. Aggressive premium / volume surge
  let surge: OcRow | null = null; let surgeSide: "ce" | "pe" = "pe"; let surgeRatio = 0;
  for (const r of rows) {
    for (const side of ["ce", "pe"] as const) {
      const leg = r[side];
      if (!leg || !leg.oi) continue;
      const ratio = (leg.volume ?? 0) / leg.oi;
      if (ratio > surgeRatio && (leg.volume ?? 0) > 0) { surgeRatio = ratio; surge = r; surgeSide = side; }
    }
  }
  if (surge && surgeRatio >= 2) {
    const isCe = surgeSide === "ce";
    const leg = surge[surgeSide]!;
    out.push({
      id: "surge",
      icon: "surge",
      title: `${isCe ? "CE" : "PE"} Volume Surge at ${surge.strike}`,
      bias: isCe ? "BULLISH" : "BEARISH",
      detail: `${surge.strike} ${isCe ? "CE" : "PE"} volume/OI ratio at ${surgeRatio.toFixed(1)}x with LTP ${leg.ltp.toFixed(1)} — aggressive ${isCe ? "call" : "put"} buying, directional intent.`,
      entry: `Buy ${surge.strike} ${isCe ? "CE" : "PE"} on a controlled dip`,
      target: `${isCe ? surge.strike + 2 * step : surge.strike - 2 * step}`,
      sl: `Premium below ${(leg.ltp * 0.7).toFixed(1)}`,
      conviction: clamp(Math.round(55 + surgeRatio * 4), 55, 90),
      insight: `Fresh option buying with unusual velocity — momentum ${isCe ? "up" : "down"}.`,
    });
  }

  // 5. Max pain gravity
  out.push({
    id: "maxpain",
    icon: "pain",
    title: `Max Pain at ${a.maxPain}`,
    bias: Math.abs(a.maxPainDistPct) < 0.2 ? "NEUTRAL" : a.maxPainDistPct > 0 ? "BEARISH" : "BULLISH",
    detail: `${symbol} option pain centres at ${a.maxPain}; spot trades ${a.maxPainDistPct >= 0 ? "+" : ""}${a.maxPainDistPct.toFixed(2)}% away. ${Math.abs(a.maxPainDistPct) < 0.2 ? "Expect a magnet pin into expiry." : a.maxPainDistPct > 0 ? "Gravity pull points lower into expiry." : "Gravity pull points higher into expiry."}`,
    conviction: clamp(Math.round(55 + Math.min(30, Math.abs(a.maxPainDistPct) * 12)), 55, 82),
    insight: "Max pain acts as an expiry magnet for the underlying.",
  });

  // 6. PCR extreme
  out.push({
    id: "pcr",
    icon: "pcr",
    title: `PCR ${a.pcr.toFixed(2)} — ${a.pcrZone}`,
    bias: a.pcr >= 1.05 ? "BULLISH" : a.pcr <= 0.85 ? "BEARISH" : "NEUTRAL",
    detail: `Put-Call ratio at ${a.pcr.toFixed(2)}${Math.abs(a.pcrChange) > 0.02 ? ` and ${a.pcrChange >= 0 ? "rising" : "falling"} (${a.pcrChange >= 0 ? "+" : ""}${a.pcrChange.toFixed(2)})` : ""}. ${a.pcr >= 1.05 ? "Put-heavy positioning — supportive." : a.pcr <= 0.85 ? "Call-heavy positioning — capped." : "Balanced positioning."}`,
    conviction: clamp(Math.round(52 + Math.abs(a.pcr - 1) * 40), 52, 84),
    insight: "PCR gauges the balance of downside vs upside option interest.",
  });

  // 7. India VIX regime
  if (vix.value > 0) {
    out.push({
      id: "vix",
      icon: "vix",
      title: `India VIX ${vix.value.toFixed(2)} — ${vix.regime.split(" ")[0]}`,
      bias: vix.value < 13 ? "BULLISH" : vix.value >= 19 ? "BEARISH" : "NEUTRAL",
      detail: vix.note,
      conviction: clamp(Math.round(50 + Math.abs(vix.value - 14) * 2.5), 50, 80),
      insight: vix.value < 13 ? "Low-VIX regimes favour option buyers and trend continuation." : "Rising VIX warns of wider swings — manage risk tightly.",
    });
  }

  const ts = asOf && isFinite(asOf) ? asOf : Date.now();
  const time = new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
  return out.sort((x, y) => y.conviction - x.conviction).map((s) => ({ ...s, time }));
}

function short(n: number): string {
  const v = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (v >= 1e7) return `${s}${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${s}${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${s}${(v / 1e3).toFixed(1)}K`;
  return `${s}${Math.round(v)}`;
}
