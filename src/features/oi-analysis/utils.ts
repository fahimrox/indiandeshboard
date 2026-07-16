import type { OISnapshot, SentimentResult, TimeRangePreset } from "./types";

export const CALL_COLOR = "#22c55e";
export const PUT_COLOR = "#ef4444";

export const TIME_PRESETS: readonly TimeRangePreset[] = [
  { id: "3m", label: "Last 3m", minutes: 3 },
  { id: "5m", label: "Last 5m", minutes: 5 },
  { id: "10m", label: "Last 10m", minutes: 10 },
  { id: "15m", label: "Last 15m", minutes: 15 },
  { id: "30m", label: "Last 30m", minutes: 30 },
  { id: "1h", label: "Last 1h", minutes: 60 },
  { id: "2h", label: "Last 2h", minutes: 120 },
  { id: "3h", label: "Last 3h", minutes: 180 },
  { id: "all", label: "Full Day", minutes: "ALL" },
] as const;

/** Indian-style short numbers: 1.37Cr, 77.52L, 12.5K */
export function formatIN(value: number): string {
  const v = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (v >= 1e7) return `${sign}${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `${sign}${(v / 1e5).toFixed(2)}L`;
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(2)}K`;
  return `${sign}${v.toFixed(0)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Pure derivation of sentiment from a snapshot.
 * Replace internals with your existing AI/engine output if you have one —
 * keep the shape identical.
 */
export function deriveSentiment(snap: OISnapshot): SentimentResult {
  const { pcr, totalCallOIChange, totalPutOIChange } = snap;
  // PCR-driven base score (centered at 1.0)
  let score = clamp(50 + (pcr - 1) * 60, 5, 95);

  // Heavy call writing (call OI add) pushes bearish; put add pushes bullish.
  const writeBias = totalPutOIChange - totalCallOIChange;
  score = clamp(score + Math.sign(writeBias) * Math.min(Math.abs(writeBias) / 5e6, 15), 5, 95);

  const label = score >= 60 ? "Bullish" : score <= 40 ? "Bearish" : "Neutral";

  const insight =
    label === "Bearish"
      ? "Market displaying bearish sentiment with negative indicators."
      : label === "Bullish"
        ? "Market displaying bullish sentiment with supportive OI build-up."
        : "Market displaying balanced sentiment with mixed positioning.";

  const analysis = `${label} bias with PCR at ${pcr.toFixed(2)}. ${
    totalCallOIChange > totalPutOIChange
      ? `Heavier call accumulation (${formatIN(totalCallOIChange)}) vs puts (${formatIN(
          totalPutOIChange,
        )}) suggests resistance build-up.`
      : `Heavier put accumulation (${formatIN(totalPutOIChange)}) vs calls (${formatIN(
          totalCallOIChange,
        )}) suggests support build-up.`
  }`;

  return { label, score: Math.round(score), insight, analysis };
}

export function sentimentColor(label: SentimentResult["label"]): string {
  if (label === "Bullish") return CALL_COLOR;
  if (label === "Bearish") return PUT_COLOR;
  return "#eab308";
}
