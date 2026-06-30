import React, { useMemo } from 'react';
import { AIDecision, S_R_Zone } from '../types/oi.types';
import { Activity, ShieldAlert, Sparkles, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';

interface AIInsightPanelProps {
  decision: AIDecision | null;
  srZones: S_R_Zone[];
  spotPrice: number;
}

export const AIInsightPanel: React.FC<AIInsightPanelProps> = React.memo(({
  decision,
  srZones,
  spotPrice
}) => {
  const biasBadgeColor = useMemo(() => {
    if (!decision) return 'bg-zinc-900 border-zinc-800 text-zinc-400';
    switch (decision.bias) {
      case 'Strong Bullish':
        return 'bg-emerald-950/80 border-emerald-500 text-emerald-400';
      case 'Bullish':
        return 'bg-emerald-950/30 border-emerald-600/30 text-emerald-500';
      case 'Strong Bearish':
        return 'bg-rose-950/80 border-rose-500 text-rose-400';
      case 'Bearish':
        return 'bg-rose-950/30 border-rose-600/30 text-rose-500';
      default:
        return 'bg-amber-950/50 border-amber-500/50 text-amber-500';
    }
  }, [decision]);

  if (!decision) return null;

  const supportZone = srZones.find(z => z.type === 'Support');
  const resistanceZone = srZones.find(z => z.type === 'Resistance');

  return (
    <div className="w-full bg-[#0a0a0c] border border-zinc-800/80 rounded-lg p-5 flex flex-col justify-between h-full select-none">
      {/* Panel Title */}
      <div>
        <div className="flex items-center gap-2 mb-4 border-b border-zinc-800/60 pb-3">
          <Sparkles className="w-4 h-4 text-amber-500 animate-pulse" />
          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">AI DECISION SYNTHESIS</span>
        </div>

        {/* Core Bias Gauge */}
        <div className="flex flex-col items-center justify-center py-3 bg-zinc-900/10 border border-zinc-800/30 rounded-lg mb-4">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">COMPOSITE MARKET BIAS</span>
          <h2 className="text-xl font-extrabold text-zinc-100 tracking-wide mt-1 uppercase">
            {decision.bias}
          </h2>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${biasBadgeColor}`}>
              {decision.confidence} Confidence
            </span>
            <span className="text-xs text-zinc-500">Risk Score: <b className="text-zinc-300">{decision.riskScore}/100</b></span>
          </div>
        </div>

        {/* Probability Meter Breakdown */}
        <div className="space-y-2 mb-5">
          <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Probability Metrics</span>
          
          {/* Progress Bar container */}
          <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden flex">
            <div 
              style={{ width: `${decision.probabilities.bullish}%` }} 
              className="bg-emerald-500 h-full transition-all duration-500" 
              title={`Bullish Probability: ${decision.probabilities.bullish}%`}
            />
            <div 
              style={{ width: `${decision.probabilities.neutral}%` }} 
              className="bg-amber-500 h-full transition-all duration-500" 
              title={`Neutral Probability: ${decision.probabilities.neutral}%`}
            />
            <div 
              style={{ width: `${decision.probabilities.bearish}%` }} 
              className="bg-rose-500 h-full transition-all duration-500" 
              title={`Bearish Probability: ${decision.probabilities.bearish}%`}
            />
          </div>

          <div className="flex justify-between text-[11px] font-semibold">
            <span className="text-emerald-500 flex items-center gap-1">
              Bullish: {decision.probabilities.bullish}%
            </span>
            <span className="text-zinc-500 flex items-center gap-1">
              Neutral: {decision.probabilities.neutral}%
            </span>
            <span className="text-rose-500 flex items-center gap-1">
              Bearish: {decision.probabilities.bearish}%
            </span>
          </div>
        </div>
      </div>

      {/* Structured Tactical Execution Zones */}
      <div className="space-y-3 pt-3 border-t border-zinc-800/50">
        {/* Entry / Buy Zone */}
        <div className="flex items-start gap-2 text-xs">
          <div className="p-1 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/30 shrink-0">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="font-extrabold text-emerald-400 uppercase tracking-wider text-[10px]">TRES ACCUMULATION ZONE (BUY)</h4>
            <p className="text-zinc-300 font-bold mt-0.5 tabular-nums">
              ₹{Math.round(decision.entryZone[0])} - ₹{Math.round(decision.entryZone[1])}
            </p>
            <p className="text-[10px] text-zinc-500 leading-normal mt-0.5">
              Ideal range for placing bullish spreads with high support backing.
            </p>
          </div>
        </div>

        {/* Avoid Zone */}
        <div className="flex items-start gap-2 text-xs">
          <div className="p-1 rounded bg-rose-950/50 text-rose-400 border border-rose-800/30 shrink-0">
            <TrendingDown className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="font-extrabold text-rose-400 uppercase tracking-wider text-[10px]">OVERBOUGHT RESISTANCE ZONE (AVOID)</h4>
            <p className="text-zinc-300 font-bold mt-0.5 tabular-nums">
              ₹{Math.round(decision.avoidZone[0])} - ₹{Math.round(decision.avoidZone[1])}
            </p>
            <p className="text-[10px] text-zinc-500 leading-normal mt-0.5">
              High risk of rejection. Favor short calls or protective hedges here.
            </p>
          </div>
        </div>

        {/* Trap Alerts */}
        {decision.trapDetected && (
          <div className="flex items-start gap-2 text-xs bg-amber-950/20 border border-amber-600/30 p-2.5 rounded-lg mt-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5 animate-bounce" />
            <div>
              <h4 className="font-extrabold text-amber-500 uppercase tracking-wider text-[10px]">RISK RADAR: TRAP ALERT</h4>
              <p className="text-[10px] text-amber-400/90 leading-normal mt-1 font-medium">
                {decision.trapDetails}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

AIInsightPanel.displayName = 'AIInsightPanel';
