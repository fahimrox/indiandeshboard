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
