export type BuildupType = 
  | 'Long Buildup' 
  | 'Short Buildup' 
  | 'Long Unwinding' 
  | 'Short Covering' 
  | 'Neutral';

export type MarketBias = 
  | 'Strong Bullish' 
  | 'Bullish' 
  | 'Neutral' 
  | 'Bearish' 
  | 'Strong Bearish';

export type SignalConfidence = 'Low' | 'Medium' | 'High' | 'Very High';

export interface OptionData {
  oi: number;         // Open Interest (in contracts)
  oiChange: number;   // Daily Change in OI (signed)
  volume: number;     // Session volume
  iv: number;         // Implied Volatility %
  delta: number;      // Option Delta
  gamma: number;      // Option Gamma
  theta: number;      // Option Theta
  price: number;      // Last Traded Price (LTP)
  priceChange: number; // LTP daily change (signed)
  buildup: BuildupType;
}

export interface OIChainRow {
  strike: number;
  ce: OptionData;
  pe: OptionData;
  isATM: boolean;
  pcr: number;          // PE OI / CE OI at this strike
  notionalDiff: number; // PE Notional - CE Notional
  moneyFlow: number;    // Strike Money Flow index
  supportRank: number;  // Support significance ranking (1 = highest)
  resistanceRank: number; // Resistance significance ranking (1 = highest)
  aiScore: number;      // Composite signal (-100 to +100)
}

export interface OITimelinePoint {
  time: string;         // e.g., "09:15 AM", "09:30 AM", etc.
  spot: number;         // Spot price at this time
  pcr: number;          // Overall Put-Call Ratio
  maxPain: number;      // Max Pain strike at this time
  totalCallOI: number;  // Sum of CE OI
  totalPutOI: number;   // Sum of PE OI
  callOIChange: number; // Sum of CE daily change
  putOIChange: number;  // Sum of PE daily change
  bias: MarketBias;
  confidence: SignalConfidence;
  chain: OIChainRow[];  // Option chain snapshot at this time
}

export interface OISummary {
  spotPrice: number;
  spotChange: number;
  spotChangePercent: number;
  atmStrike: number;
  pcr: number;
  pcrTrend: 'up' | 'down' | 'flat';
  maxPain: number;
  highestCallOIStrike: number;
  highestPutOIStrike: number;
  highestCallWritingStrike: number;
  highestPutWritingStrike: number;
  marketBias: MarketBias;
  confidence: SignalConfidence;
  aiSummary: string;
  lastUpdate: string;
  dataSource: string;
}

export interface S_R_Zone {
  strike: number;
  type: 'Support' | 'Resistance';
  strength: number;     // 0 to 100
  status: 'Intact' | 'Tested' | 'Broken';
  distancePercent: number;
  migration: 'strengthening' | 'weakening' | 'stable';
}

export interface AIDecision {
  bias: MarketBias;
  confidence: SignalConfidence;
  probabilities: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  entryZone: [number, number]; // [min, max]
  avoidZone: [number, number]; // [min, max]
  trapDetected: boolean;
  trapDetails?: string;
  riskScore: number;           // 0 to 100
}

export interface OIAnalysisState {
  symbol: string;
  expiry: string;
  timeframe: 'Live' | 'Today' | '1D' | '5D' | 'Expiry';
  strikeRange: 'ATM±5' | 'ATM±10' | 'ATM±15' | 'ATM±20' | 'All';
  showLot: boolean;
  hideChurn: boolean;          // Churn noise filter
  mode: 'Live' | 'Historical';
}
