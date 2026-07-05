import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fnoStocksQuery } from "@/lib/dashboard-query";
import { computeBoosterFlows } from "@/lib/boosterFlow";
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
  const fnoResult = useQuery(fnoStocksQuery);
  return {
    fnoStocks: ((fnoResult.data as any)?.data ?? []) as any[],
    isLoading: fnoResult.isLoading,
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
    const speedPxPerSec = 480;
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
  const { fnoStocks } = useTickerData();

  // Intraday Booster inflow/outflow — the SAME Momentum-Ignition signals as the
  // page, latest signal first.
  const fnoItems = useMemo(() => {
    const { inflow, outflow } = computeBoosterFlows(fnoStocks);
    const mk = (s: any, category: string, categoryClass: string) => ({
      kind: "fno" as const,
      symbol: s.symbol,
      price: s.ltp,
      changePct: s.changePct,
      category,
      categoryClass,
      volume: s.volume,
      oi: 0,
      dayHigh: 0,
      dayLow: 0,
      oiChgPct: s.oiChgPct,
      signalTime: s.signalTime,
      buildup: s.buildup,
    });
    const ins = inflow.map((s) => mk(s, "INFLOW", "long-buildup"));
    const outs = outflow.map((s) => mk(s, "OUTFLOW", "short-buildup"));
    // Alternate green (inflow) ↔ red (outflow). Each list is already latest /
    // strongest first, so we surface the freshest inflow, then freshest outflow,
    // then the next of each, and so on. The longer list contributes its remainder.
    const woven: Array<(typeof ins)[number]> = [];
    const n = Math.max(ins.length, outs.length);
    for (let i = 0; i < n; i++) {
      if (i < ins.length) woven.push(ins[i]);
      if (i < outs.length) woven.push(outs[i]);
    }
    return woven;
  }, [fnoStocks]);

  // Only the Intraday Booster inflow/outflow signals (latest first). No indices.
  const items = fnoItems;
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
