import { useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

interface IndexItemData {
  kind: "index";
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  change: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
}

interface FnoItemData {
  kind: "fno";
  symbol: string;
  price: number;
  changePct: number;
  category: string;
  categoryClass: string;
  volume: number;
  oi: number;
  dayHigh: number;
  dayLow: number;
  oiChgPct?: number;
  signalTime?: number | null;
  buildup?: string;
}

type ItemData = IndexItemData | FnoItemData;

function fmtPrice(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 10000) return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 100) return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(n: number): string {
  if (!isFinite(n)) return "—";
  const s = n.toFixed(2);
  return n >= 0 ? `+${s}` : s;
}

function fmtLarge(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1e7) return (n / 1e7).toFixed(2) + "Cr";
  if (n >= 1e5) return (n / 1e5).toFixed(2) + "L";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

function fmtSig(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

const CATEGORY_EMOJI: Record<string, string> = {
  "INFLOW": "🟢",
  "OUTFLOW": "🔴",
  "Long Buildup": "🔥",
  "Short Buildup": "🔴",
  "Short Covering": "🟢",
  "Long Unwinding": "🟡",
  "Volume Shocker": "⚡",
  "BREAKOUT": "🚀",
  "BREAKDOWN": "📉",
  "High OI Change": "📊",
  "High Volume": "📈",
  "High Delivery": "💥",
  "BO": "🚀",
  "BD": "📉",
};

const CATEGORY_LABEL: Record<string, string> = {
  "INFLOW": "INFLOW",
  "OUTFLOW": "OUTFLOW",
  "Long Buildup": "LONG BUILDUP",
  "Short Buildup": "SHORT BUILDUP",
  "Short Covering": "SHORT COVERING",
  "Long Unwinding": "LONG UNWINDING",
  "Volume Shocker": "VOLUME SHOCKER",
  "BREAKOUT": "BREAKOUT",
  "BREAKDOWN": "BREAKDOWN",
  "High OI Change": "HIGH OI CHANGE",
  "High Volume": "HIGH VOLUME",
  "High Delivery": "HIGH DELIVERY",
};

interface TickerItemProps {
  data: ItemData;
}

export function TickerItem({ data }: TickerItemProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });

  const up = data.changePct >= 0;

  const handleClick = useCallback(() => {
    if (data.kind === "index") {
      navigate({ to: "/" });
    } else {
      navigate({ to: "/intraday-booster" });
    }
  }, [data, navigate]);

  const handleMouseEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setTooltip({ show: true, x: rect.left, y: rect.bottom + 4 });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip({ show: false, x: 0, y: 0 });
  }, []);

  if (data.kind === "index") {
    return (
      <>
        <div
          ref={ref}
          className="ticker-item"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="ticker-label">{data.name}</span>
          <span className={`ticker-price ${data.symbol === "^INDIAVIX" ? "ticker-vix" : ""}`}>
            {fmtPrice(data.price)}
          </span>
          <span className={`ticker-arrow ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"}
          </span>
          <span className={`ticker-change ${up ? "positive" : "negative"}`}>
            {fmtChange(data.changePct)}%
          </span>
        </div>
        {tooltip.show && (
          <div className="ticker-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <div className="tt-title">{data.name}</div>
            <div className="tt-row">
              <span className="tt-label">Price</span>
              <span className="tt-value">{fmtPrice(data.price)}</span>
            </div>
            <div className="tt-row">
              <span className="tt-label">Change</span>
              <span className={`tt-value ${up ? "positive" : "negative"}`}>
                {fmtChange(data.changePct)}%
              </span>
            </div>
            <div className="tt-row">
              <span className="tt-label">Day High</span>
              <span className="tt-value">{fmtPrice(data.dayHigh)}</span>
            </div>
            <div className="tt-row">
              <span className="tt-label">Day Low</span>
              <span className="tt-value">{fmtPrice(data.dayLow)}</span>
            </div>
            {data.volume > 0 && (
              <div className="tt-row">
                <span className="tt-label">Volume</span>
                <span className="tt-value">{fmtLarge(data.volume)}</span>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  const emoji = CATEGORY_EMOJI[data.category] || "";
  const label = CATEGORY_LABEL[data.category] || data.category;

  return (
    <>
      <div
        ref={ref}
        className="ticker-item"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {emoji && <span>{emoji}</span>}
        <span className={`ticker-signal-category ${data.categoryClass}`}>
          {label}
        </span>
        <span className="ticker-label">{data.symbol}</span>
        <span className={`ticker-arrow ${up ? "up" : "down"}`}>
          {up ? "▲" : "▼"}
        </span>
        <span className={`ticker-change ${up ? "positive" : "negative"}`}>
          {fmtChange(data.changePct)}%
        </span>
      </div>
      {tooltip.show && (
        <div className="ticker-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tt-title">{data.symbol}</div>
          <div className="tt-row">
            <span className="tt-label">Price</span>
            <span className="tt-value">{fmtPrice(data.price)}</span>
          </div>
          <div className="tt-row">
            <span className="tt-label">Change</span>
            <span className={`tt-value ${up ? "positive" : "negative"}`}>
              {fmtChange(data.changePct)}%
            </span>
          </div>
          {data.buildup && (
            <div className="tt-row">
              <span className="tt-label">Signal</span>
              <span className="tt-value">{data.buildup}</span>
            </div>
          )}
          {typeof data.oiChgPct === "number" && (
            <div className="tt-row">
              <span className="tt-label">OI Chg</span>
              <span className={`tt-value ${data.oiChgPct >= 0 ? "positive" : "negative"}`}>
                {fmtChange(data.oiChgPct)}%
              </span>
            </div>
          )}
          {data.dayHigh > 0 && (
            <div className="tt-row">
              <span className="tt-label">Day High</span>
              <span className="tt-value">{fmtPrice(data.dayHigh)}</span>
            </div>
          )}
          {data.dayLow > 0 && (
            <div className="tt-row">
              <span className="tt-label">Day Low</span>
              <span className="tt-value">{fmtPrice(data.dayLow)}</span>
            </div>
          )}
          {data.oi > 0 && (
            <div className="tt-row">
              <span className="tt-label">OI</span>
              <span className="tt-value">{fmtLarge(data.oi)}</span>
            </div>
          )}
          {data.volume > 0 && (
            <div className="tt-row">
              <span className="tt-label">Volume</span>
              <span className="tt-value">{fmtLarge(data.volume)}</span>
            </div>
          )}
          {data.signalTime ? (
            <div className="tt-row">
              <span className="tt-label">Time</span>
              <span className="tt-value">{fmtSig(data.signalTime)}</span>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
