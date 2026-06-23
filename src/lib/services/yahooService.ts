import type { Quote } from "../market.functions";

async function fetchYahooChunk(symbols: string[]): Promise<Quote[]> {
  const url = `https://query2.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
    symbols.join(",")
  )}&range=1d&interval=5m`;
  
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://finance.yahoo.com/",
      Origin: "https://finance.yahoo.com",
    },
  });

  if (!res.ok) throw new Error(`Yahoo request failed: ${res.status}`);
  const json = (await res.json()) as {
    spark: { result: Array<{ symbol: string; response: Array<{ meta: any }> }> };
  };

  const out: Quote[] = [];
  for (const r of json.spark?.result ?? []) {
    const meta = r.response?.[0]?.meta;
    if (!meta) continue;
    const price = meta.regularMarketPrice ?? 0;
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
    
    out.push({
      symbol: meta.symbol,
      name: meta.longName ?? meta.shortName ?? meta.symbol,
      price,
      prevClose: prev,
      change: price - prev,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      dayHigh: meta.regularMarketDayHigh ?? price,
      dayLow: meta.regularMarketDayLow ?? price,
      open:
        meta.regularMarketDayHigh && meta.regularMarketDayLow
          ? (meta.regularMarketDayHigh + meta.regularMarketDayLow) / 2
          : price,
      marketState: meta.marketState ?? "UNKNOWN",
      currency: meta.currency ?? "INR",
      exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    });
  }
  return out;
}

export const yahooService = {
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const CHUNK = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < symbols.length; i += CHUNK) {
      chunks.push(symbols.slice(i, i + CHUNK));
    }
    const results = await Promise.all(chunks.map((c) => fetchYahooChunk(c)));
    return results.flat();
  },

  async getHistory(
    symbol: string,
    range = "1mo",
    interval = "1d"
  ): Promise<{
    timestamps: number[];
    close: number[];
    open: number[];
    high: number[];
    low: number[];
    volume: number[];
  }> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Yahoo chart request failed for ${symbol}: status ${res.status}`);
    }

    const json = (await res.json()) as any;
    const chart = json.chart?.result?.[0];
    if (!chart) throw new Error(`No historical chart data for ${symbol}`);

    const indicators = chart.indicators?.quote?.[0] || {};
    return {
      timestamps: chart.timestamp || [],
      close: indicators.close || [],
      open: indicators.open || [],
      high: indicators.high || [],
      low: indicators.low || [],
      volume: indicators.volume || [],
    };
  },
};
