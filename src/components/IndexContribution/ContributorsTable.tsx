import { fmt } from "@/components/MarketBits";

export type ContributorRow = {
    rank: number;
    symbol: string;
    price: number;
    changePct: number;
    contributionPct: number;
};

function ContributionBar({ value }: { value: number }) {
    const abs = Math.abs(value);
    const max = 20; // visual scaling only; bar width based on contribution magnitude
    const w = Math.min(100, (abs / max) * 100);

    const isPos = value >= 0;

    return (
        <div className="min-w-0">
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <div className="h-5 bg-background/40 border border-border/60 overflow-hidden">
                        <div
                            className={`h-full ${isPos ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
                            style={{ width: `${w}%`, borderRadius: 0 }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

function BarsCell({ value }: { value: number }) {
    const abs = Math.abs(value);
    return (
        <div className="min-w-[180px]">
            <div className="flex items-center gap-3">
                <div className="flex-1">
                    <div className="h-4 bg-background/50 border border-border/60 overflow-hidden">
                        <div
                            className={`h-full ${value >= 0 ? "bg-[var(--bull)]" : "bg-[var(--bear)]"}`}
                            style={{ width: `${Math.min(100, (abs / 20) * 100)}%`, borderRadius: 0 }}
                        />
                    </div>
                </div>
                <div
                    className={`w-[68px] text-right font-mono text-xs tabular-nums ${value >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]"
                        }`}
                >
                    {value >= 0 ? "+" : "-"}
                    {fmt(abs, 1)}%
                </div>
            </div>
        </div>
    );
}

export function ContributorsTable({
    title,
    tone,
    rows,
}: {
    title: string;
    tone: "positive" | "negative";
    rows: ContributorRow[];
}) {
    const toneIsPos = tone === "positive";

    return (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-background/60">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                    {title}
                </div>
            </div>

            <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-background/80">
                        <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            <th className="text-left px-4 py-2">Rank</th>
                            <th className="text-left px-4 py-2">Symbol</th>
                            <th className="text-right px-4 py-2">Price</th>
                            <th className="text-right px-4 py-2">Change %</th>
                            <th className="text-left px-4 py-2">Contribution %</th>
                        </tr>
                    </thead>

                    <tbody>
                        {rows.map((r, idx) => {
                            const up = r.changePct >= 0;
                            const contribPos = r.contributionPct >= 0;

                            const changeClass = up ? "text-[var(--bull)]" : "text-[var(--bear)]";
                            const contribClass = contribPos ? "text-[var(--bull)]" : "text-[var(--bear)]";

                            return (
                                <tr
                                    key={r.symbol}
                                    className={`border-b border-border/30 ${idx % 2 === 0 ? "bg-card/40" : "bg-card/20"
                                        } hover:bg-card/70`}
                                >
                                    <td className="px-4 py-2 text-muted-foreground">{r.rank}</td>
                                    <td className="px-4 py-2 font-semibold">{r.symbol}</td>
                                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                                        {fmt(r.price, 2)}
                                    </td>
                                    <td className={`px-4 py-2 text-right font-mono tabular-nums ${changeClass}`}>
                                        {r.changePct >= 0 ? "+" : "-"}
                                        {fmt(Math.abs(r.changePct), 2)}%
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className={contribClass}>
                                            <BarsCell value={r.contributionPct} />
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="px-4 py-2 border-t border-border/50">
                <div className="text-[11px] text-muted-foreground">
                    Bars show contribution magnitude (rectangular sharp bars, terminal theme).
                </div>
            </div>
        </div>
    );
}
