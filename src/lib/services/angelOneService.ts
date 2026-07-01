import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { Quote } from "../market.functions";
import type { OptionChain, OcRow, OcLeg, OcSignal } from "../nse.functions";

const SCRIP_MASTER_FILE = path.join(process.cwd(), "angel_one_scrip_master.json");

// Simple Base32 Decoder for TOTP
function base32ToBytes(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = "";
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) throw new Error("Invalid base32 character in TOTP secret");
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Generate TOTP (RFC 6238)
function generateTOTP(secret: string): string {
  const key = base32ToBytes(secret);
  const epoch = Math.round(Date.now() / 1000);
  const time = Math.floor(epoch / 30);

  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(time, 4);

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(buffer);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const code =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  return (code % 1_000_000).toString().padStart(6, "0");
}

interface AngelSession {
  jwtToken: string;
  feedToken: string;
  expiresAt: number;
}

let session: AngelSession | null = null;
let masterInstruments: any[] = [];
let masterLoaded = false;
let masterLoading = false;

// Angel One index tokens mapping
const ANGEL_INDEX_MAP: Record<string, { token: string; symbol: string; exchange: string }> = {
  "^NSEI": { token: "99926000", symbol: "Nifty 50", exchange: "NSE" },
  "^NSEBANK": { token: "99926009", symbol: "Nifty Bank", exchange: "NSE" },
  "^BSESN": { token: "99919000", symbol: "SENSEX", exchange: "BSE" },
  "^INDIAVIX": { token: "99926017", symbol: "India VIX", exchange: "NSE" },
  // Sector mapping fallback
  "^CNXIT": { token: "99926011", symbol: "Nifty IT", exchange: "NSE" },
  "^CNXPHARMA": { token: "99926012", symbol: "Nifty Pharma", exchange: "NSE" },
  "^CNXAUTO": { token: "99926013", symbol: "Nifty Auto", exchange: "NSE" },
  "^CNXENERGY": { token: "99926014", symbol: "Nifty Energy", exchange: "NSE" },
  "^CNXFMCG": { token: "99926015", symbol: "Nifty FMCG", exchange: "NSE" },
  "^CNXMETAL": { token: "99926016", symbol: "Nifty Metal", exchange: "NSE" },
  "^CNXREALTY": { token: "99926018", symbol: "Nifty Realty", exchange: "NSE" },
  "^CNXMEDIA": { token: "99926019", symbol: "Nifty Media", exchange: "NSE" },
  "^CNXPSUBANK": { token: "99926020", symbol: "Nifty PSU Bank", exchange: "NSE" },
  "NIFTY_FIN_SERVICE.NS": { token: "99926021", symbol: "Nifty Fin Service", exchange: "NSE" },
  "^CNXINFRA": { token: "99926022", symbol: "Nifty Infra", exchange: "NSE" },
  // Additional Indices for Quotes & Orchestrator mapping
  "^NSEMDCP50": { token: "99926074", symbol: "Nifty Midcap Select", exchange: "NSE" },
  "^CNXFIN": { token: "99926037", symbol: "Nifty Fin Service", exchange: "NSE" },
  "NIFTY": { token: "99926000", symbol: "Nifty 50", exchange: "NSE" },
  "BANKNIFTY": { token: "99926009", symbol: "Nifty Bank", exchange: "NSE" },
  "SENSEX": { token: "99919000", symbol: "SENSEX", exchange: "BSE" },
  "FINNIFTY": { token: "99926037", symbol: "Nifty Fin Service", exchange: "NSE" },
  "MIDCAPNIFTY": { token: "99926074", symbol: "Nifty Midcap Select", exchange: "NSE" },
  "MIDCPNIFTY": { token: "99926074", symbol: "Nifty Midcap Select", exchange: "NSE" },
};

let loginPromise: Promise<AngelSession> | null = null;

export const angelOneService = {
  async login(): Promise<AngelSession> {
    if (session && session.expiresAt > Date.now()) {
      return session;
    }
    if (loginPromise) {
      return loginPromise;
    }

    loginPromise = (async () => {
      try {
        const clientCode = process.env.ANGEL_ONE_CLIENT_ID;
        const mpin = process.env.ANGEL_ONE_MPIN;
        const apiKey = process.env.ANGEL_ONE_API_KEY;
        const totpSecret = process.env.ANGEL_ONE_TOTP_SECRET;

        if (!clientCode || !mpin || !apiKey || !totpSecret) {
          throw new Error("Angel One credentials are not fully configured in environment.");
        }

        const totp = generateTOTP(totpSecret);

        const res = await fetch("https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": apiKey,
          },
          body: JSON.stringify({ clientcode: clientCode, password: mpin, totp }),
        });

        if (!res.ok) {
          throw new Error(`Angel One login failed: status ${res.status}`);
        }

        const json = await res.json();
        if (!json.status || !json.data) {
          throw new Error(`Angel One auth error: ${json.message || "Unknown error"}`);
        }

        session = {
          jwtToken: json.data.jwtToken,
          feedToken: json.data.feedToken,
          expiresAt: Date.now() + 18 * 60 * 60 * 1000, // JWT valid for 18 hours
        };

        console.log("Angel One auto-logged in successfully.");
        return session;
      } finally {
        loginPromise = null;
      }
    })();

    return loginPromise;
  },

  async loadScripMaster(): Promise<void> {
    if (masterLoaded || masterLoading) return;
    masterLoading = true;
    try {
      try {
        const cached = await fs.readFile(SCRIP_MASTER_FILE, "utf-8");
        masterInstruments = JSON.parse(cached);
        
        // Force reload if cache is old (does not contain SENSEX or FINNIFTY options)
        const hasSensexOpt = masterInstruments.some(
          (x: any) => x.name === "SENSEX" && x.instrumenttype === "OPTIDX"
        );
        const hasFinniftyOpt = masterInstruments.some(
          (x: any) => x.name === "FINNIFTY" && x.instrumenttype === "OPTIDX"
        );
        
        if (!hasSensexOpt || !hasFinniftyOpt) {
          console.log("Cached scrip master missing SENSEX/FINNIFTY options, forcing re-download...");
          throw new Error("force reload");
        }

        masterLoaded = true;
        masterLoading = false;
        return;
      } catch {
        // Cache file not found or outdated, proceed to download
      }

      console.log("Downloading Angel One scrip master JSON (approx. 20-30MB)...");
      const res = await fetch("https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json");
      if (!res.ok) throw new Error(`Angel scrip master failed: ${res.status}`);
      const raw = await res.json();
      if (!Array.isArray(raw)) throw new Error("Invalid scrip master format");

      // Filter to keep only index options & main stocks to save disk space
      masterInstruments = raw.filter((x: any) => {
        const isIndexOption = x.instrumenttype === "OPTIDX" && ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "MIDCPNIFTY"].includes(x.name);
        const isMainEquity = x.exch_seg === "NSE" && x.symbol?.endsWith("-EQ") && x.instrumenttype === "";
        return isIndexOption || isMainEquity;
      });

      await fs.writeFile(SCRIP_MASTER_FILE, JSON.stringify(masterInstruments), "utf-8");
      masterLoaded = true;
    } catch (err) {
      console.error("Failed to load Angel One scrip master:", err);
    } finally {
      masterLoading = false;
    }
  },

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const sess = await this.login();
    const apiKey = process.env.ANGEL_ONE_API_KEY!;
    const clientCode = process.env.ANGEL_ONE_CLIENT_ID!;

    await this.loadScripMaster();

    // Map symbols to Angel One tokens
    const exchangeTokens: Record<string, string[]> = { NSE: [], BSE: [] };
    const tokenToSymbolMap: Record<string, string> = {};

    for (const sym of symbols) {
      const clean = sym.replace(".NS", "").replace(".BO", "").trim();
      
      // Index Check
      if (ANGEL_INDEX_MAP[sym]) {
        const meta = ANGEL_INDEX_MAP[sym];
        exchangeTokens[meta.exchange].push(meta.token);
        tokenToSymbolMap[meta.token] = sym;
      } else if (ANGEL_INDEX_MAP[clean]) {
        const meta = ANGEL_INDEX_MAP[clean];
        exchangeTokens[meta.exchange].push(meta.token);
        tokenToSymbolMap[meta.token] = sym;
      } else {
        // Equity stock check
        const targetSymbol = `${clean}-EQ`;
        const match = masterInstruments.find(
          (x) => x.symbol === targetSymbol && x.exch_seg === "NSE"
        );
        if (match) {
          exchangeTokens.NSE.push(match.token);
          tokenToSymbolMap[match.token] = sym;
        }
      }
    }

    const quotes: Quote[] = [];

    // Query in batches for NSE and BSE separately
    for (const [exchange, tokens] of Object.entries(exchangeTokens)) {
      if (tokens.length === 0) continue;

      // Slice tokens into batches of 50
      for (let i = 0; i < tokens.length; i += 50) {
        const chunk = tokens.slice(i, i + 50);

        const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${sess.jwtToken}`,
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "x-client-code": clientCode,
            "x-feed-token": sess.feedToken,
          },
          body: JSON.stringify({
            mode: "FULL",
            exchangeTokens: { [exchange]: chunk },
          }),
        });

        if (!res.ok) continue;

        const json = await res.json();
        const fetchedList = Array.isArray(json.data)
          ? json.data
          : (json.data?.fetched || []);

        for (const item of fetchedList) {
          const token = item.symbolToken;
          const originalSymbol = tokenToSymbolMap[token] || item.tradingSymbol;
          const price = item.ltp || 0;
          const prevClose = item.close || price;

          quotes.push({
            symbol: originalSymbol,
            name: originalSymbol.replace(".NS", "").replace(".BO", ""),
            price,
            prevClose,
            change: item.netChange || (price - prevClose),
            changePct: item.percentChange || (prevClose ? ((price - prevClose) / prevClose) * 100 : 0),
            dayHigh: item.high || price,
            dayLow: item.low || price,
            open: item.open || price,
            marketState: "LIVE",
            currency: "INR",
            exchange,
          });
        }
      }
    }

    return quotes;
  },

  async getOptionChain(
    symbol: string,
    spotPrice: number,
    targetExpiry?: string
  ): Promise<OptionChain> {
    const sess = await this.login();
    const apiKey = process.env.ANGEL_ONE_API_KEY!;
    const clientCode = process.env.ANGEL_ONE_CLIENT_ID!;

    await this.loadScripMaster();

    // Filter index options from scrip master
    const angelUnderlyingMap: Record<string, string> = {
      SENSEX: "SENSEX",
      MIDCAPNIFTY: "MIDCPNIFTY",
      MIDCPNIFTY: "MIDCPNIFTY",
      FINNIFTY: "FINNIFTY",
    };
    const underlying = angelUnderlyingMap[symbol] || symbol;
    const optionContracts = masterInstruments.filter(
      (x) => x.instrumenttype === "OPTIDX" && x.name === underlying
    );

    if (optionContracts.length === 0) {
      throw new Error(`No Angel One option contracts found for ${symbol}`);
    }

    // Format expiries: convert "25JUN2026" or similar to standard "25-Jun-2026"
    const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthsMap: Record<string, string> = {};
    monthsShort.forEach((m, idx) => {
      monthsMap[m.toUpperCase()] = m;
    });

    const formatAngelExpiry = (expStr: string): string => {
      // E.g. "25JUN2026" -> "25-Jun-2026"
      const day = expStr.substring(0, 2);
      const monRaw = expStr.substring(2, 5).toUpperCase();
      const year = expStr.substring(5);
      const mon = monthsMap[monRaw] || monRaw;
      return `${day}-${mon}-${year}`;
    };

    const parseExpiryToAngelFormat = (standardExp: string): string => {
      // E.g. "25-Jun-2026" -> "25JUN2026"
      const parts = standardExp.split("-");
      if (parts.length !== 3) return standardExp;
      return `${parts[0]}${parts[1].toUpperCase()}${parts[2]}`;
    };

    // Gather all unique expiries
    const uniqueExpiries = Array.from(new Set(optionContracts.map((x) => x.expiry))) as string[];
    uniqueExpiries.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const expiriesFormatted = uniqueExpiries.map(formatAngelExpiry);

    const chosenExpiry = targetExpiry
      ? targetExpiry.includes("-")
        ? parseExpiryToAngelFormat(targetExpiry)
        : targetExpiry
      : uniqueExpiries[0];

    const filtered = optionContracts.filter((x) => x.expiry === chosenExpiry);

    // Group option contracts by strike price
    const strikeGroups = new Map<number, { ce?: any; pe?: any }>();
    for (const opt of filtered) {
      const strike = parseFloat(opt.strike) / 100 || parseFloat(opt.strike) || 0; // check for strike formatting
      const type = opt.symbol.endsWith("CE") ? "CE" : opt.symbol.endsWith("PE") ? "PE" : "";
      
      if (!strike || !type) continue;
      
      if (!strikeGroups.has(strike)) {
        strikeGroups.set(strike, {});
      }
      const group = strikeGroups.get(strike)!;
      if (type === "CE") group.ce = opt;
      if (type === "PE") group.pe = opt;
    }

    const strikesSorted = Array.from(strikeGroups.keys()).sort((a, b) => a - b);
    if (strikesSorted.length === 0) {
      throw new Error(`No option strikes found for ${symbol} on expiry ${chosenExpiry}`);
    }

    // Slice strikes close to spot price
    const spot = spotPrice || 0;
    let idx = strikesSorted.findIndex((s) => s >= spot);
    if (idx === -1) idx = Math.floor(strikesSorted.length / 2);
    const start = Math.max(0, idx - 10);
    const sliceStrikes = strikesSorted.slice(start, start + 21);

    // Gather tokens to query live marketData
    const tokensToQuery: string[] = [];
    const tokenToLegMap: Record<string, { strike: number; side: "ce" | "pe" }> = {};

    for (const strike of sliceStrikes) {
      const grp = strikeGroups.get(strike)!;
      if (grp.ce) {
        tokensToQuery.push(grp.ce.token);
        tokenToLegMap[grp.ce.token] = { strike, side: "ce" };
      }
      if (grp.pe) {
        tokensToQuery.push(grp.pe.token);
        tokenToLegMap[grp.pe.token] = { strike, side: "pe" };
      }
    }

    // Query Angel One Market Data FULL mode
    const exchange = symbol === "SENSEX" ? "BSE" : "NSE";
    const res = await fetch("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sess.jwtToken}`,
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-client-code": clientCode,
        "x-feed-token": sess.feedToken,
      },
      body: JSON.stringify({
        mode: "FULL",
        exchangeTokens: { [exchange]: tokensToQuery },
      }),
    });

    if (!res.ok) {
      throw new Error(`Angel One Market Data API failed: status ${res.status}`);
    }

    const json = await res.json();
    const fetchedList = Array.isArray(json.data)
      ? json.data
      : (json.data?.fetched || []);

    // Build intermediate legs mapping
    const legsMap = new Map<number, { ce?: OcLeg; pe?: OcLeg }>();
    for (const strike of sliceStrikes) {
      legsMap.set(strike, {});
    }

    for (const item of fetchedList) {
      const token = item.symbolToken;
      const mapping = tokenToLegMap[token];
      if (!mapping) continue;

      const oi = item.opnInterest || 0;
      const ltp = item.ltp || 0;
      const volume = item.volume || 0;
      const prevClose = item.close || ltp;
      
      const oiChg = item.chgOi ?? item.changeoi ?? item.oiChange ?? item.netChange ?? 0;
      const prevOi = oi - oiChg;
      const oiChgPct = prevOi > 0 ? (oiChg / prevOi) * 100 : 0;

      const classifyOcSignalLocal = (oiChgPct: number): OcSignal => {
        const m = Math.abs(oiChgPct);
        if (m < 1.5) return "Neutral";
        const strong = m >= 15;
        return oiChgPct > 0
          ? strong ? "Strong Short Buildup" : "Weak Short Buildup"
          : strong ? "Strong Short Cover" : "Weak Short Cover";
      };

      const leg: OcLeg = {
        oi,
        oiChg,
        oiChgPct,
        volume,
        ltp,
        iv: item.iv || 0,
        signal: classifyOcSignalLocal(oiChgPct),
      };

      const grp = legsMap.get(mapping.strike)!;
      if (mapping.side === "ce") grp.ce = leg;
      if (mapping.side === "pe") grp.pe = leg;
    }

    const rows: OcRow[] = sliceStrikes.map((strike) => {
      const grp = legsMap.get(strike)!;
      const ce = grp.ce || null;
      const pe = grp.pe || null;
      return {
        strike,
        ce,
        pe,
        straddle: (ce?.ltp ?? 0) + (pe?.ltp ?? 0),
        pcr: ce && ce.oi ? (pe?.oi ?? 0) / ce.oi : 0,
      };
    });

    const ceOis = rows.map((r) => ({ s: r.strike, v: r.ce?.oi ?? 0 })).sort((a, b) => b.v - a.v);
    const peOis = rows.map((r) => ({ s: r.strike, v: r.pe?.oi ?? 0 })).sort((a, b) => b.v - a.v);
    const ceVols = rows.map((r) => ({ s: r.strike, v: r.ce?.volume ?? 0 })).sort((a, b) => b.v - a.v);
    const peVols = rows.map((r) => ({ s: r.strike, v: r.pe?.volume ?? 0 })).sort((a, b) => b.v - a.v);
    const ceOiShift = rows.map((r) => ({ s: r.strike, v: r.ce?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);
    const peOiShift = rows.map((r) => ({ s: r.strike, v: r.pe?.oiChg ?? 0 })).sort((a, b) => b.v - a.v);

    const totals = {
      ceOi: rows.reduce((a, r) => a + (r.ce?.oi ?? 0), 0),
      peOi: rows.reduce((a, r) => a + (r.pe?.oi ?? 0), 0),
      ceOiChg: rows.reduce((a, r) => a + (r.ce?.oiChg ?? 0), 0),
      peOiChg: rows.reduce((a, r) => a + (r.pe?.oiChg ?? 0), 0),
      ceVol: rows.reduce((a, r) => a + (r.ce?.volume ?? 0), 0),
      peVol: rows.reduce((a, r) => a + (r.pe?.volume ?? 0), 0),
    };

    const r1 = ceOis[0]?.s ?? 0;
    const r2 = ceOiShift[0]?.s ?? 0;
    const s1 = peOis[0]?.s ?? 0;
    const s2 = peOiShift[0]?.s ?? 0;

    const levels = [
      { strike: r1, kind: "R1" as const, basis: "oi" as const },
      { strike: r2 && r2 !== r1 ? r2 : (ceOis[1]?.s ?? r1), kind: "R2" as const, basis: "oiShift" as const },
      { strike: s1, kind: "S1" as const, basis: "oi" as const },
      { strike: s2 && s2 !== s1 ? s2 : (peOis[1]?.s ?? s1), kind: "S2" as const, basis: "oiShift" as const },
    ];

    return {
      symbol,
      spot,
      expiry: formatAngelExpiry(chosenExpiry),
      expiries: expiriesFormatted,
      rows,
      maxCeOiStrike: r1,
      maxPeOiStrike: s1,
      maxCeVolStrike: ceVols[0]?.s ?? 0,
      maxPeVolStrike: peVols[0]?.s ?? 0,
      second: {
        ceOi: ceOis[1]?.s ?? 0,
        peOi: peOis[1]?.s ?? 0,
        ceVol: ceVols[1]?.s ?? 0,
        peVol: peVols[1]?.s ?? 0,
      },
      totals,
      levels,
      source: "angelone",
      updatedAt: Date.now(),
    };
  },
};

// Automate login immediately on backend import (startup)
angelOneService.login().catch((err) => {
  console.error("Angel One initial auto-login failed:", err.message);
});

// Start master list pre-loading in background
angelOneService.loadScripMaster().catch((err) => {
  console.log("Angel scrip master background load failed:", err.message);
});
