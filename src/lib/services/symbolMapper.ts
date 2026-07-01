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
