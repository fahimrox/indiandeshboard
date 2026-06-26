export interface OIDataPoint {
  strike: number;
  callOI: number;
  callOIIncrease: number;
  callOIDecrease: number;
  putOI: number;
  putOIIncrease: number;
  putOIDecrease: number;
}

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function generateMockOIData(
  strikeCount: number,
  index: "NIFTY" | "BANKNIFTY" | "MIDCPNIFTY" | "SENSEX"
): OIDataPoint[] {
  const spots = {
    NIFTY: 24050,
    BANKNIFTY: 51200,
    MIDCPNIFTY: 11200,
    SENSEX: 79800,
  };

  const spot = spots[index];
  const strikeInterval = index === "NIFTY" ? 50 : index === "BANKNIFTY" ? 100 : 50;
  const half = Math.floor(strikeCount / 2);
  const baseStrike = Math.round((spot - half * strikeInterval) / strikeInterval) * strikeInterval;

  const seed = strikeCount * 1000 + spot;
  const rand = seededRandom(seed);

  const data: OIDataPoint[] = [];

  for (let i = 0; i < strikeCount; i++) {
    const strike = baseStrike + i * strikeInterval;
    const distanceFromSpot = (strike - spot) / strikeInterval;

    // Bell curve for OI distribution
    const callFactor = Math.exp(-Math.pow((distanceFromSpot + 0.5) / 4, 2));
    const putFactor = Math.exp(-Math.pow((distanceFromSpot - 0.5) / 4, 2));

    const scale = index === "BANKNIFTY" ? 3 : index === "SENSEX" ? 4 : index === "MIDCPNIFTY" ? 0.7 : 1;

    const baseCallOI = (800000 + rand() * 400000) * (1 + callFactor * 2) * scale;
    const basePutOI = (700000 + rand() * 350000) * (1 + putFactor * 2) * scale;

    const callOI = Math.round(baseCallOI);
    const putOI = Math.round(basePutOI);

    // OI changes (increase/decrease)
    const callOIIncrease = Math.round((rand() * 0.15 * baseCallOI));
    const callOIDecrease = Math.round((rand() * 0.08 * baseCallOI));
    const putOIIncrease = Math.round((rand() * 0.12 * basePutOI));
    const putOIDecrease = Math.round((rand() * 0.10 * basePutOI));

    data.push({
      strike,
      callOI,
      callOIIncrease,
      callOIDecrease,
      putOI,
      putOIIncrease,
      putOIDecrease,
    });
  }

  return data;
}
