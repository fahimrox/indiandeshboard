export type OptionSide = "CALL" | "PUT";
export type SentimentLabel = "Bullish" | "Bearish" | "Neutral";
export type ChartMode = "OI_CHANGE_TOTAL" | "OI_CHANGE" | "TOTAL_OI";

export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "MIDCPNIFTY" | "SENSEX";

export const INDEX_OPTIONS: ReadonlyArray<{ id: IndexSymbol; label: string }> = [
  { id: "NIFTY", label: "NIFTY 50" },
  { id: "BANKNIFTY", label: "BANK NIFTY" },
  { id: "MIDCPNIFTY", label: "MIDCAP NIFTY" },
  { id: "SENSEX", label: "SENSEX" },
];

export type TimePresetId =
  | "3m" | "5m" | "10m" | "15m" | "30m" | "1h" | "2h" | "3h" | "all";

export interface TimeWindow {
  preset: TimePresetId;
  /** epoch ms; null = open-ended (now / start of day) */
  fromTs: number | null;
  toTs: number | null;
}

export interface StrikeGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

export interface StrikeOI {
  strike: number;
  callTotalOI: number;
  putTotalOI: number;
  /** signed change vs previous snapshot */
  callOIChange: number;
  putOIChange: number;
  callVolume?: number;
  putVolume?: number;
  callIV?: number;
  putIV?: number;
  callGreeks?: StrikeGreeks;
  putGreeks?: StrikeGreeks;
}

export interface OISnapshot {
  symbol: string;
  spot: number;
  atmStrike: number;
  maxPain: number;
  pcr: number;
  pcrChange: number;
  pcrOIChange: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallOIChange: number;
  totalPutOIChange: number;
  strikes: StrikeOI[];
  lastUpdated: string; // ISO
}

export interface SentimentResult {
  label: SentimentLabel;
  /** 0..100 confidence used to fill the gauge */
  score: number;
  insight: string;
  analysis: string;
}

export interface TimeRangePreset {
  id: string;
  label: string;
  minutes: number | "ALL";
}
