import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface SettingsStatus {
  upstox: { configured: boolean; ok: boolean; available: boolean; error?: string };
  angelOne: { configured: boolean; ok: boolean; available: boolean; error?: string };
  fyers: { configured: boolean; ok: boolean; available: boolean; isExpired: boolean; error?: string; statusText?: string; maskedToken?: string };
  activeRoutes: {
    quotes: string;
    futuresOI: string;
    optionChain: string;
  };
}

const redactSecret = (message: string, secret?: string) => {
  if (!secret) return message;
  return message.split(secret).join("[REDACTED]");
};

export const getSettingsStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsStatus> => {
    // Dynamically import server-only modules so they are not loaded by the browser bundle
    const { getFyersConfig } = await import("./services/configStore");
    const { angelOneService } = await import("./services/angelOneService");
    const { upstoxService } = await import("./services/upstoxService");
    const { fyersService, isFyersAuthError } = await import("./services/fyersService");
    const { isBrokerAvailable } = await import("./services/circuitBreaker");

    // 1. Upstox check
    const upstoxToken = process.env.UPSTOX_ACCESS_TOKEN;
    let upstoxOk = false;
    let upstoxErr = "";
    if (upstoxToken) {
      try {
        // Quick quote test (using Nifty 50)
        await upstoxService.getQuotes(["^NSEI"]);
        upstoxOk = true;
      } catch (err: any) {
        upstoxErr = err.message;
      }
    }

    // 2. Angel One check
    const angelConfigured = !!(
      (process.env.ANGEL_ONE_CLIENT_CODE || process.env.ANGEL_ONE_CLIENT_ID) &&
      process.env.ANGEL_ONE_MPIN &&
      process.env.ANGEL_ONE_API_KEY &&
      process.env.ANGEL_ONE_TOTP_SECRET
    );
    let angelOk = false;
    let angelErr = "";
    if (angelConfigured) {
      try {
        const sess = await angelOneService.login();
        if (sess && sess.jwtToken) {
          angelOk = true;
          console.log("Angel One health check connected");
        }
      } catch (err: any) {
        let cleanMsg = err.message || "Unknown error during Angel One authentication.";
        // Sanitize credentials to prevent leak
        cleanMsg = redactSecret(cleanMsg, process.env.ANGEL_ONE_MPIN);
        cleanMsg = redactSecret(cleanMsg, process.env.ANGEL_ONE_TOTP_SECRET);
        cleanMsg = redactSecret(cleanMsg, process.env.ANGEL_ONE_API_KEY);
        cleanMsg = redactSecret(cleanMsg, process.env.ANGEL_ONE_CLIENT_CODE);
        cleanMsg = redactSecret(cleanMsg, process.env.ANGEL_ONE_CLIENT_ID);
        angelErr = cleanMsg;
        console.error(`Angel One health check failed: ${cleanMsg}`);
      }
    }

    // 3. Fyers check
    const fyersConf = await getFyersConfig();
    const fyersConfigured = !!fyersConf.accessToken;
    let fyersOk = false;
    let fyersErr = "";
    let fyersStatusText = "Missing Token";
    
    if (fyersConfigured) {
      try {
        // Quick connection test using Nifty option chain (with a dummy spot price)
        await fyersService.getOptionChain("NIFTY", 24500);
        fyersOk = true;
        fyersStatusText = "Connected";
      } catch (err: any) {
        fyersErr = err.message || "Unknown error";
        const isAuthErr = isFyersAuthError({ message: fyersErr }) || 
                          fyersErr.includes("401") || 
                          fyersErr.toLowerCase().includes("unauthorized") || 
                          fyersErr.toLowerCase().includes("invalid token") ||
                          fyersErr.toLowerCase().includes("token");
                          
        if (isAuthErr) {
          if (fyersErr.toLowerCase().includes("expire") || fyersConf.isExpired) {
            fyersStatusText = "Expired Token";
          } else {
            fyersStatusText = "Invalid Token";
          }
        } else {
          fyersStatusText = "API Connection Error";
        }
      }
    }

    const maskToken = (token?: string) => {
      if (!token) return "";
      if (token.length <= 10) return "****";
      return `${token.substring(0, 6)}...${token.substring(token.length - 6)}`;
    };

    const upstoxAvail = isBrokerAvailable("upstox");
    const angelAvail = isBrokerAvailable("angelone");
    const fyersAvail = isBrokerAvailable("fyers");

    const activeQuotes = (!!upstoxToken && upstoxOk && upstoxAvail) ? "upstox" : "yahoo";
    const activeFuturesOI = (angelConfigured && angelOk && angelAvail) ? "angelone" : "nse";
    const activeOptionChain =
      !!upstoxToken && upstoxOk && upstoxAvail
        ? "upstox"
        : fyersConfigured && fyersOk && fyersAvail
          ? "fyers"
          : angelConfigured && angelOk && angelAvail
            ? "angelone"
            : "nse";

    return {
      upstox: {
        configured: !!upstoxToken,
        ok: upstoxOk,
        available: upstoxAvail,
        error: upstoxErr || undefined,
      },
      angelOne: {
        configured: angelConfigured,
        ok: angelOk,
        available: angelAvail,
        error: angelErr || undefined,
      },
      fyers: {
        configured: fyersConfigured,
        ok: fyersOk,
        available: fyersAvail,
        isExpired: fyersConf.isExpired,
        error: fyersErr || undefined,
        statusText: fyersStatusText,
        maskedToken: maskToken(fyersConf.accessToken),
      },
      activeRoutes: {
        quotes: activeQuotes,
        futuresOI: activeFuturesOI,
        optionChain: activeOptionChain,
      },
    };
  }
);

function cleanFyersToken(input: string): string {
  let cleaned = input.trim();
  if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
    try {
      const normalized = cleaned.replace(/'/g, '"');
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed.access_token === "string") {
        cleaned = parsed.access_token.trim();
      } else if (parsed && typeof parsed.accessToken === "string") {
        cleaned = parsed.accessToken.trim();
      }
    } catch (e) {
      const match = cleaned.match(/['"]access_token['"]\s*:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        cleaned = match[1].trim();
      }
    }
  }
  return cleaned.replace(/\s+/g, "");
}

export const saveFyersTokenFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().trim().min(1) }))
  .handler(async ({ data }) => {
    const { saveFyersToken } = await import("./services/configStore");
    const sanitizedToken = cleanFyersToken(data.token);
    await saveFyersToken(sanitizedToken);
    return { success: true };
  });
