// Screener V3 Phase 2B Part 3 — deterministic derivatives batch orchestrator.
//
// Wires together (never reimplements) the Part 1 pure selectors, the Part 2
// Upstox provider adapter and the Part 3 bounded cache into a single truthful
// `ScreenerV3Derivatives` per request. It performs NO ScreenerV3Row/API/UI
// integration, NO persistence, NO scheduler work, NO provider construction, NO
// environment reads, NO direct fetch, and NO machine-clock reads — every
// freshness/completion decision is driven by the caller's explicit `referenceMs`.
//
// Option data strategy: Greek V3 is the broad, batch-efficient source for every
// selected leg; a bounded, caller-opted option-chain overlay may override a leg
// when it returns a fresh available snapshot. Snapshots are NEVER merged into a
// synthetic hybrid — the reported `source` always identifies the snapshot used.
import {
  ok,
  stale,
  unavailable,
  invalidInput,
  providerError,
  isOk,
  isUsable,
  isFailure,
  propagateFailure,
  type DataResult,
  type FailureResult,
} from "./types.ts";
import type { FnoInstrumentUniverse, OptionContract } from "./instrument-types.ts";
import { normalizeNseSymbolKey } from "./fno-universe.ts";
import { isFinitePositiveTs } from "./ist-time.ts";
import {
  selectDerivativesFuture,
  selectDerivativesAtmPair,
  type SelectedFuture,
  type SelectedAtmPair,
} from "./derivatives-selectors.ts";
import { deriveDerivativesHealth } from "./derivatives-health.ts";
import type {
  DerivativesSelection,
  FuturesMarketSnapshot,
  OptionMarketSnapshot,
  ScreenerV3Derivatives,
} from "./derivatives-types.ts";
import type { UpstoxDerivativesProvider, OptionGreekRequest } from "./derivatives-provider.server.ts";
import {
  assertValidDerivativesCachePolicy,
  type DerivativesBatchCache,
  type DerivativesCachePolicy,
} from "./derivatives-cache.server.ts";

const SOURCE = "derivatives-orchestrator";

/** Provider batch ceilings (mirror the Part 2 provider limits). */
export const FUTURES_PROVIDER_CHUNK = 500;
export const GREEK_PROVIDER_CHUNK = 50;

// ── Dependencies / policy / request ─────────────────────────────────────────
export interface DerivativesOrchestratorDependencies {
  provider: UpstoxDerivativesProvider;
  cache: DerivativesBatchCache;
}

export interface DerivativesOrchestratorPolicy {
  /** Max requests (in input order) that receive an option-chain overlay per batch. Integer >= 0. */
  maxOptionChainRequestsPerBatch: number;
  /** Max concurrent option-chain provider calls. Integer >= 1. */
  optionChainConcurrency: number;
  /** Cache policy applied to every namespace (future/greek/chain). */
  cachePolicy: DerivativesCachePolicy;
}

export interface DerivativesEnrichmentRequest {
  /** Caller-stable identity so duplicate symbols are represented truthfully. */
  requestKey: string;
  symbol: string;
  anchorPrice: number;
  preferOptionChain?: boolean;
}

export interface DerivativesOrchestrator {
  enrichBatch(input: {
    universe: DataResult<FnoInstrumentUniverse>;
    requests: readonly DerivativesEnrichmentRequest[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<ScreenerV3Derivatives>>>;
}

export function assertValidOrchestratorPolicy(policy: DerivativesOrchestratorPolicy): void {
  if (!Number.isInteger(policy?.maxOptionChainRequestsPerBatch) || policy.maxOptionChainRequestsPerBatch < 0) {
    throw new Error("derivatives-orchestrator: maxOptionChainRequestsPerBatch must be an integer >= 0");
  }
  if (!Number.isInteger(policy.optionChainConcurrency) || policy.optionChainConcurrency < 1) {
    throw new Error("derivatives-orchestrator: optionChainConcurrency must be an integer >= 1");
  }
  assertValidDerivativesCachePolicy(policy.cachePolicy);
}

// ── Small internal helpers ────────────────────────────────────────────────────
function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Bounded-concurrency worker pool preserving input→output index association.
 * At most `limit` `worker` invocations run at once. Handles zero items, never
 * reads the machine clock, and continues processing after any single item's
 * `worker` resolves (the worker itself must not throw for provider failures).
 */
async function runWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let next = 0;
  const runnerCount = Math.min(Math.max(1, limit), items.length);
  async function runner(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners: Array<Promise<void>> = [];
  for (let k = 0; k < runnerCount; k++) runners.push(runner());
  await Promise.all(runners);
  return results;
}

/** A truthful pair of option-leg results returned by one option-chain call. */
interface ChainLegPair {
  call: DataResult<OptionMarketSnapshot>;
  put: DataResult<OptionMarketSnapshot>;
}

/** Chain-overlay work item (one option-chain provider request). */
interface ChainWorkItem {
  cacheKey: string;
  underlyingInstrumentKey: string;
  selection: SelectedAtmPair;
}

// ── Per-request working state (post request-validation) ──────────────────────
interface ValidRequest {
  requestKey: string;
  symbol: string; // normalized NSE symbol
  anchorPrice: number;
  preferOptionChain: boolean;
  selection: DerivativesSelection;
  /** Future selected for provider fetch, or a truthful selection failure. */
  future: SelectedFuture | null;
  futureFailure: FailureResult | null;
  /** ATM pair; when the pair itself failed, atmFailure carries the reason. */
  callContract: OptionContract | null;
  putContract: OptionContract | null;
  atmFailure: FailureResult | null;
  underlyingInstrumentKey: string | null;
  atmSelection: SelectedAtmPair | null;
}

/**
 * Option-leg precedence. Chain overlay (when present) wins ONLY when it is a
 * fresh available snapshot; a cache-stale chain leg yields to a fresh available
 * Greek leg but is used when Greek is not available. Failed chain always yields
 * to a usable Greek leg. Snapshots are never merged; the returned result's own
 * source identifies the snapshot actually used.
 */
function chooseOptionLeg(
  chain: DataResult<OptionMarketSnapshot> | undefined,
  greek: DataResult<OptionMarketSnapshot>,
): DataResult<OptionMarketSnapshot> {
  if (!chain) return greek; // no overlay requested/available for this leg
  if (chain.status === "available") return chain; // fresh chain overrides
  if (chain.status === "stale") {
    return isOk(greek) ? greek : chain; // fresh Greek beats stale chain; else stale chain
  }
  // chain is a failure (unavailable / provider_error / invalid_input)
  if (isUsable(greek)) return greek;
  return greek; // both failed → truthful primary (Greek) failure
}

/**
 * Extract one leg from a cached chain pair result. A cache-stale pair converts
 * only its previously-SUCCESSFUL legs to stale; a previously-unavailable leg is
 * kept unavailable (never fabricated into a stale value). A failed pair (chain
 * transport failure) propagates as that leg's failure.
 */
function extractChainLeg(
  pair: DataResult<ChainLegPair> | undefined,
  which: "call" | "put",
): DataResult<OptionMarketSnapshot> | undefined {
  if (!pair) return undefined;
  if (isFailure(pair)) return propagateFailure(pair); // chain transport failure
  const leg = pair.value[which];
  if (pair.status === "stale") {
    if (isOk(leg)) {
      return stale(leg.value, {
        source: leg.source,
        timestamp: leg.timestamp,
        reason: pair.reason ?? "provider refresh failed; using cached derivatives data",
      });
    }
    return leg; // previously-unavailable leg stays unavailable, never fabricated
  }
  return leg; // fresh available pair → leg as returned
}

// ── Factory ───────────────────────────────────────────────────────────────────
export function createDerivativesOrchestrator(
  deps: DerivativesOrchestratorDependencies,
  policy: DerivativesOrchestratorPolicy,
): DerivativesOrchestrator {
  assertValidOrchestratorPolicy(policy);
  const { provider, cache } = deps;
  const cachePolicy = policy.cachePolicy;

  async function enrichBatch(input: {
    universe: DataResult<FnoInstrumentUniverse>;
    requests: readonly DerivativesEnrichmentRequest[];
    referenceMs: number;
  }): Promise<ReadonlyMap<string, DataResult<ScreenerV3Derivatives>>> {
    const { universe, requests, referenceMs } = input;
    const result = new Map<string, DataResult<ScreenerV3Derivatives>>();

    // ── Phase 1: validate + dedupe requests. A requestKey seen >1 time is
    //    ambiguous → invalid_input for that key (never processed).
    const keyCounts = new Map<string, number>();
    for (const req of requests) {
      const rk = typeof req?.requestKey === "string" ? req.requestKey.trim() : "";
      if (rk !== "") keyCounts.set(rk, (keyCounts.get(rk) ?? 0) + 1);
    }

    const refValid = isFinitePositiveTs(referenceMs);
    const valid: ValidRequest[] = [];

    for (const req of requests) {
      const rk = typeof req?.requestKey === "string" ? req.requestKey.trim() : "";
      if (rk === "") {
        if (!result.has("")) {
          result.set("", invalidInput("blank requestKey", { source: SOURCE }));
        }
        continue;
      }
      if ((keyCounts.get(rk) ?? 0) > 1) {
        result.set(rk, invalidInput(`duplicate requestKey "${rk}"`, { source: SOURCE }));
        continue;
      }
      if (!refValid) {
        result.set(rk, invalidInput("referenceMs must be a finite positive epoch ms", { source: SOURCE }));
        continue;
      }
      const symbol = normalizeNseSymbolKey(typeof req.symbol === "string" ? req.symbol : "");
      if (!symbol) {
        result.set(rk, invalidInput(`invalid NSE symbol: "${req.symbol}"`, { source: SOURCE }));
        continue;
      }
      if (typeof req.anchorPrice !== "number" || !Number.isFinite(req.anchorPrice) || req.anchorPrice <= 0) {
        result.set(rk, invalidInput("anchorPrice must be a finite positive number", { source: SOURCE }));
        continue;
      }
      valid.push({
        requestKey: rk,
        symbol,
        anchorPrice: req.anchorPrice,
        preferOptionChain: req.preferOptionChain === true,
        // filled during the selection phase
        selection: {
          futureInstrumentKey: null,
          futureExpiryMs: null,
          optionExpiryMs: null,
          anchorPrice: req.anchorPrice,
          atmStrike: null,
          callInstrumentKey: null,
          putInstrumentKey: null,
          resolvedFrom: "instrument_master",
        },
        future: null,
        futureFailure: null,
        callContract: null,
        putContract: null,
        atmFailure: null,
        underlyingInstrumentKey: null,
        atmSelection: null,
      });
    }

    if (valid.length === 0) return result; // nothing to enrich; zero provider calls

    // ── Universe failure: propagate truthfully to every valid request, no
    //    provider calls. Invalid requests keep their invalid_input.
    if (isFailure(universe)) {
      for (const v of valid) result.set(v.requestKey, propagateFailure(universe));
      return result;
    }

    // ── Phase 2: deterministic selection (pure Part 1 selectors, no provider).
    for (const v of valid) {
      const fut = selectDerivativesFuture({ universe, symbol: v.symbol, referenceMs });
      if (isOk(fut)) {
        v.future = fut.value;
      } else {
        v.futureFailure = fut as FailureResult;
      }

      const atm = selectDerivativesAtmPair({ universe, symbol: v.symbol, anchorPrice: v.anchorPrice, referenceMs });
      if (isOk(atm)) {
        v.atmSelection = atm.value;
        v.callContract = atm.value.call;
        v.putContract = atm.value.put;
      } else {
        v.atmFailure = atm as FailureResult;
      }

      const underlying = universe.value.bySymbol[v.symbol];
      v.underlyingInstrumentKey =
        underlying && typeof underlying.spotInstrumentKey === "string" && underlying.spotInstrumentKey.trim() !== ""
          ? underlying.spotInstrumentKey
          : null;

      v.selection = {
        futureInstrumentKey: v.future ? v.future.instrumentKey : null,
        futureExpiryMs: v.future ? v.future.expiryMs : null,
        optionExpiryMs: v.atmSelection ? v.atmSelection.expiryMs : null,
        anchorPrice: v.anchorPrice,
        atmStrike: v.atmSelection ? v.atmSelection.atmStrike : null,
        callInstrumentKey: v.callContract ? v.callContract.instrumentKey : null,
        putInstrumentKey: v.putContract ? v.putContract.instrumentKey : null,
        resolvedFrom: "instrument_master",
      };
    }

    // ── Phase 3: futures batching (cache + chunked provider). ────────────────
    const futureItems: SelectedFuture[] = [];
    for (const v of valid) if (v.future) futureItems.push(v.future);
    const futureResults = await cache.loadMany<SelectedFuture, FuturesMarketSnapshot>({
      namespace: "future",
      items: futureItems,
      keyOf: (f) => f.instrumentKey,
      referenceMs,
      policy: cachePolicy,
      loader: async (misses) => {
        const merged = new Map<string, DataResult<FuturesMarketSnapshot>>();
        for (const group of chunk(misses, FUTURES_PROVIDER_CHUNK)) {
          const m = await provider.fetchFuturesQuotes({ futures: group, referenceMs });
          for (const [k, res] of m) merged.set(k, res);
        }
        return merged;
      },
    });

    // ── Phase 4: Greek V3 batching (broad option source; cache + chunked). ───
    const greekItems: OptionGreekRequest[] = [];
    for (const v of valid) {
      if (v.callContract) greekItems.push({ symbol: v.symbol, contract: v.callContract });
      if (v.putContract) greekItems.push({ symbol: v.symbol, contract: v.putContract });
    }
    const greekResults = await cache.loadMany<OptionGreekRequest, OptionMarketSnapshot>({
      namespace: "greek",
      items: greekItems,
      keyOf: (r) => r.contract.instrumentKey,
      referenceMs,
      policy: cachePolicy,
      loader: async (misses) => {
        const merged = new Map<string, DataResult<OptionMarketSnapshot>>();
        for (const group of chunk(misses, GREEK_PROVIDER_CHUNK)) {
          const m = await provider.fetchOptionGreeks({ contracts: group, referenceMs });
          for (const [k, res] of m) merged.set(k, res);
        }
        return merged;
      },
    });

    // ── Phase 5: bounded option-chain overlay (caller-opted, capped, order). ──
    const chainByRequestKey = new Map<string, DataResult<ChainLegPair>>();
    const preferred = valid.filter(
      (v) => v.preferOptionChain && v.atmSelection !== null && v.underlyingInstrumentKey !== null,
    );
    const capped = preferred.slice(0, policy.maxOptionChainRequestsPerBatch);
    if (capped.length > 0) {
      const chainItems: ChainWorkItem[] = capped.map((v) => {
        const atm = v.atmSelection as SelectedAtmPair;
        const callKey = v.callContract ? v.callContract.instrumentKey : "-";
        const putKey = v.putContract ? v.putContract.instrumentKey : "-";
        const cacheKey = `${v.underlyingInstrumentKey}|${atm.expiryDateIst}|${atm.atmStrike}|${callKey}|${putKey}`;
        return { cacheKey, underlyingInstrumentKey: v.underlyingInstrumentKey as string, selection: atm };
      });

      const chainResults = await cache.loadMany<ChainWorkItem, ChainLegPair>({
        namespace: "chain",
        items: chainItems,
        keyOf: (c) => c.cacheKey,
        referenceMs,
        policy: cachePolicy,
        loader: async (misses) => {
          // Bounded concurrency; one chain provider call per unique miss key.
          const pairs = await runWithConcurrency(misses, policy.optionChainConcurrency, async (item) => {
            const { call, put } = await provider.fetchAtmOptionPair({
              underlyingInstrumentKey: item.underlyingInstrumentKey,
              selection: item.selection,
              referenceMs,
            });
            // Classify the PAIR for cache-ability: a pure transport failure
            // (both legs provider_error / both invalid_input) is a failure and
            // is not cached; otherwise the pair is available and its per-leg
            // DataResults (including any per-leg unavailable) are preserved.
            let pairResult: DataResult<ChainLegPair>;
            if (call.status === "provider_error" && put.status === "provider_error") {
              pairResult = providerError("option-chain request failed", { source: SOURCE });
            } else if (call.status === "invalid_input" && put.status === "invalid_input") {
              pairResult = invalidInput("option-chain request rejected", { source: SOURCE });
            } else {
              pairResult = ok({ call, put }, { source: SOURCE, timestamp: referenceMs });
            }
            return { key: item.cacheKey, pairResult };
          });
          const merged = new Map<string, DataResult<ChainLegPair>>();
          for (const p of pairs) merged.set(p.key, p.pairResult);
          return merged;
        },
      });

      for (const v of capped) {
        const atm = v.atmSelection as SelectedAtmPair;
        const callKey = v.callContract ? v.callContract.instrumentKey : "-";
        const putKey = v.putContract ? v.putContract.instrumentKey : "-";
        const cacheKey = `${v.underlyingInstrumentKey}|${atm.expiryDateIst}|${atm.atmStrike}|${callKey}|${putKey}`;
        const pair = chainResults.get(cacheKey);
        if (pair) chainByRequestKey.set(v.requestKey, pair);
      }
    }

    // ── Phase 6: precedence + assembly (health via Part 1 aggregator). ───────
    for (const v of valid) {
      // Future leg
      let future: DataResult<FuturesMarketSnapshot>;
      if (v.future) {
        future =
          futureResults.get(v.future.instrumentKey) ??
          unavailable(`no futures result for ${v.future.instrumentKey}`, { source: SOURCE, timestamp: referenceMs });
      } else {
        future = propagateFailure(v.futureFailure as FailureResult);
      }

      // Greek option legs
      let greekCall: DataResult<OptionMarketSnapshot>;
      let greekPut: DataResult<OptionMarketSnapshot>;
      if (v.atmFailure) {
        greekCall = propagateFailure(v.atmFailure);
        greekPut = propagateFailure(v.atmFailure);
      } else {
        greekCall = v.callContract
          ? greekResults.get(v.callContract.instrumentKey) ??
            unavailable(`no option-greek result for ${v.callContract.instrumentKey}`, { source: SOURCE, timestamp: referenceMs })
          : unavailable("no CE leg listed at ATM strike", { source: SOURCE, timestamp: referenceMs });
        greekPut = v.putContract
          ? greekResults.get(v.putContract.instrumentKey) ??
            unavailable(`no option-greek result for ${v.putContract.instrumentKey}`, { source: SOURCE, timestamp: referenceMs })
          : unavailable("no PE leg listed at ATM strike", { source: SOURCE, timestamp: referenceMs });
      }

      // Optional chain overlay
      const pair = chainByRequestKey.get(v.requestKey);
      const chainCall = extractChainLeg(pair, "call");
      const chainPut = extractChainLeg(pair, "put");

      const call = chooseOptionLeg(chainCall, greekCall);
      const put = chooseOptionLeg(chainPut, greekPut);

      const health = deriveDerivativesHealth({ future, call, put });
      const derivatives: ScreenerV3Derivatives = {
        selection: v.selection,
        future,
        call,
        put,
        health,
        referenceMs,
      };
      // Leg-level failures never fail the whole item — top-level stays available.
      result.set(v.requestKey, ok(derivatives, { source: SOURCE, timestamp: referenceMs }));
    }

    return result;
  }

  return { enrichBatch };
}
