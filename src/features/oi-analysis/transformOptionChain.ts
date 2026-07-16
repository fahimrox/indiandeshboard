import type { OptionChain } from "@/lib/nse.functions";
import type { OISnapshot, StrikeOI } from "./types";

// Historical data types matching the backend response
interface HistoricalOptionSnapshot {
  timestamp: number;
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  spot_price: number;
  pcr: number;
  max_pain: number;
  atm_strike: number;
  total_ce_oi: number;
  total_pe_oi: number;
  total_ce_oi_chg: number;
  total_pe_oi_chg: number;
  total_ce_vol: number;
  total_pe_vol: number;
}

interface HistoricalOiActivityRow {
  trading_date: string;
  trading_time: string;
  symbol: string;
  expiry: string;
  strike: number;
  ce_oi: number;
  ce_oi_chg: number;
  ce_vol: number;
  pe_oi: number;
  pe_oi_chg: number;
  pe_vol: number;
}

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

/**
 * Calculate Max Pain strike using proper intrinsic value calculation.
 * Max Pain is the strike where option writers (sellers) experience minimum loss,
 * i.e., the strike where total payout to option holders is minimized.
 *
 * For each candidate settlement strike:
 * - Call holders profit: max(settlement - callStrike, 0) * callOI
 * - Put holders profit: max(putStrike - settlement, 0) * putOI
 *
 * The strike with minimum total payout is the Max Pain point.
 */
function findMaxPain(rows: OptionChain["rows"]): number {
  if (!rows.length) return 0;

  // Get all unique strikes as potential settlement points
  const strikes = rows
    .map((r) => r.strike)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (!strikes.length) return rows[0]?.strike ?? 0;

  let minPain = Infinity;
  let maxPainStrike = strikes[0];

  for (const settlementStrike of strikes) {
    let totalPayout = 0;

    for (const row of rows) {
      const strike = row.strike;

      // Call intrinsic value at this settlement
      if (strike < settlementStrike) {
        const callIntrinsic = settlementStrike - strike;
        totalPayout += callIntrinsic * (row.ce?.oi ?? 0);
      }

      // Put intrinsic value at this settlement
      if (strike > settlementStrike) {
        const putIntrinsic = strike - settlementStrike;
        totalPayout += putIntrinsic * (row.pe?.oi ?? 0);
      }
    }

    if (totalPayout < minPain) {
      minPain = totalPayout;
      maxPainStrike = settlementStrike;
    }
  }

  return maxPainStrike;
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
  const pcrOIChange = pcr; // PCR based on current OI (same as pcr for now, can be refined)

  const sorted = [...oc.rows].sort((a, b) => a.strike - b.strike);
  const atmRow = sorted.reduce((prev, curr) =>
    Math.abs(curr.strike - oc.spot) < Math.abs(prev.strike - oc.spot) ? curr : prev,
  );

  const maxPain = findMaxPain(oc.rows);

  return {
    symbol: oc.symbol,
    spot: oc.spot,
    atmStrike: atmRow.strike,
    maxPain,
    pcr,
    pcrChange,
    pcrOIChange: pcrOIChange,
    totalCallOI: totalCeOi,
    totalPutOI: totalPeOi,
    totalCallOIChange: totalCeOiChg,
    totalPutOIChange: totalPeOiChg,
    strikes: oc.rows.map(legToStrikeOI),
    lastUpdated: new Date(oc.updatedAt).toISOString(),
  };
}

/**
 * Transform historical option snapshot + OI activity into OISnapshot format.
 * Uses real saved data from database, never synthetic/interpolated.
 *
 * @param snapshot - Parent snapshot with aggregated totals
 * @param activityRows - Strike-level OI detail rows
 * @param comparisonSnapshot - Optional earlier snapshot for PCR change calculation
 */
export function transformHistoricalToSnapshot(
  snapshot: HistoricalOptionSnapshot,
  activityRows: HistoricalOiActivityRow[],
  comparisonSnapshot?: HistoricalOptionSnapshot,
): OISnapshot {
  // Build strike-level data from activity rows
  const strikes: StrikeOI[] = activityRows.map((row) => ({
    strike: row.strike,
    callTotalOI: row.ce_oi,
    putTotalOI: row.pe_oi,
    callOIChange: row.ce_oi_chg,
    putOIChange: row.pe_oi_chg,
    callVolume: row.ce_vol,
    putVolume: row.pe_vol,
    callIV: undefined,
    putIV: undefined,
  }));

  // Calculate PCR change from real comparison snapshot if available
  let pcrChange = 0;
  if (comparisonSnapshot && comparisonSnapshot.total_ce_oi > 0) {
    const prevPcr = comparisonSnapshot.total_pe_oi / comparisonSnapshot.total_ce_oi;
    pcrChange = snapshot.pcr - prevPcr;
  }

  // Build ISO timestamp from trading_date and trading_time
  const lastUpdated = `${snapshot.trading_date}T${snapshot.trading_time}+05:30`;

  return {
    symbol: snapshot.symbol,
    spot: snapshot.spot_price,
    atmStrike: snapshot.atm_strike,
    maxPain: snapshot.max_pain,
    pcr: snapshot.pcr,
    pcrChange,
    pcrOIChange: snapshot.pcr,
    totalCallOI: snapshot.total_ce_oi,
    totalPutOI: snapshot.total_pe_oi,
    totalCallOIChange: snapshot.total_ce_oi_chg,
    totalPutOIChange: snapshot.total_pe_oi_chg,
    strikes,
    lastUpdated,
  };
}

/**
 * Select two snapshots from historical array for comparison.
 *
 * @param snapshots - Array of historical snapshots (should be sorted by time)
 * @param fromTs - Start of window (epoch ms), null = start of day
 * @param toTs - End of window (epoch ms), null = end of day / now
 * @returns [currentSnapshot, comparisonSnapshot | undefined]
 *
 * Current = latest snapshot <= toTs
 * Comparison = latest snapshot <= fromTs (for OI change calculation)
 */
export function selectHistoricalSnapshots(
  snapshots: HistoricalOptionSnapshot[],
  fromTs: number | null,
  toTs: number | null,
): [HistoricalOptionSnapshot | null, HistoricalOptionSnapshot | null] {
  if (!snapshots.length) return [null, null];

  // Sort by timestamp ascending
  const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

  // Find current snapshot (latest <= toTs, or simply the latest if toTs is null)
  let current: HistoricalOptionSnapshot | null = null;
  if (toTs === null) {
    current = sorted[sorted.length - 1];
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].timestamp <= toTs) {
        current = sorted[i];
        break;
      }
    }
  }

  if (!current) return [null, null];

  // Find comparison snapshot (latest <= fromTs)
  let comparison: HistoricalOptionSnapshot | null = null;
  if (fromTs !== null) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].timestamp <= fromTs && sorted[i].timestamp < current.timestamp) {
        comparison = sorted[i];
        break;
      }
    }
  }

  return [current, comparison];
}
