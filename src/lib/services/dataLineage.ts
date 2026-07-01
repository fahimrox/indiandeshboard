export interface DataLineage {
  source: "upstox" | "angelone" | "fyers" | "yahoo" | "nse" | "cache" | "synthetic";
  status: "live" | "fallback" | "cached" | "expired_token";
  timestamp: number;
  latencyMs?: number;
}

export type EnvelopedResponse<T> = T & {
  _metadata: DataLineage;
};
