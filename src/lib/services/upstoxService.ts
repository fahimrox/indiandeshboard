import fs from "node:fs/promises";
import path from "node:path";
import type { Quote } from "../market.functions";
import type {
  OptionChain,
  OcLeg,
  OcRow,
  OcSignal,
  SrLevel,
} from "../nse.functions";

const CACHE_FILE = path.join(process.cwd(), "upstox_instruments.json");

const STATIC_INDEX_MAP: Record<string, string> = {
  "^NSEI": "NSE_INDEX|Nifty 50",
  "^BSESN": "BSE_INDEX|SENSEX",
  "^NSEBANK": "NSE_INDEX|Nifty Bank",
  "^INDIAVIX": "NSE_INDEX|India VIX",
  "^CNXIT": "NSE_INDEX|Nifty IT",
  "^CNXPHARMA": "NSE_INDEX|Nifty Pharma",
  "^CNXAUTO": "NSE_INDEX|Nifty Auto",
  "^CNXENERGY": "NSE_INDEX|Nifty Energy",
  "^CNXFMCG": "NSE_INDEX|Nifty FMCG",
  "^CNXMETAL": "NSE_INDEX|Nifty Metal",
  "^CNXREALTY": "NSE_INDEX|Nifty Realty",
  "^CNXMEDIA": "NSE_INDEX|Nifty Media",
  "^CNXPSUBANK": "NSE_INDEX|Nifty PSU Bank",
  "NIFTY_FIN_SERVICE.NS": "NSE_INDEX|Nifty Fin Service",
  "^CNXINFRA": "NSE_INDEX|Nifty Infra",
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX: "BSE_INDEX|SENSEX",
};

type UpstoxOptionContract = {
  expiry?: string;
};

type UpstoxOptionMarketData = {
  ltp?: number;
  volume?: number;
  oi?: number;
  prev_oi?: number;
};

type UpstoxOptionGreeks = {
  iv?: number;
};

type UpstoxOptionSide = {
  instrument_key?: string;
  market_data?: UpstoxOptionMarketData;
  option_greeks?: UpstoxOptionGreeks;
};

type UpstoxOptionChainItem = {
  expiry?: string;
  pcr?: number;
  strike_price?: number;
  underlying_key?: string;
  underlying_spot_price?: number;
  call_options?: UpstoxOptionSide;
  put_options?: UpstoxOptionSide;
};

type UpstoxApiResponse<T> = {
  status?: string;
  data?: T;
  errors?: Array<{
    errorCode?: string;
    message?: string;
  }>;
  message?: string;
};

let symbolToKeyMap = new Map<string, string>();
let initializing = false;
let initialized = false;

function getToken(): string {
  const token = process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) {
    throw new Error("Upstox Access Token is missing in environment");
  }
  return token;
}

function formatExpiry(dateStr: string): string {
  if (!dateStr) return "";

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;

  const [, year, month, day] = match;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const monthName = months[Number(month) - 1];
  return monthName ? `${day}-${monthName}-${year}` : dateStr;
}

function parseExpiry(dateStr: string): string {
  if (!dateStr) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(dateStr);
  if (!match) return dateStr;

  const [, day, monthName, year] = match;
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  const month = months[monthName.toLowerCase()];
  return month ? `${year}-${month}-${day.padStart(2, "0")}` : dateStr;
}

function classifyOcSignal(oiChgPct: number): OcSignal {
  const magnitude = Math.abs(oiChgPct);

  if (magnitude < 1.5) return "Neutral";

  const strong = magnitude >= 15;

  if (oiChgPct > 0) {
    return strong ? "Strong Short Buildup" : "Weak Short Buildup";
  }

  return strong ? "Strong Short Cover" : "Weak Short Cover";
}

function buildLeg(side?: UpstoxOptionSide): OcLeg {
  if (!side) return null;

  const marketData = side.market_data;
  if (!marketData) return null;

  const oi = Number(marketData.oi) || 0;
  const prevOi = Number(marketData.prev_oi) || 0;
  const oiChg = oi - prevOi;
  const oiChgPct = prevOi > 0 ? (oiChg / prevOi) * 100 : 0;

  return {
    oi,
    oiChg,
    oiChgPct,
    volume: Number(marketData.volume) || 0,
    ltp: Number(marketData.ltp) || 0,
    iv: Number(side.option_greeks?.iv) || 0,
    signal: classifyOcSignal(oiChgPct),
  };
}

function rankRows(
  rows: OcRow[],
  selector: (row: OcRow) => number
): Array<{ strike: number; value: number }> {
  return rows
    .map((row) => ({
      strike: row.strike,
      value: selector(row),
    }))
    .sort((a, b) => b.value - a.value);
}

async function fetchUpstox<T>(
  pathname: string,
  params: Record<string, string>
): Promise<T> {
  const token = getToken();
  const query = new URLSearchParams(params);
  const url = `https://api.upstox.com/v2${pathname}?${query.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  let json: UpstoxApiResponse<T>;

  try {
    json = (await response.json()) as UpstoxApiResponse<T>;
  } catch {
    throw new Error(
      `Upstox API returned an invalid response with status ${response.status}`
    );
  }

  if (!response.ok || json.status !== "success" || json.data == null) {
    const apiMessage =
      json.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
      json.message ||
      `HTTP ${response.status}`;

    throw new Error(`Upstox API failed: ${apiMessage}`);
  }

  return json.data;
}

async function initInstruments(): Promise<void> {
  if (initialized || initializing) return;

  initializing = true;

  try {
    try {
      const data = await fs.readFile(CACHE_FILE, "utf-8");
      const parsed = JSON.parse(data) as Record<string, string>;
      symbolToKeyMap = new Map(Object.entries(parsed));
      initialized = true;
      return;
    } catch {
      // Local cache not found, proceed to download.
    }

    console.log("Downloading Upstox instrument master (assets URL)...");

    const response = await fetch(
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    );

    if (!response.ok) {
      throw new Error(
        `Upstox instruments assets status: ${response.status}`
      );
    }

    const buffer = await response.arrayBuffer();
    const zlib = await import("node:zlib");
    const decompressed = zlib
      .gunzipSync(Buffer.from(buffer))
      .toString("utf-8");

    const data = JSON.parse(decompressed) as Array<{
      segment?: string;
      trading_symbol?: string;
      instrument_key?: string;
    }>;

    const tempMap: Record<string, string> = {};

    for (const item of data) {
      if (
        item.segment === "NSE_EQ" &&
        item.trading_symbol &&
        item.instrument_key
      ) {
        symbolToKeyMap.set(item.trading_symbol, item.instrument_key);
        tempMap[item.trading_symbol] = item.instrument_key;
      }
    }

    await fs.writeFile(CACHE_FILE, JSON.stringify(tempMap), "utf-8");
    initialized = true;
  } catch (error) {
    console.error("Failed to initialize Upstox instruments:", error);
  } finally {
    initializing = false;
  }
}

export async function getUpstoxKey(
  symbol: string
): Promise<string | null> {
  const clean = symbol.replace(".NS", "").replace(".BO", "").trim();

  if (STATIC_INDEX_MAP[symbol]) return STATIC_INDEX_MAP[symbol];
  if (STATIC_INDEX_MAP[clean]) return STATIC_INDEX_MAP[clean];

  if (!initialized) {
    await initInstruments();
  }

  return symbolToKeyMap.get(clean) || null;
}

export const upstoxService = {
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const token = getToken();

    const resolvedKeys: string[] = [];
    const symbolMap: Record<string, string> = {};

    for (const symbol of symbols) {
      const key = await getUpstoxKey(symbol);

      if (key) {
        resolvedKeys.push(key);
        symbolMap[key] = symbol;

        const segment = key.split("|")[0];
        const cleanSymbol = symbol
          .replace(".NS", "")
          .replace(".BO", "")
          .trim();

        symbolMap[`${segment}|${cleanSymbol}`] = symbol;
      }
    }

    if (resolvedKeys.length === 0) return [];

    const url =
      "https://api.upstox.com/v2/market-quote/quotes" +
      `?instrument_key=${encodeURIComponent(resolvedKeys.join(","))}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Upstox Quotes API failed: status ${response.status}`
      );
    }

    const json = (await response.json()) as {
      status: string;
      data: Record<
        string,
        {
          last_price: number;
          net_change?: number;
          volume: number;
          ohlc: {
            open: number;
            high: number;
            low: number;
            close: number;
          };
          instrument_token: string;
        }
      >;
    };

    if (json.status !== "success" || !json.data) {
      throw new Error("Upstox Quotes API returned unsuccessful status");
    }

    const quotes: Quote[] = [];

    for (const [key, item] of Object.entries(json.data)) {
      const normalizedKey = key.replace(":", "|");
      const originalSymbol =
        symbolMap[normalizedKey] || symbolMap[key] || key;

      const price = item.last_price || 0;
      const change =
        typeof item.net_change === "number"
          ? item.net_change
          : item.ohlc?.close
            ? price - item.ohlc.close
            : 0;

      const prevClose = price - change;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;

      quotes.push({
        symbol: originalSymbol,
        name: originalSymbol.replace(".NS", "").replace(".BO", ""),
        price,
        prevClose,
        change,
        changePct,
        dayHigh: item.ohlc?.high || price,
        dayLow: item.ohlc?.low || price,
        open: item.ohlc?.open || price,
        marketState: "LIVE",
        currency: "INR",
        exchange: key.startsWith("BSE") ? "BSE" : "NSE",
      });
    }

    return quotes;
  },

  async getOptionChain(
    symbol: string,
    spotPrice?: number,
    targetExpiry?: string
  ): Promise<OptionChain> {
    const underlyingKey = await getUpstoxKey(symbol);

    if (!underlyingKey) {
      throw new Error(
        `Upstox underlying instrument key not found for ${symbol}`
      );
    }

    const contracts = await fetchUpstox<UpstoxOptionContract[]>(
      "/option/contract",
      { instrument_key: underlyingKey }
    );

    const expiryDates = [
      ...new Set(
        contracts
          .map((contract) => contract.expiry)
          .filter((expiry): expiry is string => Boolean(expiry))
      ),
    ].sort((a, b) => a.localeCompare(b));

    if (expiryDates.length === 0) {
      throw new Error(
        `Upstox returned no active option expiries for ${symbol}`
      );
    }

    const requestedExpiry = targetExpiry
      ? parseExpiry(targetExpiry)
      : "";

    const chosenExpiry =
      requestedExpiry && expiryDates.includes(requestedExpiry)
        ? requestedExpiry
        : expiryDates[0];

    const rawChain = await fetchUpstox<UpstoxOptionChainItem[]>(
      "/option/chain",
      {
        instrument_key: underlyingKey,
        expiry_date: chosenExpiry,
      }
    );

    if (!Array.isArray(rawChain) || rawChain.length === 0) {
      throw new Error(
        `Upstox returned an empty option chain for ${symbol}`
      );
    }

    const rows: OcRow[] = rawChain
      .map((item): OcRow | null => {
        const strike = Number(item.strike_price);

        if (!Number.isFinite(strike) || strike <= 0) {
          return null;
        }

        const ce = buildLeg(item.call_options);
        const pe = buildLeg(item.put_options);

        return {
          strike,
          ce,
          pe,
          straddle: (ce?.ltp ?? 0) + (pe?.ltp ?? 0),
          pcr:
            ce && ce.oi > 0
              ? (pe?.oi ?? 0) / ce.oi
              : Number(item.pcr) || 0,
        };
      })
      .filter((row): row is OcRow => row !== null)
      .sort((a, b) => a.strike - b.strike);

    if (rows.length === 0) {
      throw new Error(
        `Upstox option chain had no valid strikes for ${symbol}`
      );
    }

    const ceOis = rankRows(rows, (row) => row.ce?.oi ?? 0);
    const peOis = rankRows(rows, (row) => row.pe?.oi ?? 0);
    const ceVolumes = rankRows(rows, (row) => row.ce?.volume ?? 0);
    const peVolumes = rankRows(rows, (row) => row.pe?.volume ?? 0);
    const ceOiChanges = rankRows(rows, (row) => row.ce?.oiChg ?? 0);
    const peOiChanges = rankRows(rows, (row) => row.pe?.oiChg ?? 0);

    const maxCeOiStrike = ceOis[0]?.strike ?? 0;
    const maxPeOiStrike = peOis[0]?.strike ?? 0;

    const resistanceShift =
      ceOiChanges[0]?.strike &&
      ceOiChanges[0].strike !== maxCeOiStrike
        ? ceOiChanges[0].strike
        : ceOis[1]?.strike ?? maxCeOiStrike;

    const supportShift =
      peOiChanges[0]?.strike &&
      peOiChanges[0].strike !== maxPeOiStrike
        ? peOiChanges[0].strike
        : peOis[1]?.strike ?? maxPeOiStrike;

    const levels: SrLevel[] = [
      {
        strike: maxCeOiStrike,
        kind: "R1",
        basis: "oi",
      },
      {
        strike: resistanceShift,
        kind: "R2",
        basis: "oiShift",
      },
      {
        strike: maxPeOiStrike,
        kind: "S1",
        basis: "oi",
      },
      {
        strike: supportShift,
        kind: "S2",
        basis: "oiShift",
      },
    ];

    const totals = {
      ceOi: rows.reduce(
        (total, row) => total + (row.ce?.oi ?? 0),
        0
      ),
      peOi: rows.reduce(
        (total, row) => total + (row.pe?.oi ?? 0),
        0
      ),
      ceOiChg: rows.reduce(
        (total, row) => total + (row.ce?.oiChg ?? 0),
        0
      ),
      peOiChg: rows.reduce(
        (total, row) => total + (row.pe?.oiChg ?? 0),
        0
      ),
      ceVol: rows.reduce(
        (total, row) => total + (row.ce?.volume ?? 0),
        0
      ),
      peVol: rows.reduce(
        (total, row) => total + (row.pe?.volume ?? 0),
        0
      ),
    };

    const responseSpot =
      rawChain.find(
        (item) =>
          Number.isFinite(Number(item.underlying_spot_price)) &&
          Number(item.underlying_spot_price) > 0
      )?.underlying_spot_price ?? 0;

    const finalSpot = Number(responseSpot) || Number(spotPrice) || 0;

    const firstAtOrAboveSpot = rows.findIndex(
      (row) => row.strike >= finalSpot
    );

    const centerIndex =
      firstAtOrAboveSpot >= 0
        ? firstAtOrAboveSpot
        : Math.floor(rows.length / 2);

    const sliceStart = Math.max(
      0,
      Math.min(centerIndex - 10, Math.max(0, rows.length - 21))
    );

    return {
      symbol,
      spot: finalSpot,
      expiry: formatExpiry(chosenExpiry),
      expiries: expiryDates.map(formatExpiry),
      rows: rows.slice(sliceStart, sliceStart + 21),
      maxCeOiStrike,
      maxPeOiStrike,
      maxCeVolStrike: ceVolumes[0]?.strike ?? 0,
      maxPeVolStrike: peVolumes[0]?.strike ?? 0,
      second: {
        ceOi: ceOis[1]?.strike ?? 0,
        peOi: peOis[1]?.strike ?? 0,
        ceVol: ceVolumes[1]?.strike ?? 0,
        peVol: peVolumes[1]?.strike ?? 0,
      },
      totals,
      levels,
      source: "upstox",
      updatedAt: Date.now(),
    };
  },
};