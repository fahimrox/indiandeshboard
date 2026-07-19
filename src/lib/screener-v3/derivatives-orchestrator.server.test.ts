// Phase 2B Part 3 — derivatives orchestrator tests. Fake provider + the REAL
// Part 3 cache + injected reference time. No live network, no real token, no
// timers/sleeps, no machine clock. Deterministic universe fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDerivativesOrchestrator,
  assertValidOrchestratorPolicy,
  type DerivativesOrchestratorPolicy,
  type DerivativesEnrichmentRequest,
} from "./derivatives-orchestrator.server.ts";
import { createDerivativesCache, type DerivativesCachePolicy } from "./derivatives-cache.server.ts";
import type { UpstoxDerivativesProvider, OptionGreekRequest } from "./derivatives-provider.server.ts";
import { ok, unavailable, providerError, isOk, type DataResult } from "./types.ts";
import type {
  FnoInstrumentUniverse,
  FnoUnderlyingInstrument,
  FuturesContract,
  OptionContract,
  OptionType,
} from "./instrument-types.ts";
import type { FuturesMarketSnapshot, OptionMarketSnapshot } from "./derivatives-types.ts";
import type { SelectedAtmPair } from "./derivatives-selectors.ts";

// ── Time / expiry constants ──────────────────────────────────────────────────
function istEpoch(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 3_600_000;
}
const REF = istEpoch(2026, 7, 17, 10, 0, 0); // Friday, in-session
const EXP_CUR = istEpoch(2026, 7, 28);
const EXP_CUR_D = "2026-07-28";
const EXP_LATER = istEpoch(2026, 8, 25);
const EXP_LATER_D = "2026-08-25";

const CACHE_POLICY: DerivativesCachePolicy = {
  freshTtlMs: 1_000,
  staleTtlMs: 5_000,
  unavailableTtlMs: 500,
  maxEntries: 10_000,
};
function policy(over: Partial<DerivativesOrchestratorPolicy> = {}): DerivativesOrchestratorPolicy {
  return { maxOptionChainRequestsPerBatch: 10, optionChainConcurrency: 2, cachePolicy: CACHE_POLICY, ...over };
}

// ── Universe fixtures ────────────────────────────────────────────────────────
function fut(key: string, expiryDateIst: string, expiryMs: number): FuturesContract {
  return { instrumentKey: key, tradingSymbol: `FUT ${key}`, expiry: expiryMs, expiryDateIst, lotSize: 500, weekly: false, exchangeToken: "" };
}
function opt(key: string, strike: number, type: OptionType, expiryDateIst: string, expiryMs: number): OptionContract {
  return { instrumentKey: key, tradingSymbol: `${strike}${type}`, expiry: expiryMs, expiryDateIst, strike, optionType: type, lotSize: 500 };
}
function underlying(
  sym: string,
  o: { futures?: FuturesContract[]; options?: OptionContract[]; resolved?: boolean },
): FnoUnderlyingInstrument {
  const resolved = o.resolved ?? true;
  const futures = o.futures ?? [];
  const options = o.options ?? [];
  return {
    symbol: sym,
    normalizedSymbol: sym,
    name: sym,
    spotInstrumentKey: resolved ? `NSE_EQ|${sym}` : null,
    spotMappingStatus: resolved ? "resolved" : "missing_key",
    spotResolved: resolved,
    diagnosticSpotKey: resolved ? `NSE_EQ|${sym}` : null,
    conflictingSpotKeys: [],
    spotTradingSymbol: resolved ? sym : null,
    isin: resolved ? sym : null,
    futures,
    options,
    nearMonthFutures: futures[0] ?? null,
    futuresExpiries: [...new Set(futures.map((f) => f.expiry))].sort((a, b) => a - b),
    optionExpiries: [...new Set(options.map((op) => op.expiry))].sort((a, b) => a - b),
    lotSize: futures[0]?.lotSize ?? null,
  };
}
function universe(underlyings: FnoUnderlyingInstrument[]): DataResult<FnoInstrumentUniverse> {
  const bySymbol: Record<string, FnoUnderlyingInstrument> = Object.create(null);
  for (const u of underlyings) bySymbol[u.normalizedSymbol] = u;
  return ok({ underlyings, bySymbol } as unknown as FnoInstrumentUniverse, { source: "test" });
}
/** Options at the given strikes for both (or a subset of) legs. */
function optionsFor(sym: string, strikes: number[], legs: (s: number) => OptionType[]): OptionContract[] {
  const out: OptionContract[] = [];
  for (const s of strikes) for (const t of legs(s)) out.push(opt(`NSE_FO|${sym}${s}${t}`, s, t, EXP_CUR_D, EXP_CUR));
  return out;
}
const bothLegs = (): OptionType[] => ["CE", "PE"];

function baseUniverse(): DataResult<FnoInstrumentUniverse> {
  return universe([
    underlying("RELIANCE", {
      futures: [fut("NSE_FO|RELIF1", EXP_CUR_D, EXP_CUR), fut("NSE_FO|RELIF2", EXP_LATER_D, EXP_LATER)],
      options: optionsFor("RELIANCE", [1300, 1320, 1340], bothLegs),
    }),
    underlying("SBIN", { futures: [fut("NSE_FO|SBINF1", EXP_CUR_D, EXP_CUR)], options: optionsFor("SBIN", [800, 820, 840], bothLegs) }),
    underlying("INFY", { futures: [fut("NSE_FO|INFYF1", EXP_CUR_D, EXP_CUR)], options: optionsFor("INFY", [1500, 1520, 1540], bothLegs) }),
    underlying("TIE", { futures: [fut("NSE_FO|TIEF1", EXP_CUR_D, EXP_CUR)], options: optionsFor("TIE", [1320, 1340], bothLegs) }),
    underlying("NOFUT", { futures: [], options: optionsFor("NOFUT", [500], bothLegs) }),
    underlying("NOCALL", { futures: [fut("NSE_FO|NOCALLF1", EXP_CUR_D, EXP_CUR)], options: optionsFor("NOCALL", [500], () => ["PE"]) }),
    underlying("NOPUT", { futures: [fut("NSE_FO|NOPUTF1", EXP_CUR_D, EXP_CUR)], options: optionsFor("NOPUT", [500], () => ["CE"]) }),
    underlying("EMPTY", { futures: [], options: [] }),
  ]);
}

// ── Snapshot builders ─────────────────────────────────────────────────────────
function futSnap(key: string, referenceMs: number, over: Partial<FuturesMarketSnapshot> = {}): FuturesMarketSnapshot {
  return {
    symbol: "X", tradingSymbol: `FUT ${key}`, instrumentKey: key,
    expiryMs: EXP_CUR, expiryDateIst: EXP_CUR_D, lotSize: 500,
    lastPrice: 100, open: 100, high: 101, low: 99, close: 100,
    volume: 1000, averagePrice: 100, openInterest: 5000, openInterestDayHigh: 5200, openInterestDayLow: 4800,
    netChange: 1, totalBuyQuantity: 10, totalSellQuantity: 10, bestBid: 99.9, bestAsk: 100.1,
    buyDepth: [], sellDepth: [], providerTimestampMs: referenceMs, lastTradeTimeMs: referenceMs, receivedAtMs: referenceMs,
    sessionState: "live", source: "upstox_full_market_quote", ...over,
  };
}
function optSnap(
  key: string,
  type: OptionType,
  strike: number,
  source: "upstox_option_chain" | "upstox_option_greek_v3",
  referenceMs: number,
  over: Partial<OptionMarketSnapshot> = {},
): OptionMarketSnapshot {
  return {
    symbol: "X", optionType: type, strike, expiryMs: EXP_CUR, expiryDateIst: EXP_CUR_D, instrumentKey: key,
    lastPrice: 20, closePrice: 18, volume: 500, openInterest: 1000, previousOpenInterest: 900, openInterestChange: 100,
    bidPrice: 19, bidQuantity: 100, askPrice: 21, askQuantity: 100,
    impliedVolatilityPct: 26, delta: 0.5, gamma: 0.01, theta: -1, vega: 0.9, probabilityOfProfit: 33,
    providerTimestampMs: source === "upstox_option_greek_v3" ? referenceMs : null, receivedAtMs: referenceMs,
    sessionState: "unknown", source, ...over,
  };
}

// ── Fake provider ─────────────────────────────────────────────────────────────
interface FakeConfig {
  futures?: (key: string, referenceMs: number) => DataResult<FuturesMarketSnapshot> | undefined;
  greek?: (key: string, symbol: string, referenceMs: number) => DataResult<OptionMarketSnapshot> | undefined;
  chain?: (
    underlyingKey: string,
    selection: SelectedAtmPair,
    referenceMs: number,
  ) => { call: DataResult<OptionMarketSnapshot>; put: DataResult<OptionMarketSnapshot> };
  reverseFutures?: boolean;
}
function makeFakeProvider(cfg: FakeConfig = {}) {
  const state = {
    futuresCallCount: 0,
    greekCallCount: 0,
    chainCallCount: 0,
    futuresBatches: [] as string[][],
    greekBatches: [] as Array<Array<{ key: string; symbol: string }>>,
    chainCalls: [] as Array<{ underlyingKey: string; expiryDateIst: string; atmStrike: number }>,
    activeChain: 0,
    maxChainConcurrency: 0,
  };
  const provider: UpstoxDerivativesProvider = {
    async fetchFuturesQuotes({ futures, referenceMs }) {
      state.futuresCallCount++;
      state.futuresBatches.push(futures.map((f) => f.instrumentKey));
      const entries: Array<[string, DataResult<FuturesMarketSnapshot>]> = [];
      for (const f of futures) {
        const r = cfg.futures ? cfg.futures(f.instrumentKey, referenceMs) : ok(futSnap(f.instrumentKey, referenceMs));
        if (r !== undefined) entries.push([f.instrumentKey, r]);
      }
      if (cfg.reverseFutures) entries.reverse();
      return new Map(entries);
    },
    async fetchOptionGreeks({ contracts, referenceMs }) {
      state.greekCallCount++;
      state.greekBatches.push(contracts.map((c) => ({ key: c.contract.instrumentKey, symbol: c.symbol })));
      const map = new Map<string, DataResult<OptionMarketSnapshot>>();
      for (const c of contracts) {
        const r = cfg.greek
          ? cfg.greek(c.contract.instrumentKey, c.symbol, referenceMs)
          : ok(optSnap(c.contract.instrumentKey, c.contract.optionType, c.contract.strike, "upstox_option_greek_v3", referenceMs, { symbol: c.symbol }));
        if (r !== undefined) map.set(c.contract.instrumentKey, r);
      }
      return map;
    },
    async fetchAtmOptionPair({ underlyingInstrumentKey, selection, referenceMs }) {
      state.chainCallCount++;
      state.activeChain++;
      state.maxChainConcurrency = Math.max(state.maxChainConcurrency, state.activeChain);
      state.chainCalls.push({ underlyingKey: underlyingInstrumentKey, expiryDateIst: selection.expiryDateIst, atmStrike: selection.atmStrike });
      await Promise.resolve();
      await Promise.resolve();
      const res = cfg.chain
        ? cfg.chain(underlyingInstrumentKey, selection, referenceMs)
        : {
            call: selection.call
              ? ok(optSnap(selection.call.instrumentKey, "CE", selection.atmStrike, "upstox_option_chain", referenceMs, { symbol: selection.symbol }))
              : unavailable("no CE"),
            put: selection.put
              ? ok(optSnap(selection.put.instrumentKey, "PE", selection.atmStrike, "upstox_option_chain", referenceMs, { symbol: selection.symbol }))
              : unavailable("no PE"),
          };
      state.activeChain--;
      return res;
    },
  };
  return { provider, state };
}

function setup(cfg: FakeConfig = {}, pol: DerivativesOrchestratorPolicy = policy()) {
  const { provider, state } = makeFakeProvider(cfg);
  const cache = createDerivativesCache(pol.cachePolicy);
  const orch = createDerivativesOrchestrator({ provider, cache }, pol);
  return { orch, state, cache };
}
function req(requestKey: string, symbol: string, anchorPrice: number, preferOptionChain = false): DerivativesEnrichmentRequest {
  return { requestKey, symbol, anchorPrice, preferOptionChain };
}

// ═══════════════════════════════════════════════════════════════════════════
// Policy validation
// ═══════════════════════════════════════════════════════════════════════════
test("OP0. invalid orchestrator policy rejected", () => {
  assert.throws(() => assertValidOrchestratorPolicy(policy({ maxOptionChainRequestsPerBatch: -1 })));
  assert.throws(() => assertValidOrchestratorPolicy(policy({ optionChainConcurrency: 0 })));
  assert.throws(() => assertValidOrchestratorPolicy(policy({ cachePolicy: { ...CACHE_POLICY, maxEntries: 0 } })));
});

// ═══════════════════════════════════════════════════════════════════════════
// Input & universe
// ═══════════════════════════════════════════════════════════════════════════
test("O1. empty request list → empty map, zero provider calls", async () => {
  const { orch, state } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [], referenceMs: REF });
  assert.equal(r.size, 0);
  assert.equal(state.futuresCallCount, 0);
  assert.equal(state.greekCallCount, 0);
  assert.equal(state.chainCallCount, 0);
});

test("O2. invalid referenceMs → invalid_input, zero provider calls", async () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    const { orch, state } = setup();
    const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: bad });
    assert.equal(r.get("A")!.status, "invalid_input");
    assert.equal(state.futuresCallCount + state.greekCallCount + state.chainCallCount, 0);
  }
});

test("O3. blank requestKey → invalid_input", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("   ", "RELIANCE", 1327)], referenceMs: REF });
  assert.equal(r.get("")!.status, "invalid_input");
});

test("O4. duplicate requestKey → invalid_input (never processed)", async () => {
  const { orch, state } = setup();
  const r = await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("DUP", "RELIANCE", 1327), req("DUP", "SBIN", 815)],
    referenceMs: REF,
  });
  assert.equal(r.get("DUP")!.status, "invalid_input");
  assert.equal(state.futuresCallCount, 0); // both duplicates → nothing valid to fetch
});

test("O5. invalid symbol → invalid_input", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "###", 100)], referenceMs: REF });
  assert.equal(r.get("A")!.status, "invalid_input");
});

test("O6. invalid anchor → invalid_input", async () => {
  const { orch } = setup();
  for (const bad of [0, -5, NaN]) {
    const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", bad)], referenceMs: REF });
    assert.equal(r.get("A")!.status, "invalid_input");
  }
});

test("O7. universe provider failure propagates to valid requests, zero provider calls", async () => {
  const { orch, state } = setup();
  const uni = providerError("master down") as DataResult<FnoInstrumentUniverse>;
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  assert.equal(r.get("A")!.status, "provider_error");
  assert.equal(state.futuresCallCount + state.greekCallCount + state.chainCallCount, 0);
});

test("O8. mixed valid/invalid requests still process valid items", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("BAD", "###", 100), req("", "RELIANCE", 1327), req("GOOD", "RELIANCE", 1327)],
    referenceMs: REF,
  });
  assert.equal(r.get("BAD")!.status, "invalid_input");
  assert.equal(r.get("")!.status, "invalid_input");
  assert.ok(isOk(r.get("GOOD")!));
});

// ═══════════════════════════════════════════════════════════════════════════
// Selection
// ═══════════════════════════════════════════════════════════════════════════
test("O9. nearest (current) future selected", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) assert.equal(d.value.selection.futureInstrumentKey, "NSE_FO|RELIF1");
});

test("O10. real listed ATM strike selected", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.selection.atmStrike, 1320);
    assert.equal(d.value.selection.callInstrumentKey, "NSE_FO|RELIANCE1320CE");
    assert.equal(d.value.selection.putInstrumentKey, "NSE_FO|RELIANCE1320PE");
  }
});

test("O11. equal-distance tie preserves the lower strike", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "TIE", 1330)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) assert.equal(d.value.selection.atmStrike, 1320);
});

test("O12. missing future remains a truthful leg failure (item still available)", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "NOFUT", 505)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.future.status, "unavailable");
    assert.equal(d.value.selection.futureInstrumentKey, null);
    assert.ok(isOk(d.value.call) && isOk(d.value.put));
  }
});

test("O13. missing CE leg remains unavailable", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "NOCALL", 505)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.call.status, "unavailable");
    assert.equal(d.value.selection.callInstrumentKey, null);
    assert.ok(isOk(d.value.put));
  }
});

test("O14. missing PE leg remains unavailable", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "NOPUT", 505)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.put.status, "unavailable");
    assert.ok(isOk(d.value.call));
  }
});

test("O15. no fabricated contract or strike (nulls where absent)", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "EMPTY", 100)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.selection.futureInstrumentKey, null);
    assert.equal(d.value.selection.atmStrike, null);
    assert.equal(d.value.selection.callInstrumentKey, null);
    assert.equal(d.value.selection.putInstrumentKey, null);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Futures batching / cache
// ═══════════════════════════════════════════════════════════════════════════
test("O16. multiple futures use a single provider call", async () => {
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327), req("B", "SBIN", 815)], referenceMs: REF });
  assert.equal(state.futuresCallCount, 1);
  assert.equal(state.futuresBatches[0].length, 2);
});

test("O17. duplicate future keys share one provider request", async () => {
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327), req("B", "RELIANCE", 1327)], referenceMs: REF });
  assert.equal(state.futuresCallCount, 1);
  assert.equal(state.futuresBatches[0].length, 1); // deduped by instrument key
});

test("O18. more than 500 futures split deterministically", async () => {
  const unders: FnoUnderlyingInstrument[] = [];
  const requests: DerivativesEnrichmentRequest[] = [];
  for (let i = 0; i < 501; i++) {
    const sym = `SYM${i}`;
    unders.push(underlying(sym, { futures: [fut(`NSE_FO|${sym}F`, EXP_CUR_D, EXP_CUR)], options: [] }));
    requests.push(req(`R${i}`, sym, 100));
  }
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: universe(unders), requests, referenceMs: REF });
  assert.equal(state.futuresCallCount, 2);
  assert.equal(state.futuresBatches[0].length, 500);
  assert.equal(state.futuresBatches[1].length, 1);
});

test("O19. fresh futures cache hit skips provider on a second batch", async () => {
  const { orch, state } = setup();
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 500 });
  assert.equal(state.futuresCallCount, 1);
});

test("O20. futures provider failure with eligible stale cache → stale future", async () => {
  let mode: "ok" | "fail" = "ok";
  const { orch } = setup({ futures: (key, ref) => (mode === "fail" ? providerError("down") : ok(futSnap(key, ref))) });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  mode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) assert.equal(d.value.future.status, "stale");
});

test("O21. futures provider failure without stale cache → provider_error future", async () => {
  const { orch } = setup({ futures: () => providerError("down") });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) assert.equal(d.value.future.status, "provider_error");
});

// ═══════════════════════════════════════════════════════════════════════════
// Greek batching / cache
// ═══════════════════════════════════════════════════════════════════════════
test("O22. CE/PE contracts deduplicated across duplicate symbols", async () => {
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327), req("B", "RELIANCE", 1327)], referenceMs: REF });
  assert.equal(state.greekCallCount, 1);
  assert.equal(state.greekBatches[0].length, 2); // CE + PE, deduped
});

test("O23. up to 50 contracts use one provider call", async () => {
  const unders: FnoUnderlyingInstrument[] = [];
  const requests: DerivativesEnrichmentRequest[] = [];
  for (let i = 0; i < 25; i++) {
    const sym = `S${i}`;
    unders.push(underlying(sym, { futures: [fut(`NSE_FO|${sym}F`, EXP_CUR_D, EXP_CUR)], options: optionsFor(sym, [100], bothLegs) }));
    requests.push(req(`R${i}`, sym, 100));
  }
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: universe(unders), requests, referenceMs: REF });
  assert.equal(state.greekCallCount, 1);
  assert.equal(state.greekBatches[0].length, 50);
});

test("O24. more than 50 contracts split deterministically", async () => {
  const unders: FnoUnderlyingInstrument[] = [];
  const requests: DerivativesEnrichmentRequest[] = [];
  for (let i = 0; i < 26; i++) {
    const sym = `S${i}`;
    unders.push(underlying(sym, { futures: [fut(`NSE_FO|${sym}F`, EXP_CUR_D, EXP_CUR)], options: optionsFor(sym, [100], bothLegs) }));
    requests.push(req(`R${i}`, sym, 100));
  }
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: universe(unders), requests, referenceMs: REF });
  assert.equal(state.greekCallCount, 2);
  assert.equal(state.greekBatches[0].length, 50);
  assert.equal(state.greekBatches[1].length, 2);
});

test("O25. explicit underlying symbol passed to Greek requests", async () => {
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  for (const item of state.greekBatches[0]) assert.equal(item.symbol, "RELIANCE");
});

test("O26. fresh Greek cache skips provider on a second batch", async () => {
  const { orch, state } = setup();
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 500 });
  assert.equal(state.greekCallCount, 1);
});

test("O27. missing Greek response → unavailable leg", async () => {
  const { orch } = setup({ greek: () => undefined }); // omit every key
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal(d.value.call.status, "unavailable");
    assert.equal(d.value.put.status, "unavailable");
  }
});

test("O28. Greek provider error with eligible stale cache → stale option leg", async () => {
  let mode: "ok" | "fail" = "ok";
  const { orch } = setup({
    greek: (key, symbol, ref) => (mode === "fail" ? providerError("down") : ok(optSnap(key, "CE", 1320, "upstox_option_greek_v3", ref, { symbol }))),
  });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  mode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) assert.equal(d.value.call.status, "stale");
});

// ═══════════════════════════════════════════════════════════════════════════
// Option-chain overlay
// ═══════════════════════════════════════════════════════════════════════════
test("O29. preferOptionChain=false → zero chain calls; source is Greek", async () => {
  const { orch, state } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, false)], referenceMs: REF });
  assert.equal(state.chainCallCount, 0);
  const d = r.get("A")!;
  if (isOk(d)) assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
});

test("O30. preferred request gets a chain overlay", async () => {
  const { orch, state } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  assert.equal(state.chainCallCount, 1);
  const d = r.get("A")!;
  if (isOk(d)) {
    assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_chain");
    assert.equal((d.value.put as { value: OptionMarketSnapshot }).value.source, "upstox_option_chain");
  }
});

test("O31. chain request uses the exact selected expiry and strike", async () => {
  const { orch, state } = setup();
  await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  assert.equal(state.chainCalls[0].expiryDateIst, EXP_CUR_D);
  assert.equal(state.chainCalls[0].atmStrike, 1320);
  assert.equal(state.chainCalls[0].underlyingKey, "NSE_EQ|RELIANCE");
});

test("O32/33. chain cap obeyed in input order; requests beyond cap retain Greek", async () => {
  const { orch, state } = setup({}, policy({ maxOptionChainRequestsPerBatch: 1 }));
  const r = await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("A", "RELIANCE", 1327, true), req("B", "SBIN", 815, true)],
    referenceMs: REF,
  });
  assert.equal(state.chainCallCount, 1);
  assert.equal(state.chainCalls[0].underlyingKey, "NSE_EQ|RELIANCE"); // first in order
  const a = r.get("A")!;
  const b = r.get("B")!;
  if (isOk(a)) assert.equal((a.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_chain");
  if (isOk(b)) assert.equal((b.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
});

test("O34. option-chain concurrency never exceeds the configured maximum", async () => {
  const { orch, state } = setup({}, policy({ maxOptionChainRequestsPerBatch: 10, optionChainConcurrency: 2 }));
  await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("A", "RELIANCE", 1327, true), req("B", "SBIN", 815, true), req("C", "INFY", 1527, true), req("D", "TIE", 1330, true)],
    referenceMs: REF,
  });
  assert.equal(state.chainCallCount, 4);
  assert.ok(state.maxChainConcurrency <= 2, `max concurrency ${state.maxChainConcurrency} exceeded 2`);
  assert.equal(state.maxChainConcurrency, 2);
});

test("O35/36. chain result cached; fresh chain cache skips provider", async () => {
  const { orch, state } = setup();
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF + 500 });
  assert.equal(state.chainCallCount, 1);
});

test("O37. fresh chain available overrides Greek for that leg", async () => {
  const { orch } = setup({
    chain: (_u, sel, ref) => ({
      call: ok(optSnap(sel.call!.instrumentKey, "CE", sel.atmStrike, "upstox_option_chain", ref, { lastPrice: 111 })),
      put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref, { lastPrice: 111 })),
    }),
    greek: (key, symbol, ref) => ok(optSnap(key, "CE", 1320, "upstox_option_greek_v3", ref, { symbol, lastPrice: 222 })),
  });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) {
    const call = d.value.call as { value: OptionMarketSnapshot };
    assert.equal(call.value.source, "upstox_option_chain");
    assert.equal(call.value.lastPrice, 111);
  }
});

test("O38. chain unavailable leg falls back to available Greek", async () => {
  const { orch } = setup({
    chain: (_u, sel, ref) => ({
      call: unavailable("no CE at chain"),
      put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref)),
    }),
  });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) {
    assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
    assert.equal((d.value.put as { value: OptionMarketSnapshot }).value.source, "upstox_option_chain");
  }
});

test("O39. chain provider_error leg falls back to available Greek", async () => {
  const { orch } = setup({
    chain: (_u, sel, ref) => ({
      call: providerError("chain leg failed"),
      put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref)),
    }),
  });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
});

test("O40. stale chain does NOT override fresh Greek", async () => {
  let chainMode: "ok" | "fail" = "ok";
  const { orch } = setup({
    chain: (_u, sel, ref) =>
      chainMode === "fail"
        ? { call: providerError("down"), put: providerError("down") }
        : {
            call: ok(optSnap(sel.call!.instrumentKey, "CE", sel.atmStrike, "upstox_option_chain", ref)),
            put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref)),
          },
    greek: (key, symbol, ref) => ok(optSnap(key, "CE", 1320, "upstox_option_greek_v3", ref, { symbol })),
  });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  chainMode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  if (isOk(d)) {
    // chain refresh failed → cache-stale chain; fresh Greek refreshed → Greek wins.
    assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
    assert.equal(d.value.call.status, "available");
  }
});

test("O41. stale chain used when Greek is unavailable", async () => {
  let mode: "ok" | "fail" = "ok";
  const { orch } = setup({
    chain: (_u, sel, ref) =>
      mode === "fail"
        ? { call: providerError("down"), put: providerError("down") }
        : {
            call: ok(optSnap(sel.call!.instrumentKey, "CE", sel.atmStrike, "upstox_option_chain", ref)),
            put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref)),
          },
    greek: (key, symbol, ref) => (mode === "fail" ? unavailable("gone") : ok(optSnap(key, "CE", 1320, "upstox_option_greek_v3", ref, { symbol }))),
  });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  mode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  if (isOk(d)) {
    assert.equal(d.value.call.status, "stale");
    assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_chain");
  }
});

test("O42. no hybrid chain/Greek snapshot is created", async () => {
  const { orch } = setup({
    chain: (_u, sel, ref) => ({
      call: ok(optSnap(sel.call!.instrumentKey, "CE", sel.atmStrike, "upstox_option_chain", ref, { lastPrice: 111, bidPrice: 5 })),
      put: ok(optSnap(sel.put!.instrumentKey, "PE", sel.atmStrike, "upstox_option_chain", ref, { lastPrice: 111 })),
    }),
    greek: (key, symbol, ref) => ok(optSnap(key, "CE", 1320, "upstox_option_greek_v3", ref, { symbol, lastPrice: 222, bidPrice: 999 })),
  });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) {
    const call = (d.value.call as { value: OptionMarketSnapshot }).value;
    // Every field must come from the SAME (chain) snapshot — no mixing.
    assert.equal(call.source, "upstox_option_chain");
    assert.equal(call.lastPrice, 111);
    assert.equal(call.bidPrice, 5); // chain's bid, never the Greek's 999
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Assembly & health
// ═══════════════════════════════════════════════════════════════════════════
test("O43. complete three-leg result → complete health", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal(d.value.health.status, "complete");
});

test("O44. missing one option leg → partial health", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "NOCALL", 505)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal(d.value.health.status, "partial");
});

test("O45. stale future → degraded health", async () => {
  let mode: "ok" | "fail" = "ok";
  const { orch } = setup({ futures: (key, ref) => (mode === "fail" ? providerError("down") : ok(futSnap(key, ref))) });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  mode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal(d.value.health.status, "degraded");
});

test("O46. stale leg + failed leg → degraded precedence", async () => {
  // Futures succeed on run 1 (→ cached, so a run-2 failure yields STALE). Greek
  // always fails (never cached), so a run-2 failure has no stale candidate and
  // stays provider_error. A stale future + a failed option leg → degraded.
  let mode: "ok" | "fail" = "ok";
  const { orch } = setup({
    futures: (key, ref) => (mode === "fail" ? providerError("down") : ok(futSnap(key, ref))),
    greek: () => providerError("greek always down"),
  });
  const uni = baseUniverse();
  await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  mode = "fail";
  const r = await orch.enrichBatch({ universe: uni, requests: [req("A", "RELIANCE", 1327)], referenceMs: REF + 1_000 });
  const d = r.get("A")!;
  if (isOk(d)) {
    assert.equal(d.value.future.status, "stale");
    assert.equal(d.value.call.status, "provider_error"); // no stale candidate for greek
    assert.equal(d.value.health.status, "degraded"); // stale precedence over partial
  }
});

test("O47. all legs unavailable → unavailable health", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "EMPTY", 100)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal(d.value.health.status, "unavailable");
});

test("O48. top-level result remains available when leg-level failures exist", async () => {
  const { orch } = setup({ futures: () => providerError("down"), greek: () => providerError("down") });
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  assert.ok(isOk(r.get("A")!)); // available envelope despite all legs failing
});

test("O49. selection identity matches the selected contracts", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) {
    assert.equal(d.value.selection.futureInstrumentKey, "NSE_FO|RELIF1");
    assert.equal(d.value.selection.callInstrumentKey, "NSE_FO|RELIANCE1320CE");
    assert.equal(d.value.selection.putInstrumentKey, "NSE_FO|RELIANCE1320PE");
    assert.equal(d.value.selection.resolvedFrom, "instrument_master");
  }
});

test("O50. output map is keyed by requestKey, not symbol", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("REQ-1", "RELIANCE", 1327)], referenceMs: REF });
  assert.ok(r.has("REQ-1"));
  assert.equal(r.has("RELIANCE"), false);
});

test("O51. duplicate symbols with distinct request keys are both retained", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("A", "RELIANCE", 1327), req("B", "RELIANCE", 1327)],
    referenceMs: REF,
  });
  assert.ok(isOk(r.get("A")!));
  assert.ok(isOk(r.get("B")!));
});

test("O52. referenceMs is preserved exactly on the enrichment", async () => {
  const { orch } = setup();
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327)], referenceMs: REF });
  const d = r.get("A")!;
  if (isOk(d)) assert.equal(d.value.referenceMs, REF);
});

test("O53. no requested item is silently omitted", async () => {
  const { orch } = setup();
  const requests = [req("A", "RELIANCE", 1327), req("B", "SBIN", 815), req("C", "###", 100), req("D", "NOFUT", 505)];
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests, referenceMs: REF });
  for (const k of ["A", "B", "C", "D"]) assert.ok(r.has(k), `missing ${k}`);
});

test("O54. deterministic association independent of provider completion order", async () => {
  const { orch } = setup({ reverseFutures: true }); // provider returns futures map in reverse order
  const r = await orch.enrichBatch({
    universe: baseUniverse(),
    requests: [req("A", "RELIANCE", 1327), req("B", "SBIN", 815), req("C", "INFY", 1527)],
    referenceMs: REF,
  });
  const a = r.get("A")!;
  const b = r.get("B")!;
  const c = r.get("C")!;
  if (isOk(a)) assert.equal((a.value.future as { value: FuturesMarketSnapshot }).value.instrumentKey, "NSE_FO|RELIF1");
  if (isOk(b)) assert.equal((b.value.future as { value: FuturesMarketSnapshot }).value.instrumentKey, "NSE_FO|SBINF1");
  if (isOk(c)) assert.equal((c.value.future as { value: FuturesMarketSnapshot }).value.instrumentKey, "NSE_FO|INFYF1");
});

test("O55. overlay disabled via cap=0 → zero chain calls; legs stay Greek", async () => {
  const { orch, state } = setup({}, policy({ maxOptionChainRequestsPerBatch: 0 }));
  const r = await orch.enrichBatch({ universe: baseUniverse(), requests: [req("A", "RELIANCE", 1327, true)], referenceMs: REF });
  assert.equal(state.chainCallCount, 0);
  const d = r.get("A")!;
  assert.ok(isOk(d));
  if (isOk(d)) {
    assert.equal((d.value.call as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
    assert.equal((d.value.put as { value: OptionMarketSnapshot }).value.source, "upstox_option_greek_v3");
  }
});
