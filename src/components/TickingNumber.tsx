function formatNumber(n: number, d = 2) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

type TickingNumberProps = {
  value: number;
  decimals?: number;
  /** @deprecated Ignored. The display is driven exclusively by the real value prop. */
  jitter?: number;
  /** @deprecated Ignored. The component no longer runs a synthetic update interval. */
  intervalMs?: number;
  className?: string;
};

/**
 * Displays only the latest real value supplied by the caller.
 */
export function TickingNumber({
  value,
  decimals = 2,
  className,
}: TickingNumberProps) {
  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatNumber(value, decimals)}
    </span>
  );
}
