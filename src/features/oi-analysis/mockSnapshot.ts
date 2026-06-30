import type { OISnapshot, StrikeOI, IndexSymbol } from "./types";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const SPOTS: Record<IndexSymbol, number> = {
  NIFTY: 24050,
  BANKNIFTY: 51200,
  MIDCPNIFTY: 11200,
  SENSEX: 79800,
};

const INTERVALS: Record<IndexSymbol, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  MIDCPNIFTY: 50,
  SENSEX: 50,
};

const SCALES: Record<IndexSymbol, number> = {
  NIFTY: 1,
  BANKNIFTY: 3,
  MIDCPNIFTY: 0.7,
  SENSEX: 4,
};

const EXPIRIES: Record<IndexSymbol, string[]> = {
  NIFTY: ["26-Jun-2026", "03-Jul-2026", "10-Jul-2026"],
  BANKNIFTY: ["26-Jun-2026", "03-Jul-2026", "10-Jul-2026"],
  MIDCPNIFTY: ["26-Jun-2026", "03-Jul-2026", "10-Jul-2026"],
  SENSEX: ["26-Jun-2026", "03-Jul-2026", "10-Jul-2026"],
};

// Stable mock timestamp — one per symbol, never calls new Date() on render.
// Format: a fixed market-hours timestamp (10:00 AM IST on a deterministic day) seeded from symbol.
const MOCK_TIMESTAMPS: Record<IndexSymbol, string> = {
  NIFTY:      "2026-06-30T04:30:00.000Z", // 10:00 IST
  BANKNIFTY:  "2026-06-30T04:35:00.000Z",
  MIDCPNIFTY: "2026-06-30T04:40:00.000Z",
  SENSEX:     "2026-06-30T04:45:00.000Z",
};

export function generateMockSnapshot(
  symbol: IndexSymbol = "NIFTY"
): OISnapshot {
  const spot = SPOTS[symbol];
  const strikeInterval = INTERVALS[symbol];
  const scale = SCALES[symbol];
  const seed = symbol.length + spot;
  const rand = seededRandom(seed);

  const half = 15;
  const baseStrike = Math.round((spot - half * strikeInterval) / strikeInterval) * strikeInterval;
  const strikeCount = 31;

  let totalCallOI = 0;
  let totalPutOI = 0;
  let totalCallOIChange = 0;
  let totalPutOIChange = 0;

  const strikes: StrikeOI[] = [];

  for (let i = 0; i < strikeCount; i++) {
    const strike = baseStrike + i * strikeInterval;
    const distanceFromSpot = (strike - spot) / strikeInterval;

    const callFactor = Math.exp(-Math.pow((distanceFromSpot + 1.5) / 5, 2));
    const putFactor = Math.exp(-Math.pow((distanceFromSpot - 1.5) / 5, 2));

    const baseCallOI = (800000 + rand() * 400000) * (1 + callFactor * 2.5) * scale;
    const basePutOI = (700000 + rand() * 350000) * (1 + putFactor * 2.5) * scale;

    const callTotalOI_val = Math.round(baseCallOI);
    const putTotalOI_val = Math.round(basePutOI);

    const callOIChange = Math.round(
      (rand() * 0.2 - 0.05) * callTotalOI_val
    );
    const putOIChange = Math.round(
      (rand() * 0.18 - 0.04) * putTotalOI_val
    );

    totalCallOI += callTotalOI_val;
    totalPutOI += putTotalOI_val;
    totalCallOIChange += callOIChange;
    totalPutOIChange += putOIChange;

    strikes.push({
      strike,
      callTotalOI: callTotalOI_val,
      putTotalOI: putTotalOI_val,
      callOIChange,
      putOIChange,
    });
  }

  const pcr = totalPutOI / totalCallOI;

  return {
    symbol,
    spot,
    atmStrike: spot,
    maxPain: spot + 50,
    pcr,
    pcrChange: -0.06,
    pcrOIChange: 0.57,
    totalCallOI,
    totalPutOI,
    totalCallOIChange,
    totalPutOIChange,
    strikes,
    // Use a stable deterministic timestamp — never call new Date() here.
    // Calling new Date() would produce a new string every render → breaks useMemo stability.
    lastUpdated: MOCK_TIMESTAMPS[symbol],
  };
}

export function getExpiries(symbol: IndexSymbol): string[] {
  return EXPIRIES[symbol];
}
