import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { OIAnalysisDashboard } from "@/components/OIAnalysis/OIAnalysisDashboard";

function Page() {
  return (
    <DashboardShell
      title="OI Analysis"
      subtitle="Professional Open Interest Analysis Dashboard"
    >
      <OIAnalysisDashboard />
    </DashboardShell>
  );
}

export const Route = createFileRoute("/oi-analysis")({
  head: () => ({
    meta: [
      {
        title: "OI Analysis — Professional Open Interest Dashboard | Market Analytics",
      },
      {
        name: "description",
        content:
          "Professional NIFTY options OI analysis with 6-bar visualization, sentiment indicators, PCR analysis, and real-time market insights.",
      },
    ],
  }),
  component: Page,
});
