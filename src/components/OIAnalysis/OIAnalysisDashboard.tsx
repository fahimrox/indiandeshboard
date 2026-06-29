import { useState, useMemo } from "react";
import { OIMainChart } from "./OIMainChart";
import { OISidebar } from "./OISidebar";
import { OIBottomPanels } from "./OIBottomPanels";
import { generateMockOIData, type OIDataPoint } from "./mockData";

export type StrikeFilter = "All" | "ATM" | "5" | "10" | "20";
export type TimeRange = "3min" | "5min" | "15min" | "30min" | "1hr" | "2hr" | "all";
export type IndexType = "NIFTY" | "BANKNIFTY" | "MIDCPNIFTY" | "SENSEX";
export type ModeType = "Live" | "Historical";

export function OIAnalysisDashboard() {
  const [strikeFilter, setStrikeFilter] = useState<StrikeFilter>("10");
  const [selectedMode, setSelectedMode] = useState<ModeType>("Live");
  const [timeRange, setTimeRange] = useState<TimeRange>("15min");
  const [selectedIndex, setSelectedIndex] = useState<IndexType>("NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState("30 Jun 2026 (4d)");

  // Generate mock data based on filters
  const oiData = useMemo(() => {
    const strikeCount = strikeFilter === "All" ? 30 : strikeFilter === "ATM" ? 1 : parseInt(strikeFilter) * 2;
    return generateMockOIData(strikeCount, selectedIndex);
  }, [strikeFilter, selectedIndex]);

  // Calculate totals
  const totals = useMemo(() => {
    const totalCallOI = oiData.reduce((sum, d) => sum + d.callOI, 0);
    const totalPutOI = oiData.reduce((sum, d) => sum + d.putOI, 0);
    const callChange = oiData.reduce((sum, d) => sum + d.callOIIncrease - d.callOIDecrease, 0);
    const putChange = oiData.reduce((sum, d) => sum + d.putOIIncrease - d.putOIDecrease, 0);
    const pcr = totalPutOI / totalCallOI;
    const pcrChange = -0.06; // Mock
    const pcrOIChange = 0.57; // Mock

    return {
      totalCallOI,
      totalPutOI,
      callChange,
      putChange,
      pcr,
      pcrChange,
      pcrOIChange,
    };
  }, [oiData]);

  // Calculate sentiment
  const sentiment = useMemo(() => {
    const { pcr } = totals;
    if (pcr > 1.2) return { type: "Bearish" as const, bullishPercent: 30, bearishPercent: 70 };
    if (pcr < 0.8) return { type: "Bullish" as const, bullishPercent: 70, bearishPercent: 30 };
    return { type: "Neutral" as const, bullishPercent: 50, bearishPercent: 50 };
  }, [totals]);

  return (
    <div className="flex gap-5 relative">
      {/* Left Sidebar */}
      <OISidebar
        strikeFilter={strikeFilter}
        onStrikeFilterChange={setStrikeFilter}
        selectedMode={selectedMode}
        onModeChange={setSelectedMode}
        selectedIndex={selectedIndex}
        onIndexChange={setSelectedIndex}
        selectedExpiry={selectedExpiry}
        onExpiryChange={setSelectedExpiry}
        sentiment={sentiment}
        pcr={totals.pcr}
        pcrChange={totals.pcrChange}
        pcrOIChange={totals.pcrOIChange}
      />

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {/* Main Chart */}
        <OIMainChart
          data={oiData}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />

        {/* Bottom Panels */}
        <div className="mt-5">
          <OIBottomPanels
            callChange={totals.callChange}
            putChange={totals.putChange}
            totalCallOI={totals.totalCallOI}
            totalPutOI={totals.totalPutOI}
            pcr={totals.pcr}
          />
        </div>
      </div>
    </div>
  );
}
