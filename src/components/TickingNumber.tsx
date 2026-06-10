import { useEffect, useRef, useState } from "react";
import { isMarketOpenIst } from "@/lib/market-hours";

function formatNumber(n: number, d = 2) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/**
 * Shows a number whose last digits "tick" every ~500ms with a tiny random walk
 * to give a live feel between real data refreshes. When `value` prop changes
 * (real data update), it snaps to the new value.
 */
export function TickingNumber({
  value,
  decimals = 2,
  jitter,
  intervalMs = 600,
  className,
}: {
  value: number;
  decimals?: number;
  jitter?: number; // max +/- random walk per tick (defaults to ~0.01% of value)
  intervalMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpenIst());
  const baseRef = useRef(value);

  useEffect(() => {
    baseRef.current = value;
    setDisplay(value);
  }, [value]);

  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketOpenIst()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!marketOpen || !isFinite(value)) {
      setDisplay(value);
      return;
    }
    const j = jitter ?? Math.max(0.05, Math.abs(value) * 0.0001);
    const id = setInterval(() => {
      const delta = (Math.random() - 0.5) * 2 * j;
      // keep drift bounded so we don't wander too far from real value
      const next = baseRef.current + delta;
      setDisplay(next);
    }, intervalMs);
    return () => clearInterval(id);
  }, [value, jitter, intervalMs, marketOpen]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatNumber(display, decimals)}
    </span>
  );
}
