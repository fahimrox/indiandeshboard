import { createFileRoute } from "@tanstack/react-router";
import { DashboardShell } from "@/components/DashboardShell";
import { Activity } from "lucide-react";

export const Route = createFileRoute("/fno")({
  head: () => ({ meta: [{ title: "F&O Trade Flow | IndexMover" }] }),
  component: Page,
  errorComponent: ({ error }) => <div className="p-8 text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

function Page() {
  return (
    <DashboardShell title="F&O Trade Flow" subtitle="Futures & options activity">
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <Activity className="mx-auto h-10 w-10 text-[var(--neon)]" />
        <div className="mt-4 text-lg font-semibold">F&O data coming soon</div>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Free F&O option chain feeds require an NSE session/cookie. Yeh integrate karne ke liye
          ek server-side scraper add karna padega — bolo to wo bhi laga deta hoon.
        </p>
      </div>
    </DashboardShell>
  );
}
