import type { BrokerName } from "./symbolMapper";

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
