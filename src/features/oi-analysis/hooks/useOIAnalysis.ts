import { useMemo, useState } from "react";
import type { ChartMode, OISnapshot, SentimentResult } from "../types";
import { deriveSentiment } from "../utils";

interface UseOIAnalysisArgs {
  /** Live snapshot coming from your EXISTING service/hook. */
  snapshot: OISnapshot | null;
  /** Pass your existing sentiment if backend already computes it. */
  externalSentiment?: SentimentResult | null;
}

export interface OIAnalysisView {
  snapshot: OISnapshot | null;
  sentiment: SentimentResult | null;
  chartMode: ChartMode;
  setChartMode: (m: ChartMode) => void;
  strikeDepth: number; // strikes above/below ATM
  setStrikeDepth: (n: number) => void;
  visibleStrikes: OISnapshot["strikes"];
}

export function useOIAnalysis({
  snapshot,
  externalSentiment = null,
}: UseOIAnalysisArgs): OIAnalysisView {
  const [chartMode, setChartMode] = useState<ChartMode>("OI_CHANGE_TOTAL");
  const [strikeDepth, setStrikeDepth] = useState<number>(10);

  const sentiment = useMemo<SentimentResult | null>(() => {
    if (externalSentiment) return externalSentiment;
    return snapshot ? deriveSentiment(snapshot) : null;
  }, [snapshot, externalSentiment]);

  const visibleStrikes = useMemo(() => {
    if (!snapshot) return [];
    if (strikeDepth <= 0) return snapshot.strikes;
    const sorted = [...snapshot.strikes].sort((a, b) => a.strike - b.strike);
    const atmIdx = sorted.findIndex((s) => s.strike === snapshot.atmStrike);
    if (atmIdx < 0) return sorted;
    return sorted.slice(
      Math.max(0, atmIdx - strikeDepth),
      Math.min(sorted.length, atmIdx + strikeDepth + 1)
    );
  }, [snapshot, strikeDepth]);

  return {
    snapshot,
    sentiment,
    chartMode,
    setChartMode,
    strikeDepth,
    setStrikeDepth,
    visibleStrikes,
  };
}
