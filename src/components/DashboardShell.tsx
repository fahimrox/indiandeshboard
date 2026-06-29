import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Flame,
  Filter,
  ListTree,
  TrendingUp,
  Settings,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Globe,
  Wrench,
  Newspaper,
  ChevronDown,
  Layers,
  FlaskConical,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { isMarketOpenIst } from "@/lib/market-hours";
import { TopTicker } from "@/components/TopTicker/TopTicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSettingsStatus,
  saveFyersTokenFn,
  type SettingsStatus,
} from "@/lib/services/settings.functions";
import { toast } from "sonner";

type NavItem = { to: string; label: string };
type NavGroup = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  comingSoon?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Index Lab",
    icon: TrendingUp,
    items: [
      { to: "/", label: "Overview" },
      { to: "/nifty50", label: "NIFTY 50" },
      { to: "/banknifty", label: "BANK NIFTY" },
      { to: "/sensex", label: "SENSEX" },
      { to: "/index-contribution", label: "Index Contribution" },
    ],
  },
  {
    label: "F&O Lab",
    icon: Activity,
    items: [
      { to: "/future-dashboard", label: "Future Dashboard" },
      { to: "/fno", label: "F&O Stocks" },
      { to: "/fnoboard", label: "F&O Board" },
    ],
  },
  {
    label: "Option Lab",
    icon: ListTree,
    items: [
      { to: "/optionchain", label: "Option Chain" },
      { to: "/oi-analysis", label: "OI Analysis" },
    ],
  },
  {
    label: "Screener Lab",
    icon: Filter,
    items: [{ to: "/screener", label: "Screener" }],
  },
  {
    label: "Sector Lab",
    icon: Flame,
    items: [{ to: "/heatmap", label: "Sector Heatmap" }],
  },
  {
    label: "AI Lab",
    icon: Sparkles,
    items: [
      { to: "/ai-analysis", label: "AI Analysis" },
    ],
  },
  { label: "Global Lab", icon: Globe, items: [], comingSoon: true },
  { label: "Chart Lab", icon: BarChart3, items: [], comingSoon: true },
  { label: "Tool Lab", icon: Wrench, items: [], comingSoon: true },
  { label: "News Lab", icon: Newspaper, items: [], comingSoon: true },
];

// ─── Single Lab Dropdown Button (click-based, reliable) ──────────────────────
function NavGroupButton({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = group.icon;

  const isActive = group.items.some((item) =>
    item.to === "/"
      ? pathname === "/"
      : pathname === item.to || pathname.startsWith(item.to + "/")
  );

  const canOpen = !group.comingSoon && group.items.length > 0;

  if (!canOpen) {
    return (
      <div className="relative">
        <button
          type="button"
          disabled
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all select-none text-sidebar-foreground/35 cursor-default"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-nowrap">{group.label}</span>
          {group.comingSoon && (
            <span className="ml-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-border/60 text-muted-foreground/60">
              Soon
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all select-none cursor-pointer ${isActive
                ? "bg-[var(--neon)]/15 text-[var(--neon)] ring-1 ring-[var(--neon)]/30"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{group.label}</span>
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""
                }`}
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className="w-[180px] bg-sidebar border border-border p-1.5 shadow-2xl rounded-xl z-50"
          align="start"
          sideOffset={6}
        >
          {group.items.map((item) => {
            const itemActive =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(item.to + "/");

            return (
              <DropdownMenuItem
                key={item.to}
                asChild
                className="p-0 focus:bg-transparent"
              >
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors w-full cursor-pointer ${itemActive
                      ? "bg-[var(--neon)]/15 text-[var(--neon)]"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${itemActive ? "bg-[var(--neon)]" : "bg-transparent"
                      }`}
                  />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────
export function DashboardShell({
  children,
  title,
  subtitle,
  updatedAt,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  updatedAt?: number;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [marketOpen, setMarketOpen] = useState(() => isMarketOpenIst());

  // Settings State
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [fyersTokenInput, setFyersTokenInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setMarketOpen(isMarketOpenIst()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fetchStatus = async () => {
    setStatusLoading(true);
    try {
      const data = await getSettingsStatus();
      setStatus(data);
    } catch (err: any) {
      toast.error(`Failed to fetch API status: ${err.message}`);
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    if (settingsOpen) {
      fetchStatus();
    }
  }, [settingsOpen]);

  const handleSaveFyers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fyersTokenInput.trim()) {
      toast.error("Please enter a valid token.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveFyersTokenFn({ data: { token: fyersTokenInput.trim() } });
      if (res.success) {
        toast.success("FYERS Access Token saved successfully!");
        setFyersTokenInput("");
        await fetchStatus();
      }
    } catch (err: any) {
      toast.error(`Failed to save FYERS token: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Live Market Ticker ──────────────────────────────────────────── */}
      <TopTicker />

      {/* ── Top Nav Bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5">

          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5 mr-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--neon)]/15 ring-1 ring-[var(--neon)]/40">
              <FlaskConical className="h-4 w-4 text-[var(--neon)]" />
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-bold tracking-tight">Market Dashboard</div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
                Indian Market Intelligence
              </div>
            </div>
          </Link>

          {/* Separator */}
          <div className="hidden sm:block h-6 w-px bg-border/60 mx-1" />

          {/* Lab Nav Groups */}
          <nav
            className="flex flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide"
            aria-label="Main navigation"
          >
            {NAV_GROUPS.map((group) => (
              <NavGroupButton
                key={group.label}
                group={group}
                pathname={pathname}
              />
            ))}
          </nav>

          {/* Right: Market status + Settings */}
          <div className="flex shrink-0 items-center gap-2 ml-2">
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${marketOpen
                  ? "animate-pulse bg-[var(--neon)]"
                  : "bg-muted-foreground"
                  }`}
              />
              <span className="text-muted-foreground whitespace-nowrap">
                {marketOpen ? "Live" : "Market Closed"}
              </span>
            </div>

            {/* API Settings Modal */}
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg cursor-pointer"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[480px] bg-card border border-border text-foreground">
                <DialogHeader>
                  <DialogTitle className="text-lg font-bold">
                    API Configurations
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Monitor connection health and configure broker access tokens
                    securely.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* Status Indicators */}
                  <div className="rounded-xl border border-border bg-background/50 p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <span>Broker Connection Status</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 cursor-pointer"
                        onClick={fetchStatus}
                        disabled={statusLoading}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${statusLoading ? "animate-spin" : ""}`}
                        />
                      </Button>
                    </div>

                    {statusLoading && !status ? (
                      <div className="text-xs text-muted-foreground animate-pulse">
                        Checking status...
                      </div>
                    ) : status ? (
                      <div className="space-y-2.5">
                        {/* Upstox */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">
                            Upstox (Primary quotes)
                          </span>
                          <div className="flex items-center gap-1.5">
                            {!status.upstox.configured ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5" /> Missing Env
                              </span>
                            ) : status.upstox.ok ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300"
                                title={status.upstox.error}
                              >
                                <XCircle className="h-3.5 w-3.5" /> Error
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Angel One */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">Angel One (Backup)</span>
                          <div className="flex items-center gap-1.5">
                            {!status.angelOne.configured ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5" /> Missing Env
                              </span>
                            ) : status.angelOne.ok ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300"
                                title={status.angelOne.error}
                              >
                                <XCircle className="h-3.5 w-3.5" /> Error
                              </span>
                            )}
                          </div>
                        </div>

                        {/* FYERS */}
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">FYERS (Option chain)</span>
                          <div className="flex items-center gap-1.5">
                            {!status.fyers.configured ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                                <AlertTriangle className="h-3.5 w-3.5" /> Missing Token
                              </span>
                            ) : status.fyers.ok ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300"
                                title={status.fyers.error}
                              >
                                <XCircle className="h-3.5 w-3.5" />{" "}
                                {status.fyers.isExpired ? "Expired" : "Error"}
                              </span>
                            )}
                          </div>
                        </div>
                        {status.fyers.maskedToken && (
                          <div className="text-[11px] text-muted-foreground font-mono mt-1">
                            Current Token: {status.fyers.maskedToken}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Fyers Token Form */}
                  <form onSubmit={handleSaveFyers} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label
                        htmlFor="fyersToken"
                        className="text-xs font-semibold"
                      >
                        Paste FYERS Access Token
                      </Label>
                      <Input
                        id="fyersToken"
                        type="password"
                        value={fyersTokenInput}
                        onChange={(e) => setFyersTokenInput(e.target.value)}
                        placeholder="Enter manually generated access token..."
                        className="bg-background border-border text-foreground text-xs h-9 focus:border-[var(--neon)] focus:ring-1 focus:ring-[var(--neon)]"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full text-xs font-bold h-9 bg-[var(--neon)] hover:bg-[var(--neon)]/90 text-background cursor-pointer"
                      disabled={saving}
                    >
                      {saving ? "Saving & Testing..." : "Save & Verify Connection"}
                    </Button>
                  </form>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      {title && (
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-background/70 px-6 py-4 backdrop-blur">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {updatedAt && (
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${marketOpen
                ? "animate-pulse bg-[var(--neon)]"
                : "bg-muted-foreground"
                }`}
            />
            <span className="text-muted-foreground">
              {marketOpen ? "Updated" : "Last update"}
            </span>
            <span
              className="font-mono text-foreground"
              suppressHydrationWarning
            >
              {new Date(updatedAt).toLocaleTimeString("en-IN", {
                timeZone: "Asia/Kolkata",
              })}{" "}
              IST
            </span>
          </div>
        )}
      </header>
      )}

      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
