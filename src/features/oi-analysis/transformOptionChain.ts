import type { OptionChain } from "@/lib/nse.functions";
import type { OISnapshot, StrikeOI } from "./types";

function legToStrikeOI(row: OptionChain["rows"][number]): StrikeOI {
  return {
    strike: row.strike,
    callTotalOI: row.ce?.oi ?? 0,
    putTotalOI: row.pe?.oi ?? 0,
    callOIChange: row.ce?.oiChg ?? 0,
    putOIChange: row.pe?.oiChg ?? 0,
    callVolume: row.ce?.volume,
    putVolume: row.pe?.volume,
    callIV: row.ce?.iv,
    putIV: row.pe?.iv,
  };
}

function findMaxPain(rows: OptionChain["rows"]): number {
  let minVal = Infinity;
  let maxPain = rows[0]?.strike ?? 0;
  for (const r of rows) {
    const ceVal = (r.ce?.oi ?? 0) * (r.ce?.ltp ?? 0);
    const peVal = (r.pe?.oi ?? 0) * (r.pe?.ltp ?? 0);
    const total = ceVal + peVal;
    if (total < minVal) {
      minVal = total;
      maxPain = r.strike;
    }
  }
  return maxPain;
}

export function transformOptionChainToSnapshot(oc: OptionChain): OISnapshot {
  const totalCeOi = oc.rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0);
  const totalPeOi = oc.rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0);
  const totalCeOiChg = oc.rows.reduce((a, r) => a + (r.ce?.oiChg ?? 0), 0);
  const totalPeOiChg = oc.rows.reduce((a, r) => a + (r.pe?.oiChg ?? 0), 0);

  const pcr = totalCeOi > 0 ? totalPeOi / totalCeOi : 0;

  const prevCeOi = totalCeOi - totalCeOiChg;
  const prevPeOi = totalPeOi - totalPeOiChg;
  const prevPcr = prevCeOi > 0 ? prevPeOi / prevCeOi : 0;
  const pcrChange = prevPcr > 0 ? pcr - prevPcr : 0;

  const sorted = [...oc.rows].sort((a, b) => a.strike - b.strike);
  const atmRow = sorted.reduce((prev, curr) =>
    Math.abs(curr.strike - oc.spot) < Math.abs(prev.strike - oc.spot) ? curr : prev
  );

  const maxPain = findMaxPain(oc.rows);

  return {
    symbol: oc.symbol,
    spot: oc.spot,
    atmStrike: atmRow.strike,
    maxPain,
    pcr,
    pcrChange,
    pcrOIChange: 0,
    totalCallOI: totalCeOi,
    totalPutOI: totalPeOi,
    totalCallOIChange: totalCeOiChg,
    totalPutOIChange: totalPeOiChg,
    strikes: oc.rows.map(legToStrikeOI),
    lastUpdated: new Date(oc.updatedAt).toISOString(),
  };
}
