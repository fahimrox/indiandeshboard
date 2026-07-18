import { marketDataLayer } from "./marketDataLayer";
import type { Quote } from "../market.functions";
import { NIFTY_STOCKS, BANKNIFTY_STOCKS, SENSEX_STOCKS } from "../market-constituents";

const INDICES = ["^NSEI", "^BSESN", "^NSEBANK", "^INDIAVIX"];

const SECTORS = [
  { key: "it", symbol: "^CNXIT", name: "IT" },
  { key: "pharma", symbol: "^CNXPHARMA", name: "Pharma" },
  { key: "auto", symbol: "^CNXAUTO", name: "Auto" },
  { key: "energy", symbol: "^CNXENERGY", name: "Energy" },
  { key: "fmcg", symbol: "^CNXFMCG", name: "FMCG" },
  { key: "metal", symbol: "^CNXMETAL", name: "Metal" },
  { key: "realty", symbol: "^CNXREALTY", name: "Realty" },
  { key: "media", symbol: "^CNXMEDIA", name: "Media" },
  { key: "psubank", symbol: "^CNXPSUBANK", name: "PSU Bank" },
  { key: "finance", symbol: "NIFTY_FIN_SERVICE.NS", name: "Finance" },
  { key: "banking", symbol: "^NSEBANK", name: "Banking" },
  { key: "infra", symbol: "^CNXINFRA", name: "Infra" },
];

type IndexBias = "Bullish" | "Bearish" | "Neutral";

function biasOf(pct: number): IndexBias {
  if (pct >= 0.25) return "Bullish";
  if (pct <= -0.25) return "Bearish";
  return "Neutral";
}

function reversalChance(pct: number, breadthPct: number, vixChg: number): number {
  const divergence = Math.abs(Math.sign(pct) * 50 - (breadthPct - 50));
  const vixBoost = Math.max(0, vixChg) * 4;
  return Math.min(99, Math.round(divergence + vixBoost));
}

function indexNote(label: string, q: Quote | null | undefined, bullsPct: number, vixChg: number) {
  if (!q) return null;
  const bias = biasOf(q.changePct);
  const rev = reversalChance(q.changePct, bullsPct, vixChg);
  const reason =
    bias === "Bullish"
      ? `holding above prior close with breadth at ${bullsPct.toFixed(0)}% bulls — momentum favors longs`
      : bias === "Bearish"
        ? `losing prior close with breadth at ${bullsPct.toFixed(0)}% bulls — sellers in control`
        : `coiling near prior close, breadth ${bullsPct.toFixed(0)}% bulls — waiting for trigger`;
  return { label, bias, changePct: q.changePct, reason, reversalChance: rev };
}

function buildPulse(opts: {
  nifty?: Quote | null;
  bank?: Quote | null;
  sensex?: Quote | null;
  vix?: Quote | null;
  /** Overall/headline breadth (NIFTY-50 constituents) — used for the market tone line. */
  bullsPct: number;
  /** Real per-index constituent bulls% for each index card. */
  indexBreadth: { nifty: number; bank: number; sensex: number };
  advance: number;
  decline: number;
  topSector?: { label: string; changePct: number };
  bottomSector?: { label: string; changePct: number };
  topGainer?: Quote;
  topLoser?: Quote;
  pcr: number;
}) {
  const { nifty, bank, sensex, vix, bullsPct, indexBreadth, advance, decline, topSector, bottomSector, topGainer, topLoser, pcr } = opts;
  const vixChg = vix?.changePct ?? 0;
  const vixLvl = vix?.price ?? 0;
  const overallTone: IndexBias = bullsPct >= 55 ? "Bullish" : bullsPct <= 45 ? "Bearish" : "Neutral";
  
  // Per-index breadth: each index card uses breadth from its OWN constituents
  // (NIFTY 50 / BANK NIFTY 12 / SENSEX 30) — never one shared NIFTY value.
  const indices = [
    indexNote("NIFTY 50", nifty, indexBreadth.nifty, vixChg),
    indexNote("BANK NIFTY", bank, indexBreadth.bank, vixChg),
    indexNote("SENSEX", sensex, indexBreadth.sensex, vixChg),
  ].filter(Boolean) as Array<{ label: string; bias: IndexBias; changePct: number; reason: string; reversalChance: number }>;

  const vixStatus =
    vixLvl === 0
      ? "VIX unavailable"
      : vixLvl < 12
        ? `India VIX at ${vixLvl.toFixed(2)} — extreme complacency, options cheap`
        : vixLvl < 15
          ? `India VIX at ${vixLvl.toFixed(2)} — low fear, trending environment`
          : vixLvl < 18
            ? `India VIX at ${vixLvl.toFixed(2)} — balanced volatility`
            : vixLvl < 22
              ? `India VIX at ${vixLvl.toFixed(2)} — elevated fear, expect wider ranges`
              : `India VIX at ${vixLvl.toFixed(2)} — high fear, defensive bias`;
  const vixDir = vixChg >= 0 ? `up ${vixChg.toFixed(2)}%` : `down ${Math.abs(vixChg).toFixed(2)}%`;

  const pcrStatus =
    pcr === 0
      ? ""
      : pcr > 1.3
        ? `PCR at ${pcr.toFixed(2)} — heavy put writing, supportive for bulls`
        : pcr < 0.8
          ? `PCR at ${pcr.toFixed(2)} — heavy call writing, bearish overhang`
          : `PCR at ${pcr.toFixed(2)} — balanced positioning`;

  const lines: string[] = [];
  lines.push(
    `Overall market is ${overallTone.toLowerCase()} — ${advance} advances vs ${decline} declines, bulls control ${bullsPct.toFixed(0)}% of breadth.`
  );
  for (const i of indices) {
    lines.push(
      `${i.label}: ${i.bias} (${i.changePct >= 0 ? "+" : ""}${i.changePct.toFixed(2)}%) — ${i.reason}. Reversal odds: ${i.reversalChance}%.`
    );
  }
  lines.push(`${vixStatus}, VIX ${vixDir} — ${vixChg > 3 ? "risk-off creeping in, hedge longs" : vixChg < -3 ? "fear easing, risk-on continuation likely" : "volatility steady, follow trend"}.`);
  if (pcrStatus) lines.push(pcrStatus + ".");
  if (topSector && bottomSector) {
    lines.push(
      `Sector flow: ${topSector.label} leads at ${topSector.changePct >= 0 ? "+" : ""}${topSector.changePct.toFixed(2)}%, ${bottomSector.label} drags at ${bottomSector.changePct.toFixed(2)}% — rotation favors ${topSector.changePct >= 0 ? "risk-on" : "defensive"} names.`
    );
  }
  if (topGainer && topLoser) {
    const tg = topGainer.symbol.replace(".NS", "").replace(".BO", "");
    const tl = topLoser.symbol.replace(".NS", "").replace(".BO", "");
    lines.push(
      `Stock impact: ${tg} (${topGainer.changePct >= 0 ? "+" : ""}${topGainer.changePct.toFixed(2)}%) powering up; ${tl} (${topLoser.changePct.toFixed(2)}%) dragging down — intraday flows skewed ${topGainer.changePct + topLoser.changePct >= 0 ? "positive" : "negative"}.`
    );
  }
  const trendChange = indices.filter((i) => i.reversalChance >= 55);
  if (trendChange.length) {
    lines.push(
      `Trend watch: ${trendChange.map((i) => `${i.label} (${i.reversalChance}%)`).join(", ")} showing reversal potential — divergence between price and breadth.`
    );
  } else {
    lines.push(`Trend watch: no major reversal signals across indices — current direction likely persists into close.`);
  }

  return { tone: overallTone, lines, indices, vixStatus, pcrStatus };
}

function statsFor(stocks: Quote[]) {
  const advance = stocks.filter((s) => s.changePct > 0).length;
  const decline = stocks.filter((s) => s.changePct < 0).length;
  const unchanged = stocks.length - advance - decline;
  const avgChange = stocks.reduce((a, s) => a + s.changePct, 0) / (stocks.length || 1);
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  return {
    stocks,
    advance,
    decline,
    unchanged,
    avgChange,
    gainers: sorted.filter((s) => s.changePct > 0).slice(0, 5),
    losers: sorted.filter((s) => s.changePct < 0).slice(-5).reverse(),
  };
}

// In-memory cache for getDashboard server functions to prevent broker API rate limits
const cache = new Map<string, { at: number; data: Quote[] }>();
const TTL_MS = 25000;

async function getQuotesCached(symbols: string[], bypassCache = false): Promise<Quote[]> {
  const key = [...symbols].sort().join(",");
  const hit = cache.get(key);
  if (!bypassCache && hit && Date.now() - hit.at < TTL_MS) return hit.data;
  
  const data = await marketDataLayer.getQuotes(symbols);
  cache.set(key, { at: Date.now(), data });
  return data;
}

export const dashboardService = {
  async getDashboardData(bypassCache = false) {
    const [indices, sectors, stocks, bankStocks, sensexStocks] = await Promise.all([
      getQuotesCached(INDICES, bypassCache),
      getQuotesCached(SECTORS.map((s) => s.symbol), bypassCache),
      getQuotesCached([...NIFTY_STOCKS], bypassCache),
      getQuotesCached([...BANKNIFTY_STOCKS], bypassCache),
      getQuotesCached([...SENSEX_STOCKS], bypassCache),
    ]);

    const indexMap = Object.fromEntries(indices.map((q) => [q.symbol, q]));
    const sectorList = sectors.map((q) => {
      const meta = SECTORS.find((s) => s.symbol === q.symbol);
      return { ...q, key: meta?.key ?? q.symbol, label: meta?.name ?? q.name };
    });

    const s = statsFor(stocks);
    const sortedSectors = [...sectorList].sort((a, b) => b.changePct - a.changePct);

    // Real per-index constituent breadth (bulls% = advances / directional).
    const bullsPctOf = (list: Quote[]) => {
      const adv = list.filter((q) => q.changePct > 0).length;
      const dec = list.filter((q) => q.changePct < 0).length;
      return (adv / Math.max(1, adv + dec)) * 100;
    };
    const bullsPct = bullsPctOf(stocks); // NIFTY-50 headline breadth
    const indexBreadth = {
      nifty: bullsPct,
      bank: bullsPctOf(bankStocks),
      sensex: bullsPctOf(sensexStocks),
    };
    const pcr = 0;

    const commentary = buildPulse({
      nifty: indexMap["^NSEI"],
      bank: indexMap["^NSEBANK"],
      sensex: indexMap["^BSESN"],
      vix: indexMap["^INDIAVIX"],
      bullsPct,
      indexBreadth,
      advance: s.advance,
      decline: s.decline,
      topSector: sortedSectors[0],
      bottomSector: sortedSectors[sortedSectors.length - 1],
      topGainer: s.gainers[0],
      topLoser: s.losers[0],
      pcr,
    });

    return {
      nifty: indexMap["^NSEI"] ?? null,
      sensex: indexMap["^BSESN"] ?? null,
      bankNifty: indexMap["^NSEBANK"] ?? null,
      vix: indexMap["^INDIAVIX"] ?? null,
      sectors: sectorList,
      ...s,
      commentary,
      updatedAt: Date.now(),
    };
  }
};
