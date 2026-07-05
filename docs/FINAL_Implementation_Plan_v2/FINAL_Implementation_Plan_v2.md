# Implementation Plan — Distributed Market Data Architecture (Final v2)

**Status**: Ready for implementation
**Target**: Multi-broker orchestrator with granular fallback, SENSEX integration
**Implementer**: Gemini (project AI)

---

## Context & Confirmed Facts (from live system)

| Broker | Role | Token Behavior | Refresh Strategy Needed? |
|---|---|---|---|
| **Upstox** | Primary — Cash quotes, Watchlist, Heatmap | Valid ~1 year | No — non-issue |
| **Angel One** | Primary — Futures OI, F&O Scanner; Backup — Options | Auto-login on dashboard open | Already handled — just need concurrency lock |
| **FYERS** | Primary — Option Chain, Greeks, IV, PCR, Max Pain | Expires daily; manually refreshed by user; UI already shows yellow "Expired" badge | Keep manual (Phase 5 optional: automate later) |
| **Yahoo Finance** | Backup/EOD only | N/A | Used only when primary+backup fail, or after market hours |
| **NSE Scraper** | Backup/EOD only (Options) | N/A | Used only as last-resort options fallback, or EOD/weekend snapshot |

**Critical open question to verify during Phase 3 testing**: Does Option Chain currently go fully dead when FYERS expires, or is there already a partial fallback? This determines real-world urgency of the fallback chain — treat as highest-priority test case.

---

## Goals

1. Replace MIDCAPNIFTY with SENSEX as third primary index across all services.
2. Route each data category to its strongest broker (feature-based primary routing).
3. Implement **granular** (per-feature) fallback — one broker's failure must never freeze unrelated widgets.
4. Wrap all data responses in a standard metadata envelope so the UI always knows: which source served this data, and whether it's live/fallback/cached.
5. Add a lightweight circuit breaker so a struggling broker doesn't slow down the whole UI with repeated timeouts.
6. Keep Yahoo Finance and NSE Scraper strictly as backup/EOD sources — never primary.
7. Do this in isolated phases so any regression is easy to trace and roll back.

---

## Architecture Overview

```
                    ┌─────────────────────────────┐
                    │   MarketData Orchestrator    │
                    │      (marketDataLayer.ts)    │
                    └──────────────┬───────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
   CASH QUOTES                FUTURES/OI                 OPTIONS/GREEKS
   Primary: Upstox            Primary: Angel One          Primary: FYERS
   Fallback: Yahoo            Fallback: (none configured   Fallback 1: Angel One
                               yet — see note below)        Fallback 2: NSE Scraper
                                                             Ultimate: Cache/Synthetic (EOD)
```

**Note**: Original plan doesn't specify a Futures/OI fallback chain. Recommend adding: Angel One (primary) → NSE Scraper (backup) → Cache (EOD), for consistency with the Options fallback pattern.

---

## Phase 1 — Foundation (Zero Risk, No Behavior Change)

**Goal**: Build the pieces without touching any existing routing logic.

### 1.1 Symbol Mapper Module
New file: `symbolMapper.ts`

```typescript
export type StandardSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type BrokerName = "upstox" | "angelone" | "fyers" | "yahoo" | "nse";

const symbolMap: Record<StandardSymbol, Record<BrokerName, string>> = {
  NIFTY: {
    upstox: "NSE_INDEX|Nifty 50",
    angelone: "NIFTY", // token 99926000
    fyers: "NSE:NIFTY50-INDEX",
    yahoo: "^NSEI",
    nse: "NIFTY",
  },
  BANKNIFTY: {
    upstox: "NSE_INDEX|Nifty Bank",
    angelone: "BANKNIFTY", // token 99926009
    fyers: "NSE:NIFTYBANK-INDEX",
    yahoo: "^NSEBANK",
    nse: "BANKNIFTY",
  },
  SENSEX: {
    upstox: "BSE_INDEX|SENSEX",
    angelone: "SENSEX", // token 99919000
    fyers: "BSE:SENSEX-INDEX",
    yahoo: "^BSESN",
    nse: "SENSEX",
  },
};

export function resolveSymbol(standard: StandardSymbol, broker: BrokerName): string {
  const resolved = symbolMap[standard]?.[broker];
  if (!resolved) {
    throw new Error(`No symbol mapping for ${standard} on ${broker}`);
  }
  return resolved;
}
```

**Rest of codebase should only ever use `NIFTY | BANKNIFTY | SENSEX`** — never a raw broker-specific string directly.

### 1.2 Data Lineage Type
New file (or add to shared types): `types/dataLineage.ts`

```typescript
export interface DataLineage {
  source: "upstox" | "angelone" | "fyers" | "yahoo" | "nse" | "cache" | "synthetic";
  status: "live" | "fallback" | "cached" | "expired_token";
  timestamp: number;
  latencyMs?: number;
}

export interface EnvelopedResponse<T> {
  data: T;
  _metadata: DataLineage;
}
```

### 1.3 SENSEX Config Everywhere
- `upstoxService.ts`: add `SENSEX ➔ BSE_INDEX|SENSEX` to `STATIC_INDEX_MAP`
- `angelOneService.ts`: update `loadScripMaster()` to also fetch SENSEX BSE contracts; add cache-invalidation check (re-download if SENSEX contracts missing from cached scrip master JSON)
- `fyersService.ts`: add `SENSEX: "BSE:SENSEX-INDEX"` to `FYERS_INDEX_MAP`
- Remove all `MIDCAPNIFTY` references across the codebase (grep and clean)

**Deliverable for Phase 1**: These modules exist and are unit-testable in isolation. Nothing in the live dashboard changes yet.

---

## Phase 2 — Wrap Existing Calls (Low Risk)

**Goal**: Add circuit breaker + metadata envelope around current service calls, without changing which broker serves which feature yet.

### 2.1 Circuit Breaker
New file: `circuitBreaker.ts`

```typescript
interface BreakerState {
  failureCount: number;
  disabledUntil: number | null; // epoch ms
}

const breakers = new Map<BrokerName, BreakerState>();

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function isBrokerAvailable(broker: BrokerName): boolean {
  const state = breakers.get(broker);
  if (!state?.disabledUntil) return true;
  if (Date.now() > state.disabledUntil) {
    breakers.delete(broker); // cooldown expired, reset
    return true;
  }
  return false;
}

export function recordFailure(broker: BrokerName) {
  const state = breakers.get(broker) ?? { failureCount: 0, disabledUntil: null };
  state.failureCount += 1;
  if (state.failureCount >= FAILURE_THRESHOLD) {
    state.disabledUntil = Date.now() + COOLDOWN_MS;
  }
  breakers.set(broker, state);
}

export function recordSuccess(broker: BrokerName) {
  breakers.delete(broker); // reset on any success
}
```

**Known limitation (accepted for now)**: in-memory only, single-instance. Fine for current deployment. Flag as a TODO for later if the app moves to serverless/multi-instance.

### 2.2 Angel One Session Concurrency Fix
In `angelOneService.ts`:

```typescript
let loginPromise: Promise<Session> | null = null;

export async function login(): Promise<Session> {
  if (loginPromise) return loginPromise; // reuse in-flight login
  loginPromise = performLogin().finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}
```

This prevents duplicate concurrent logins on dashboard open — directly addresses the confirmed auto-login-on-open behavior.

### 2.3 Angel One Domain/Endpoint Fix
- Change base domain: `apiconnect.angelbroking.com` → `apiconnect.angelone.in`
- Replace `/marketData` → `/quote`

### 2.4 FYERS Auth-Only Expiry Detection
In `fyersService.ts`, update the error handler so `markFyersExpired()` only fires on genuine auth failures:

```typescript
function isAuthError(error: any): boolean {
  const status = error?.response?.status;
  const message = (error?.message || "").toLowerCase();
  return status === 401 || ["auth", "token", "session", "expire"].some(kw => message.includes(kw));
}

// In catch block:
if (isAuthError(error)) {
  markFyersExpired(); // triggers the yellow "Expired" badge in UI
} else {
  throw error; // e.g. invalid symbol — don't falsely disable the whole service
}
```

This keeps the existing yellow-badge UX intact but stops unrelated errors from incorrectly flagging FYERS as expired.

**Deliverable for Phase 2**: Every broker call now goes through the circuit breaker and returns a `DataLineage` envelope. Routing is still unchanged — this phase is purely instrumentation.

---

## Phase 3 — Actual Routing & Fallback Chains (Highest Risk — do last, test thoroughly)

### 3.1 Orchestrator Routing Table

```typescript
type FeatureCategory = "quotes" | "futuresOI" | "optionChain";

const routingConfig: Record<FeatureCategory, BrokerName[]> = {
  quotes:      ["upstox", "yahoo"],                    // Yahoo = backup/EOD only
  futuresOI:   ["angelone", "nse"],                     // NSE = backup/EOD only
  optionChain: ["fyers", "angelone", "nse"],            // Angel = live backup, NSE = last resort/EOD
};
```

### 3.2 Orchestrator Fetch Logic (pseudocode)

```typescript
async function fetchWithFallback<T>(
  category: FeatureCategory,
  standardSymbol: StandardSymbol,
  fetchers: Record<BrokerName, (symbol: string) => Promise<T>>
): Promise<EnvelopedResponse<T>> {
  const chain = routingConfig[category];

  for (let i = 0; i < chain.length; i++) {
    const broker = chain[i];
    if (!isBrokerAvailable(broker)) continue; // circuit breaker tripped, skip

    try {
      const symbol = resolveSymbol(standardSymbol, broker);
      const start = Date.now();
      const data = await fetchers[broker](symbol);
      recordSuccess(broker);

      return {
        data,
        _metadata: {
          source: broker,
          status: i === 0 ? "live" : "fallback",
          timestamp: Date.now(),
          latencyMs: Date.now() - start,
        },
      };
    } catch (err) {
      recordFailure(broker);
      // continue to next in chain
    }
  }

  // All brokers exhausted — try persistent EOD cache
  const cached = await getCachedSnapshot(category, standardSymbol);
  if (cached) {
    return { data: cached, _metadata: { source: "cache", status: "cached", timestamp: Date.now() } };
  }

  throw new Error(`All sources exhausted for ${category}/${standardSymbol}`);
}
```

### 3.3 Market-Hours Awareness (EOD Handling)
Before hitting live brokers at all, check market hours:

```typescript
function isMarketOpen(): boolean {
  const now = new Date(); // convert to IST
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const hour = now.getHours();
  const min = now.getMinutes();
  const afterOpen = hour > 9 || (hour === 9 && min >= 15);
  const beforeClose = hour < 15 || (hour === 15 && min <= 30);
  return afterOpen && beforeClose;
}
```

If `!isMarketOpen()`, orchestrator should skip live broker calls entirely and serve directly from EOD cache (Yahoo/NSE snapshot saved at 3:30 PM) — saves unnecessary API calls on closed days.

### 3.4 Sanity Check (recommended addition)
Before returning any quote data, add a lightweight guard against garbage ticks:

```typescript
function isSaneQuote(newPrice: number, lastKnownPrice: number | null): boolean {
  if (!lastKnownPrice) return true; // no baseline yet, accept
  const pctChange = Math.abs(newPrice - lastKnownPrice) / lastKnownPrice;
  return pctChange < 0.05; // reject >5% single-tick jump as likely bad data
}
```

If a tick fails this check, discard it and serve last-known-good value instead, tagged `status: "cached"`.

---

## Phase 4 — UI Integration

### 4.1 Status Indicator Component
Extend the existing "API Configurations" panel (already has broker connection status) to also surface **per-feature** live status, not just per-broker connection:

```
BROKER CONNECTION STATUS          (existing — keep as-is)
  Upstox (Primary quotes)    ✅ Connected
  Angel One (Backup)         ✅ Connected
  FYERS (Option chain)       ⚠️ Expired

FEATURE STATUS                    (new — add this)
  Cash Quotes        🟢 Live (Upstox)
  Futures OI          🟢 Live (Angel One)
  Option Chain         🟡 Fallback (Angel One) — FYERS token expired
```

This directly answers the open question from earlier: when FYERS expires, the UI should now explicitly show that Option Chain is running on fallback, not just that FYERS itself shows "Expired" in isolation.

### 4.2 Data Freshness Badge (optional, small addition)
On each widget, a tiny badge using `_metadata.status`:
- `live` → green dot
- `fallback` → yellow dot + tooltip "via {source}"
- `cached` → grey dot + tooltip "Last updated {time}"

---

## Verification Plan

### Automated Tests
```bash
npx tsx --env-file=.env test_option_chain.ts
```
- Verify NIFTY, BANKNIFTY, SENSEX all resolve correctly.
- Mock-disable FYERS → confirm fallback to Angel One → confirm fallback to NSE Scraper if Angel also mocked-down.
- **Critical test**: simulate FYERS token expiry exactly as it happens in production (daily) — confirm Option Chain does NOT go fully dead, and UI shows "Fallback (Angel One)" status.

```bash
npx tsx --env-file=.env test_get_quotes.ts
```
- Verify Upstox serves quotes for all 3 indices.
- Mock-disable Upstox → confirm seamless Yahoo fallback (and confirm this only triggers, not used as default).

### Manual Verification
1. `npm run dev`, confirm Dashboard/Heatmap/Option Chain show SENSEX (not MIDCAPNIFTY).
2. Open API Configurations panel — confirm new Feature Status section reflects real broker states.
3. Force FYERS into expired state (or wait for natural daily expiry) — confirm:
   - Yellow "Expired" badge still shows (existing behavior preserved)
   - Option Chain continues serving data via Angel One fallback
   - Feature Status shows "Fallback (Angel One)"
4. Test after 3:30 PM / on a weekend — confirm system serves cached EOD data without hitting live broker APIs.
5. Open multiple tabs simultaneously — confirm Angel One doesn't throw concurrent-login errors (validates the `loginPromise` fix).

---

## Explicit Non-Goals (For This Iteration)

- **FYERS auto-login/TOTP automation** — not included. Manual daily token entry stays as-is since it already works and has UI visibility. Can be revisited as a future Phase 5 if desired.
- **Redis-backed distributed circuit breaker** — not needed at current single-instance scale. Note as future TODO only if deployment moves to multi-instance/serverless.
- **WebSocket live ticks** — not part of this plan. Current polling-based approach stays; WebSocket integration should be a separate, later initiative.
- **Alerting/monitoring (Slack/Telegram)** — not included now. Console/log-based visibility is sufficient for current stage.

---

## Summary of Changes by File

| File | Change |
|---|---|
| `symbolMapper.ts` | **New** — central symbol translation |
| `types/dataLineage.ts` | **New** — response envelope types |
| `circuitBreaker.ts` | **New** — in-memory failure tracking |
| `marketDataLayer.ts` | **Modify** — orchestrator routing table + fallback logic + market-hours check |
| `upstoxService.ts` | **Modify** — SENSEX symbol map, lineage wrapping |
| `angelOneService.ts` | **Modify** — domain fix, `/quote` endpoint, loginPromise concurrency fix, SENSEX scrip master support |
| `fyersService.ts` | **Modify** — auth-only expiry detection, SENSEX index map |
| `DashboardShell.tsx` (or API config panel component) | **Modify** — add Feature Status section alongside existing Broker Connection Status |

---

## Rollout Order (repeat for clarity)

```
1. Phase 1 (Foundation)         → merge, zero visible change
2. Phase 2 (Wrap existing)       → merge, instrumentation only, zero visible change
3. Phase 3 (Routing + fallback)  → merge behind a feature flag if possible:
                                    USE_ORCHESTRATOR_ROUTING=true/false
4. Phase 4 (UI status)           → merge last, purely additive UI
```

If a feature flag isn't trivial to add given current architecture, at minimum keep Phase 3 as its own isolated commit/PR so it can be reverted independently of Phases 1, 2, and 4.

---

**This plan is ready to hand off for implementation.**
