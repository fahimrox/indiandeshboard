import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BarChart3, Flame, LineChart, TrendingUp, Wallet } from "lucide-react";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Index Dashboard", icon: LineChart },
  { to: "/nifty50", label: "NIFTY 50", icon: TrendingUp },
  { to: "/banknifty", label: "BANK NIFTY", icon: Wallet },
  { to: "/sensex", label: "SENSEX", icon: BarChart3 },
  { to: "/fno", label: "F&O Trade Flow", icon: Activity },
  { to: "/heatmap", label: "Sector Heatmap", icon: Flame },
] as const;

export function DashboardShell({
  children,
  title,
  subtitle,
  updatedAt,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  updatedAt?: number;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--neon)]/15 ring-1 ring-[var(--neon)]/40">
            <TrendingUp className="h-5 w-5 text-[var(--neon)]" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">IndexMover</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Market Intelligence
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-[var(--neon)]/15 text-[var(--neon)] ring-1 ring-[var(--neon)]/30"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-sidebar-border p-3 text-xs text-muted-foreground">
          <div className="mb-1 flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--neon)]" />
            <span className="font-semibold text-foreground">Live Feed</span>
          </div>
          Auto-refresh every 30s. Source: Yahoo Finance (free).
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background/70 px-6 py-5 backdrop-blur">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {updatedAt && (
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--neon)]" />
              <span className="text-muted-foreground">Updated</span>
              <span className="font-mono text-foreground">
                {new Date(updatedAt).toLocaleTimeString("en-IN")}
              </span>
            </div>
          )}
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
