import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import OiProPage from "@/features/oi-analysis-pro/OiProPage";

function Page() {
  return (
    <DashboardShell>
      <OiProPage />
    </DashboardShell>
  );
}

export const Route = createFileRoute("/oi-analysis-pro")({
  head: () => ({
    meta: [
      {
        title: "AI Option Radar — OI Analysis Pro | NIFTY · BANKNIFTY · SENSEX",
      },
      {
        name: "description",
        content:
          "AI-powered index option-interest intelligence: sentiment verdict, PCR, max pain, support/resistance walls, OI buildup and full option chain for NIFTY, BANK NIFTY and SENSEX.",
      },
    ],
  }),
  component: Page,
});
