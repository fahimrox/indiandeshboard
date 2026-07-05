// ─── Intraday Booster: Momentum Ignition flow engine (shared) ─────────────────
// Ranks the NSE OI-spurt F&O feed so a stock surfaces AS momentum ignites (not
// after it has run): OI thrust (leading) + relative-volume (confirmation) +
// price thrust (capped trigger), × buildup quality, + early-ignition bonus
// (OI/vol firing while price is still small) + recency (fresh signals boosted,
// decays through the session). Used by both the Intraday Booster page and the
// top ticker so they show exactly the same signals. Real data only.

export type FlowStock = {
  symbol: string;
  ltp: number;
  changePct: number;
  oiChgPct: number;
  volume: number;
  buildup: string;
  signalTime: number;
  volumeShocker: boolean;
  flow: number;
  bullish: boolean;
  fresh: boolean;
};

export function computeBoosterFlows(
  raw: any[],
  now: number = Date.now(),
): { inflow: FlowStock[]; outflow: FlowStock[] } {
  if (!raw?.length) return { inflow: [], outflow: [] };

  // relative-volume percentile across the F&O universe (0..1)
  const vols = raw.map((s) => Number(s.volume) || 0).sort((a, b) => a - b);
  const relVol = (v: number) => {
    if (vols.length === 0 || vols[vols.length - 1] === 0) return 0;
    let lo = 0,
      hi = vols.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vols[mid] <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo / vols.length;
  };

  const scored: FlowStock[] = raw
    .filter((s) => s.buildup && s.buildup !== "Neutral")
    .map((s) => {
      const chg = Number(s.changePct) || 0;
      const oi = Number(s.oiChgPct) || 0;
      const rv = relVol(Number(s.volume) || 0);
      const bullish = s.buildup === "Long Buildup" || s.buildup === "Short Covering";
      const freshPos = s.buildup === "Long Buildup" || s.buildup === "Short Buildup"; // new money vs exits

      const oiThrust = Math.min(Math.abs(oi), 40); // 0..40  leading
      const volPart = rv * 22; // 0..22  confirmation
      const pricePart = Math.min(Math.abs(chg), 6) * 2.5; // 0..15  trigger (capped)
      const qual = freshPos ? 1 : 0.6;
      const earlyBonus = Math.abs(chg) < 2 && oiThrust >= 5 && rv > 0.75 ? 14 : 0;

      const ageMin = s.signalTime ? (now - s.signalTime) / 60000 : 600;
      const recency = Math.max(0, 18 - ageMin * 0.35);

      const flow = qual * (oiThrust + volPart + pricePart) + earlyBonus + recency;
      return {
        symbol: s.symbol,
        ltp: s.ltp,
        changePct: chg,
        oiChgPct: oi,
        volume: Number(s.volume) || 0,
        buildup: s.buildup,
        signalTime: s.signalTime ?? 0,
        volumeShocker: !!s.volumeShocker,
        flow,
        bullish,
        fresh: ageMin < 5,
      };
    });

  return {
    inflow: scored.filter((s) => s.bullish).sort((a, b) => b.flow - a.flow).slice(0, 10),
    outflow: scored.filter((s) => !s.bullish).sort((a, b) => b.flow - a.flow).slice(0, 10),
  };
}
