import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type IndexContributionKey = "nifty" | "banknifty" | "sensex";

export type IndexContributionHistoryStock = {
  symbol: string;
  yahooSymbol: string;
  weight: number;
  prices: number[];
};

export type IndexContributionHistory = {
  index: IndexContributionKey;
  label: string;
  indexSymbol: string;
  timestamps: number[];
  indexPrices: number[];
  stocks: IndexContributionHistoryStock[];
  coverage: number;
  weightAsOf: string;
  source: "yahoo";
  updatedAt: number;
};

type WeightEntry = readonly [symbol: string, weight: number];

type IndexConfig = {
  label: string;
  indexSymbol: string;
  weights: readonly WeightEntry[];
};

// Free-float index weights are point-in-time inputs to the attribution formula.
// Keep the date explicit so a future index rebalance cannot silently masquerade
// as current weighting. All three maps sum to 1.0.
const WEIGHT_AS_OF = "2026-07-15";

const NIFTY_WEIGHTS: readonly WeightEntry[] = [
  ["HDFCBANK", 0.11373994352682305],
  ["ICICIBANK", 0.09042713888322951],
  ["RELIANCE", 0.07972208115253651],
  ["BHARTIARTL", 0.05383306418094737],
  ["LT", 0.041627245511537944],
  ["SBIN", 0.038590539660479754],
  ["AXISBANK", 0.034232921742968984],
  ["INFY", 0.03376986419135077],
  ["M&M", 0.025164636073790214],
  ["KOTAKBANK", 0.025080737939319676],
  ["BAJFINANCE", 0.024699477655814768],
  ["ITC", 0.024470576925935635],
  ["TCS", 0.01901989286533522],
  ["ETERNAL", 0.01887987081188035],
  ["SUNPHARMA", 0.018437255217775114],
  ["HINDUNILVR", 0.017166802251449034],
  ["TITAN", 0.016997496352723566],
  ["MARUTI", 0.016299677476120943],
  ["NTPC", 0.014735959544135493],
  ["TATASTEEL", 0.014229883905521231],
  ["BEL", 0.013373799323501806],
  ["SHRIRAMFIN", 0.013127326401219296],
  ["HINDALCO", 0.01263155080008669],
  ["ULTRACEMCO", 0.012492552173635558],
  ["ADANIPORTS", 0.012161705200395133],
  ["POWERGRID", 0.01156929776145212],
  ["HCLTECH", 0.011088070926882274],
  ["GRASIM", 0.010930961156781055],
  ["ASIANPAINT", 0.010903469086700953],
  ["INDIGO", 0.010805254833688903],
  ["JSWSTEEL", 0.010536204355601132],
  ["BAJAJ-AUTO", 0.01013156944264544],
  ["BAJAJFINSV", 0.009997304378378974],
  ["NESTLEIND", 0.009365582914377205],
  ["COALINDIA", 0.009285894197485791],
  ["EICHERMOT", 0.009150308662609791],
  ["TRENT", 0.008704869082984486],
  ["ONGC", 0.008571428494561668],
  ["ADANIENT", 0.008537010706597986],
  ["TECHM", 0.008324110179740241],
  ["APOLLOHOSP", 0.008204315593397562],
  ["SBILIFE", 0.007543229463850561],
  ["MAXHEALTH", 0.007427669008928579],
  ["CIPLA", 0.0073092144165362],
  ["JIOFIN", 0.0071669692335020645],
  ["DRREDDY", 0.00684491928664489],
  ["TATACONSUM", 0.006520531415638337],
  ["TMPV", 0.006355884508043051],
  ["HDFCLIFE", 0.005536462390680782],
  ["WIPRO", 0.004277468733776417],
];

const BANKNIFTY_WEIGHTS: readonly WeightEntry[] = [
  ["HDFCBANK", 0.33087759128153155],
  ["ICICIBANK", 0.2630589832595394],
  ["SBIN", 0.1122626265952271],
  ["AXISBANK", 0.0995860059150772],
  ["KOTAKBANK", 0.0729616518138007],
  ["FEDERALBNK", 0.021324475691325707],
  ["INDUSINDBK", 0.017527810818713067],
  ["AUBANK", 0.015918173638881324],
  ["IDFCFIRSTB", 0.014033700582170827],
  ["BANKBARODA", 0.012195771915381636],
  ["CANBK", 0.011351144874992116],
  ["YESBANK", 0.011033702218185152],
  ["PNB", 0.009528939297308574],
  ["UNIONBANK", 0.008339422097865501],
];

const SENSEX_WEIGHTS: readonly WeightEntry[] = [
  ["HDFCBANK", 0.13694607181524115],
  ["ICICIBANK", 0.10887680327209875],
  ["RELIANCE", 0.09598761448480118],
  ["BHARTIARTL", 0.06481651427600654],
  ["LT", 0.05012036736196699],
  ["SBIN", 0.04646408862060551],
  ["AXISBANK", 0.04121739482271314],
  ["INFY", 0.04065986058494078],
  ["M&M", 0.030298925356446772],
  ["KOTAKBANK", 0.030197909657017862],
  ["BAJFINANCE", 0.02973886161684674],
  ["ITC", 0.0294632587387321],
  ["TCS", 0.02290048274588891],
  ["ETERNAL", 0.022731892278955664],
  ["SUNPHARMA", 0.022198970729521386],
  ["HINDUNILVR", 0.020669309840219578],
  ["TITAN", 0.020465460804896876],
  ["MARUTI", 0.019625267368659435],
  ["NTPC", 0.017742507261943204],
  ["TATASTEEL", 0.017133178044778007],
  ["BEL", 0.016102428274610368],
  ["ULTRACEMCO", 0.015041382069289374],
  ["ADANIPORTS", 0.014643033064073335],
  ["POWERGRID", 0.01392975794574834],
  ["HCLTECH", 0.01335034738334656],
  ["ASIANPAINT", 0.01312808160688488],
  ["INDIGO", 0.013009828900498607],
  ["BAJAJFINSV", 0.012037033964567092],
  ["TRENT", 0.010480905736510551],
  ["TECHM", 0.010022461372190273],
];

const INDEX_CONFIG: Record<IndexContributionKey, IndexConfig> = {
  nifty: { label: "NIFTY 50", indexSymbol: "^NSEI", weights: NIFTY_WEIGHTS },
  banknifty: { label: "BANK NIFTY", indexSymbol: "^NSEBANK", weights: BANKNIFTY_WEIGHTS },
  sensex: { label: "SENSEX", indexSymbol: "^BSESN", weights: SENSEX_WEIGHTS },
};

type SparkChart = {
  meta?: {
    symbol?: string;
    previousClose?: number;
    chartPreviousClose?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

type SparkResult = { symbol?: string; response?: SparkChart[] };

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const CACHE_TTL_MS = 25_000;
const historyCache = new Map<IndexContributionKey, { at: number; data: IndexContributionHistory }>();

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function istDateKey(timestamp: number): string {
  return new Date((timestamp + 19_800) * 1000).toISOString().slice(0, 10);
}

async function fetchSparkChunk(symbols: string[]): Promise<SparkResult[]> {
  const path = `/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=5d&interval=1m&includePrePost=false`;
  let lastStatus = 0;

  for (const host of ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]) {
    try {
      const response = await fetch(`${host}${path}`, { headers: YAHOO_HEADERS });
      lastStatus = response.status;
      if (!response.ok) continue;
      const json = (await response.json()) as { spark?: { result?: SparkResult[] } };
      return json.spark?.result ?? [];
    } catch {
      // Try Yahoo's alternate host before reporting a real-data failure.
    }
  }

  throw new Error(`Yahoo intraday history request failed${lastStatus ? ` (${lastStatus})` : ""}.`);
}

function alignSeries(chart: SparkChart, targetTimestamps: number[], sessionStart: number): number[] | null {
  const timestamps = chart.timestamp ?? [];
  const closes = chart.indicators?.quote?.[0]?.close ?? [];
  const values = new Map<number, number>();
  let previousSessionValue: number | null = null;

  for (let index = 0; index < timestamps.length; index += 1) {
    const value = closes[index];
    if (!isFiniteNumber(value)) continue;
    values.set(timestamps[index], value);
    if (timestamps[index] < sessionStart) previousSessionValue = value;
  }

  const metaPrevious = chart.meta?.chartPreviousClose ?? chart.meta?.previousClose;
  let current = previousSessionValue ?? (isFiniteNumber(metaPrevious) ? metaPrevious : null);
  if (current == null) return null;

  const aligned = [current];
  for (const timestamp of targetTimestamps) {
    const exact = values.get(timestamp);
    if (exact != null) current = exact;
    aligned.push(current);
  }
  return aligned;
}

async function loadContributionHistory(index: IndexContributionKey): Promise<IndexContributionHistory> {
  const hit = historyCache.get(index);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const config = INDEX_CONFIG[index];
  const stockSymbols = config.weights.map(([symbol]) => `${symbol}.NS`);
  const requested = [...stockSymbols, config.indexSymbol];
  const chunks: string[][] = [];
  for (let start = 0; start < requested.length; start += 10) {
    chunks.push(requested.slice(start, start + 10));
  }

  const results = (await Promise.all(chunks.map(fetchSparkChunk))).flat();
  const charts = new Map<string, SparkChart>();
  for (const result of results) {
    const chart = result.response?.[0];
    const symbol = result.symbol ?? chart?.meta?.symbol;
    if (symbol && chart) charts.set(symbol, chart);
  }

  const indexChart = charts.get(config.indexSymbol);
  if (!indexChart) throw new Error(`No real intraday history was returned for ${config.label}.`);

  const indexTimestamps = indexChart.timestamp ?? [];
  const indexCloses = indexChart.indicators?.quote?.[0]?.close ?? [];
  const validIndexRows = indexTimestamps
    .map((timestamp, rowIndex) => ({ timestamp, close: indexCloses[rowIndex] }))
    .filter((row): row is { timestamp: number; close: number } => isFiniteNumber(row.close));
  if (validIndexRows.length < 2) throw new Error(`Insufficient real intraday history for ${config.label}.`);

  const latestDate = istDateKey(validIndexRows[validIndexRows.length - 1].timestamp);
  const sessionRows = validIndexRows.filter((row) => istDateKey(row.timestamp) === latestDate);
  if (sessionRows.length < 2) throw new Error(`No complete market session is available for ${config.label}.`);

  const sessionStart = sessionRows[0].timestamp;
  const previousRow = validIndexRows.filter((row) => row.timestamp < sessionStart).at(-1);
  const metaPrevious = indexChart.meta?.chartPreviousClose ?? indexChart.meta?.previousClose;
  const previousIndex = previousRow?.close ?? (isFiniteNumber(metaPrevious) ? metaPrevious : null);
  if (previousIndex == null) throw new Error(`Previous close is unavailable for ${config.label}.`);

  const sessionTimestamps = sessionRows.map((row) => row.timestamp);
  const previousTimestamp = previousRow?.timestamp ?? sessionStart - 60;
  const indexPrices = [previousIndex, ...sessionRows.map((row) => row.close)];
  const stocks: IndexContributionHistoryStock[] = [];
  let resolvedWeight = 0;

  for (const [symbol, weight] of config.weights) {
    const yahooSymbol = `${symbol}.NS`;
    const chart = charts.get(yahooSymbol);
    if (!chart) continue;
    const prices = alignSeries(chart, sessionTimestamps, sessionStart);
    if (!prices) continue;
    stocks.push({ symbol, yahooSymbol, weight, prices });
    resolvedWeight += weight;
  }

  if (resolvedWeight < 0.92) {
    throw new Error(
      `${config.label} contribution history coverage is only ${(resolvedWeight * 100).toFixed(1)}%; refusing to estimate the missing weight.`,
    );
  }

  const data: IndexContributionHistory = {
    index,
    label: config.label,
    indexSymbol: config.indexSymbol,
    timestamps: [previousTimestamp, ...sessionTimestamps],
    indexPrices,
    stocks,
    coverage: resolvedWeight,
    weightAsOf: WEIGHT_AS_OF,
    source: "yahoo",
    updatedAt: sessionRows[sessionRows.length - 1].timestamp * 1000,
  };

  historyCache.set(index, { at: Date.now(), data });
  return data;
}

export const getIndexContributionHistory = createServerFn({ method: "GET" })
  .validator(z.object({ index: z.enum(["nifty", "banknifty", "sensex"]) }))
  .handler(async ({ data }) => loadContributionHistory(data.index));
