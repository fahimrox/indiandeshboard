import { Settings, ChevronLeft, ChevronRight, BarChart3, Info, TrendingUp } from "lucide-react";
import { DonutChart } from "./DonutChart";
import type { StrikeFilter, ModeType, IndexType } from "./OIAnalysisDashboard";

interface OISidebarProps {
  strikeFilter: StrikeFilter;
  onStrikeFilterChange: (filter: StrikeFilter) => void;
  selectedMode: ModeType;
  onModeChange: (mode: ModeType) => void;
  selectedIndex: IndexType;
  onIndexChange: (index: IndexType) => void;
  selectedExpiry: string;
  onExpiryChange: (expiry: string) => void;
  sentiment: {
    type: "Bullish" | "Bearish" | "Neutral";
    bullishPercent: number;
    bearishPercent: number;
  };
  pcr: number;
  pcrChange: number;
  pcrOIChange: number;
}

const INDICES: IndexType[] = ["NIFTY", "BANKNIFTY", "MIDCPNIFTY", "SENSEX"];
const STRIKE_FILTERS: StrikeFilter[] = ["All", "ATM", "5", "10", "20"];

export function OISidebar({
  strikeFilter,
  onStrikeFilterChange,
  selectedMode,
  onModeChange,
  selectedIndex,
  onIndexChange,
  selectedExpiry,
  onExpiryChange,
  sentiment,
  pcr,
  pcrChange,
  pcrOIChange,
}: OISidebarProps) {
  const currentIndexIdx = INDICES.indexOf(selectedIndex);

  const handlePrevIndex = () => {
    const newIdx = (currentIndexIdx - 1 + INDICES.length) % INDICES.length;
    onIndexChange(INDICES[newIdx]);
  };

  const handleNextIndex = () => {
    const newIdx = (currentIndexIdx + 1) % INDICES.length;
    onIndexChange(INDICES[newIdx]);
  };

  return (
    <div className="w-[280px] flex-shrink-0 space-y-5">
      {/* Settings Header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">Settings</h3>
        </div>

        {/* Index Selector */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-muted-foreground mb-2 block">Index</label>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevIndex}
              className="p-1.5 rounded-md hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4 text-foreground" />
            </button>
            <div className="flex-1 text-center">
              <span className="inline-block px-4 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold">
                {selectedIndex}
              </span>
            </div>
            <button
              onClick={handleNextIndex}
              className="p-1.5 rounded-md hover:bg-accent transition-colors"
            >
              <ChevronRight className="h-4 w-4 text-foreground" />
            </button>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-muted-foreground mb-2 block">Select Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => onModeChange("Live")}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                selectedMode === "Live"
                  ? "bg-blue-500 text-white"
                  : "bg-background border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Live
            </button>
            <button
              onClick={() => onModeChange("Historical")}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                selectedMode === "Historical"
                  ? "bg-blue-500 text-white"
                  : "bg-background border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              Historical
            </button>
          </div>
        </div>

        {/* Expiry Dropdown */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-muted-foreground mb-2 block">Expiry</label>
          <select
            value={selectedExpiry}
            onChange={(e) => onExpiryChange(e.target.value)}
            className="w-full px-3 py-1.5 rounded-md bg-background border border-border text-xs font-medium text-foreground outline-none cursor-pointer"
          >
            <option value="30 Jun 2026 (4d)">30 Jun 2026 (4d)</option>
            <option value="07 Jul 2026 (11d)">07 Jul 2026 (11d)</option>
            <option value="28 Jul 2026 (32d)">28 Jul 2026 (32d)</option>
          </select>
        </div>

        {/* Strike Filter */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-2 block">
            Strikes above/below ATM
          </label>
          <div className="flex flex-wrap gap-1.5">
            {STRIKE_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => onStrikeFilterChange(filter)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  strikeFilter === filter
                    ? "bg-blue-500 text-white"
                    : "bg-background border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Market Sentiment */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-bold text-foreground">Market Sentiment</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">(based on OI)</p>

        {/* Donut Chart */}
        <div className="flex justify-center mb-4">
          <DonutChart
            segments={[
              { value: sentiment.bearishPercent, color: "#FF7777", label: "Bearish" },
              { value: sentiment.bullishPercent, color: "#00DD99", label: "Bullish" },
            ]}
            centerText={sentiment.type}
            centerValue={`${sentiment.bearishPercent}%`}
            size={150}
          />
        </div>

        {/* PCR Values */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">PCR:</span>
            <span className="font-mono font-semibold text-foreground">
              {pcr.toFixed(2)}
              <span className={`ml-1 ${pcrChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                ({pcrChange >= 0 ? "+" : ""}{pcrChange.toFixed(2)})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">PCR OI Change:</span>
            <span className="font-mono font-semibold text-muted-foreground">
              {pcrOIChange.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Market Insight Box */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
        <div className="flex items-start gap-2 mb-2">
          <Info className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <h3 className="text-xs font-bold text-foreground">Market Insight</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Market displaying {sentiment.type.toLowerCase()} sentiment with {sentiment.type === "Bearish" ? "negative" : sentiment.type === "Bullish" ? "positive" : "neutral"} indicators.
        </p>
      </div>

      {/* Analysis Box */}
      <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
        <div className="flex items-start gap-2 mb-2">
          <TrendingUp className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <h3 className="text-xs font-bold text-foreground">Analysis</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {sentiment.type} sentiment with PCR at {pcr.toFixed(2)}. Heavy call accumulation shows {sentiment.type === "Bullish" ? "bullish" : "bearish"} positioning.
        </p>
      </div>
    </div>
  );
}
