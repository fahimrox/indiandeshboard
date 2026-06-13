import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Flame,
  Filter,
  LineChart,
  Layers,
  ListTree,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isMarketOpenIst } from "@/lib/market-hours";

const NAV = [
  { to: "/", label: "Dashboard", icon: LineChart },
  { to: "/nifty50", label: "NIFTY 50", icon: TrendingUp },
  { to: "/banknifty", label: "BANK NIFTY", icon: Wallet },
  { to: "/sensex", label: "SENSEX", icon: BarChart3 },
  { to: "/fno", label: "F&O Stocks", icon: Activity },
  { to: "/screener", label: "Screener", icon: Filter },
  { to: "/optionchain", label: "Option Chain", icon: ListTree },
  { to: "/heatmap", label: "Sector Heatmap", icon: Flame },
  { to: "/fnoboard", label: "F&O Board", icon: Layers },
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
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpenIst());

  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketOpenIst()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-40 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--neon)]/15 ring-1 ring-[var(--neon)]/40">
              <TrendingUp className="h-5 w-5 text-[var(--neon)]" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold tracking-tight">IndexMover</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Market Intelligence
              </div>
            </div>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const active =
                item.to === "/"
                  ? pathname === "/"
                  : pathname === item.to || pathname.startsWith(item.to + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${
                    active
                      ? "bg-[var(--neon)]/15 text-[var(--neon)] ring-1 ring-[var(--neon)]/30"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="hidden lg:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${marketOpen ? "animate-pulse bg-[var(--neon)]" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground">{marketOpen ? "Live" : "Market Closed"}</span>
          </div>
        </div>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background/70 px-6 py-4 backdrop-blur">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {updatedAt && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <span className={`h-2 w-2 rounded-full ${marketOpen ? "animate-pulse bg-[var(--neon)]" : "bg-muted-foreground"}`} />
            <span className="text-muted-foreground">{marketOpen ? "Updated" : "Last update"}</span>
            <span className="font-mono text-foreground">
              {new Date(updatedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })} IST
            </span>
          </div>
        )}
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
