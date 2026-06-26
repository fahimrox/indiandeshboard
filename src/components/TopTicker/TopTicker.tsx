import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { quotesQuery, fnoScreenerQuery } from "@/lib/dashboard-query";
import { TickerItem } from "./TickerItem";
import "./ticker.css";

const INDEX_SYMBOLS = [
  "^NSEI",
  "^NSEBANK",
  "^NSEMIDCAP",
  "NIFTY_FIN_SERVICE.NS",
  "^BSESN",
  "^INDIAVIX",
  "^CRSLDX",
  "^CNXIT",
  "^CNXAUTO",
  "^CNXFMCG",
  "^CNXMETAL",
  "^CNXPHARMA",
  "^CNXPSUBANK",
  "^CNXREALTY",
];

const INDEX_NAMES: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^NSEBANK": "BANK NIFTY",
  "^NSEMIDCAP": "MIDCAP NIFTY",
  "NIFTY_FIN_SERVICE.NS": "FIN NIFTY",
  "^BSESN": "SENSEX",
  "^INDIAVIX": "INDIA VIX",
  "^CRSLDX": "NIFTY NEXT 50",
  "^CNXIT": "NIFTY IT",
  "^CNXAUTO": "NIFTY AUTO",
  "^CNXFMCG": "NIFTY FMCG",
  "^CNXMETAL": "NIFTY METAL",
  "^CNXPHARMA": "NIFTY PHARMA",
  "^CNXPSUBANK": "NIFTY PSU BANK",
  "^CNXREALTY": "NIFTY REALTY",
};

const SCREENER_CATEGORY_MAP: Record<string, string> = {
  "Long Buildup": "Long Buildup",
  "Short Buildup": "Short Buildup",
  "Short Covering": "Short Covering",
  "Long Unwinding": "Long Unwinding",
  "Volume Shocker": "Volume Shocker",
  "Day High Break": "BREAKOUT",
  "Week High Break": "BREAKOUT",
  "Month High Break": "BREAKOUT",
  "Day Low Break": "BREAKDOWN",
  "Week Low Break": "BREAKDOWN",
  "Month Low Break": "BREAKDOWN",
  "Range Breakout": "BREAKOUT",
};

const CATEGORY_CLASS: Record<string, string> = {
  "Long Buildup": "long-buildup",
  "Short Buildup": "short-buildup",
  "Short Covering": "short-covering",
  "Long Unwinding": "long-unwinding",
  "Volume Shocker": "volume-shocker",
  "BREAKOUT": "breakout",
  "BREAKDOWN": "breakdown",
  "High OI Change": "high-oi",
  "High Volume": "high-volume",
  "High Delivery": "high-delivery",
};

function getCategoryForStock(stock: {
  buildup: string;
  tags: string[];
  oiChgPct: number;
  volume: number;
}): { category: string; categoryClass: string } {
  if (stock.buildup !== "Neutral") {
    const mapped = SCREENER_CATEGORY_MAP[stock.buildup];
    if (mapped) {
      return { category: mapped, categoryClass: CATEGORY_CLASS[mapped] || "" };
    }
  }

  for (const tag of stock.tags) {
    const mapped = SCREENER_CATEGORY_MAP[tag];
    if (mapped) {
      return { category: mapped, categoryClass: CATEGORY_CLASS[mapped] || "" };
    }
  }

  if (Math.abs(stock.oiChgPct) > 8) {
    return { category: "High OI Change", categoryClass: "high-oi" };
  }

  if (stock.volume > 3000000) {
    return { category: "High Volume", categoryClass: "high-volume" };
  }

  return { category: "Volume Shocker", categoryClass: "volume-shocker" };
}

function useTickerData() {
  const queries = useQueries({
    queries: [
      { ...quotesQuery(INDEX_SYMBOLS), enabled: true },
      { ...fnoScreenerQuery, enabled: true },
    ],
  });

  const [quotesResult, screenerResult] = queries;

  return {
    quotes: quotesResult.data ?? [],
    screener: screenerResult.data?.data ?? [],
    isLoading: quotesResult.isLoading && screenerResult.isLoading,
  };
}

function useTickerAnimation(trackRef: React.RefObject<HTMLDivElement | null>, itemCount: number) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || itemCount === 0) return;

    const itemWidth = 160;
    const separatorWidth = 42;
    const totalWidth = itemCount * (itemWidth + separatorWidth);
    const speedPxPerSec = 150;
    const durationSec = totalWidth / speedPxPerSec;

    el.style.setProperty("--duration", `${durationSec}s`);
    el.style.animationDuration = `${durationSec}s`;
  }, [trackRef, itemCount]);

  const handleMouseEnter = useCallback(() => setPaused(true), []);
  const handleMouseLeave = useCallback(() => setPaused(false), []);

  return { paused, handleMouseEnter, handleMouseLeave };
}

export function TopTicker() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { quotes, screener } = useTickerData();

  const indices = useMemo(() => {
    const quoteMap = new Map(quotes.map((q: any) => [q.symbol, q]));
    return INDEX_SYMBOLS
      .map((sym) => {
        const q = quoteMap.get(sym);
        if (!q) return null;
        return {
          kind: "index" as const,
          symbol: sym,
          name: INDEX_NAMES[sym] || sym,
          price: q.price,
          changePct: q.changePct,
          change: q.change,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
          volume: q.volume || 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [quotes]);

  const fnoItems = useMemo(() => {
    return screener
      .filter((stock: any) => {
        const { category } = getCategoryForStock(stock);
        return category !== "Neutral" || false;
      })
      .slice(0, 30)
      .map((stock: any) => {
        const { category, categoryClass } = getCategoryForStock(stock);
        return {
          kind: "fno" as const,
          symbol: stock.symbol,
          price: stock.ltp,
          changePct: stock.changePct,
          category,
          categoryClass,
          volume: stock.volume,
          oi: stock.oi,
          dayHigh: stock.dayHigh,
          dayLow: stock.dayLow,
        };
      });
  }, [screener]);

  const items = useMemo(() => [...indices, ...fnoItems], [indices, fnoItems]);
  const duplicated = useMemo(() => [...items, ...items], [items]);
  const { paused: p, handleMouseEnter, handleMouseLeave } = useTickerAnimation(trackRef, items.length);

  return (
    <div
      className={`ticker-container${p ? " paused" : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={trackRef} className="ticker-track">
        {duplicated.map((item, idx) => (
          <div key={`${item.kind}-${item.symbol}-${idx}`} className="flex items-center">
            <TickerItem data={item} />
            <div className="ticker-separator" />
          </div>
        ))}
      </div>
    </div>
  );
}
