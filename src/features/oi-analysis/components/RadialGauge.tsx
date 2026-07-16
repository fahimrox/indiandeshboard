import { memo } from "react";
import type { SentimentResult } from "../types";
import { sentimentColor } from "../utils";

interface Props {
  sentiment: SentimentResult;
  size?: number;
}

function RadialGaugeBase({ sentiment, size = 180 }: Props) {
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = sentimentColor(sentiment.label);
  const dash = (sentiment.score / 100) * c;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(148,163,184,0.15)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          style={{ transition: "stroke-dasharray 700ms cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ maxWidth: size * 0.7 }}>
        <span className="text-xl font-semibold tracking-tight" style={{ color }}>
          {sentiment.label}
        </span>
        <span className="mt-1 text-center text-[11px] leading-tight text-slate-400">
          {sentiment.label} conditions
        </span>
        <span className="mt-1 text-sm font-medium" style={{ color }}>
          {sentiment.score}%
        </span>
      </div>
    </div>
  );
}

export const RadialGauge = memo(RadialGaugeBase);
