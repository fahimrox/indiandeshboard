import { getFyersConfig, markFyersExpired, getFyersClientId } from "./configStore";
import type { OptionChain, OcRow, OcLeg, OcSignal } from "../nse.functions";

const FYERS_INDEX_MAP: Record<string, string> = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

function formatExpiry(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  
  let year = "";
  let monthStr = "";
  let day = "";
  
  if (parts[0].length === 4) {
    // YYYY-MM-DD
    year = parts[0];
    monthStr = parts[1];
    day = parts[2];
  } else {
    // DD-MM-YYYY
    day = parts[0];
    monthStr = parts[1];
    year = parts[2];
  }
  
  const monthIdx = parseInt(monthStr, 10) - 1;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[monthIdx] || monthStr;
  return `${day.padStart(2, "0")}-${month}-${year}`; // "24-Oct-2024"
}

function parseExpiry(dateStr: string): string {
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const day = parts[0].padStart(2, "0");
  const month = months[parts[1].toLowerCase()] || "01";
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

export const fyersService = {
  async getOptionChain(
    symbol: string,
    spotPrice: number,
    targetExpiry?: string
  ): Promise<OptionChain> {
    const fyersSymbol = FYERS_INDEX_MAP[symbol] || symbol;
    const config = await getFyersConfig();
    const token = config.accessToken;

    if (!token) {
      throw new Error("FYERS manual access token is missing. Please configure it in Settings.");
    }

    // Fyers options-chain-v3 requires a GET request
    // e.g. https://api-t1.fyers.in/data/options-chain-v3?symbol=NSE:NIFTY50-INDEX&strikecount=30
    const url = `https://api-t1.fyers.in/data/options-chain-v3?symbol=${encodeURIComponent(
      fyersSymbol
    )}&strikecount=30`;

    const clientId = await getFyersClientId();

    const fetchFyers = async (requestUrl: string) => {
      const res = await fetch(requestUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `${clientId}:${token}`,
        },
      });

      if (res.status === 401) {
        await markFyersExpired("Unauthorized (401) - Token may be expired");
        throw new Error("FYERS Access Token is invalid or expired.");
      }

      const json = await res.json();
      if (json.s === "error" || json.code === 401) {
        const msg = json.message || "Token error";
        await markFyersExpired(msg);
        throw new Error(`FYERS API error: ${msg}`);
      }
      return json;
    };

    // First fetch to get expiries and initial chain
    const json = await fetchFyers(url);
    const expiryData = json.data?.expiryData || [];
    if (expiryData.length === 0) {
      throw new Error("Fyers returned no expiry data.");
    }

    const expiriesFormatted = expiryData.map((x: any) => formatExpiry(x.date));

    // Determine target expiry
    let chosenExpiryItem = expiryData[0];
    if (targetExpiry) {
      const formattedTarget = formatExpiry(targetExpiry);
      const found = expiryData.find((x: any) => formatExpiry(x.date) === formattedTarget);
      if (found) {
        chosenExpiryItem = found;
      }
    }

    // If target expiry is not the default near expiry, we need to fetch again with timestamp
    let finalJson = json;
    if (chosenExpiryItem && chosenExpiryItem.expiry !== expiryData[0]?.expiry) {
      finalJson = await fetchFyers(`${url}&timestamp=${chosenExpiryItem.expiry}`);
    }

    const rawChain = (finalJson.data?.optionsChain || []).filter(
      (x: any) => x.option_type === "CE" || x.option_type === "PE"
    );

    if (rawChain.length === 0) {
      throw new Error("Fyers returned an empty option chain.");
    }

    const filteredContracts = rawChain;


    // Group by strike price
    const strikeGroups = new Map<number, { ce?: any; pe?: any }>();
    for (const contract of filteredContracts) {
      const strike = contract.strikePrice || contract.strike_price;
      const type = (contract.optionType || contract.option_type || "").toUpperCase();
      
      if (!strikeGroups.has(strike)) {
        strikeGroups.set(strike, {});
      }
      
      const group = strikeGroups.get(strike)!;
      if (type === "CE") group.ce = contract;
      if (type === "PE") group.pe = contract;
    }

    const rows: OcRow[] = [];
    for (const [strike, group] of strikeGroups.entries()) {
      const buildLegLocal = (side: "ce" | "pe", contract: any): OcLeg => {
        if (!contract) return null;
        const oi = contract.oi || 0;
        const oiChg = contract.oich || contract.oi_change || 0;
        const prevOi = oi - oiChg;
        const oiChgPct = prevOi > 0 ? (oiChg / prevOi) * 100 : 0;
        const volume = contract.totalTradedVolume || contract.volume || 0;
        const ltp = contract.ltp || 0;
        const iv = contract.impliedVolatility || contract.iv || 0;

        const classifyOcSignalLocal = (oiChgPct: number): OcSignal => {
          const m = Math.abs(oiChgPct);
          if (m < 1.5) return "Neutral";
          const strong = m >= 15;
          if (side === "ce") {
            return oiChgPct > 0
              ? strong ? "Strong Short Buildup" : "Weak Short Buildup"
              : strong ? "Strong Short Cover" : "Weak Short Cover";
          } else {
            return oiChgPct > 0
              ? strong ? "Strong Short Buildup" : "Weak Short Buildup"
              : strong ? "Strong Short Cover" : "Weak Short Cover";
          }
        };

        return {
          oi,
          oiChg,
          oiChgPct,
          volume,
          ltp,
          iv,
          signal: classifyOcSignalLocal(oiChgPct),
        };
      };

      const ce = buildLegLocal("ce", group.ce);
      const pe = buildLegLocal("pe", group.pe);

      rows.push({
        strike,
        ce,
        pe,
        straddle: (ce?.ltp ?? 0) + (pe?.ltp ?? 0),
        pcr: ce && ce.oi ? (pe?.oi ?? 0) / ce.oi : 0,
      });
    }

    rows.sort((a, b) => a.strike - b.strike);

    const ceOis = rows.map((r) => ({ s: r.strike, v: r.ce?.oi ?? 0 })).sort((a, b) => b.v - a.v);
    const peOis = rows.map((r) => ({ s: r.strike, v: r.pe?.oi ?? 0 })).sort((a, b) => b.v - a.v);
    const ceVols = rows.map((r) => ({ s: r.strike, v: r.ce?.volume ?? 0 })).sort((a, b) => b.v - a.v);
    const peVols = rows.map((r) => ({ s: r.strike, v: r.pe?.volume ?? 0 })).sort((a, b) => b.v - a.v);
    const ceOiShift = rows.map((r) => ({ s: r.strike, v: r.ce?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);
    const peOiShift = rows.map((r) => ({ s: r.strike, v: r.pe?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);

    const totals = {
      ceOi: rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0),
      peOi: rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0),
      ceOiChg: rows.reduce((a, r) => a + (r.ce?.oiChg ?? 0), 0),
      peOiChg: rows.reduce((a, r) => a + (r.pe?.oiChg ?? 0), 0),
      ceVol: rows.reduce((a, r) => a + (r.ce?.volume ?? 0), 0),
      peVol: rows.reduce((a, r) => a + (r.pe?.volume ?? 0), 0),
    };

    const r1 = ceOis[0]?.s ?? 0;
    const r2 = ceOiShift[0]?.s ?? 0;
    const s1 = peOis[0]?.s ?? 0;
    const s2 = peOiShift[0]?.s ?? 0;

    const levels = [
      { strike: r1, kind: "R1" as const, basis: "oi" as const },
      { strike: r2 && r2 !== r1 ? r2 : (ceOis[1]?.s ?? r1), kind: "R2" as const, basis: "oiShift" as const },
      { strike: s1, kind: "S1" as const, basis: "oi" as const },
      { strike: s2 && s2 !== s1 ? s2 : (peOis[1]?.s ?? s1), kind: "S2" as const, basis: "oiShift" as const },
    ];

    // Find the 21 rows closest to spot price
    const spot = spotPrice || json.data?.otherData?.indexValue || 0;
    const idx = rows.findIndex((r) => r.strike >= spot);
    const start = Math.max(0, idx - 10);
    const slice = rows.slice(start, start + 21);

    return {
      symbol,
      spot,
      expiry: formatExpiry(chosenExpiryItem?.date),
      expiries: expiriesFormatted,
      rows: slice,
      maxCeOiStrike: r1,
      maxPeOiStrike: s1,
      maxCeVolStrike: ceVols[0]?.s ?? 0,
      maxPeVolStrike: peVols[0]?.s ?? 0,
      second: {
        ceOi: ceOis[1]?.s ?? 0,
        peOi: peOis[1]?.s ?? 0,
        ceVol: ceVols[1]?.s ?? 0,
        peVol: peVols[1]?.s ?? 0,
      },
      totals,
      levels,
      source: "fyers",
      updatedAt: Date.now(),
    };
  },
};
