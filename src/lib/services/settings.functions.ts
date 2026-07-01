import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getFyersConfig, saveFyersToken } from "./configStore";
import { angelOneService } from "./angelOneService";
import { upstoxService } from "./upstoxService";
import { fyersService } from "./fyersService";
import { isBrokerAvailable } from "./circuitBreaker";

export interface SettingsStatus {
  upstox: { configured: boolean; ok: boolean; available: boolean; error?: string };
  angelOne: { configured: boolean; ok: boolean; available: boolean; error?: string };
  fyers: { configured: boolean; ok: boolean; available: boolean; isExpired: boolean; error?: string; maskedToken?: string };
  activeRoutes: {
    quotes: string;
    futuresOI: string;
    optionChain: string;
  };
}

export const getSettingsStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<SettingsStatus> => {
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
      process.env.ANGEL_ONE_CLIENT_ID &&
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
        }
      } catch (err: any) {
        angelErr = err.message;
      }
    }

    // 3. Fyers check
    const fyersConf = await getFyersConfig();
    const fyersConfigured = !!fyersConf.accessToken;
    let fyersOk = false;
    let fyersErr = fyersConf.expiryError || "";
    
    if (fyersConfigured && !fyersConf.isExpired) {
      try {
        // Quick connection test using Nifty option chain (with a dummy spot price)
        await fyersService.getOptionChain("NIFTY", 24500);
        fyersOk = true;
      } catch (err: any) {
        fyersErr = err.message;
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
    const activeOptionChain = (fyersConfigured && fyersOk && fyersAvail) ? "fyers" : ((angelConfigured && angelOk && angelAvail) ? "angelone" : "nse");

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

export const saveFyersTokenFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().trim().min(1) }))
  .handler(async ({ data }) => {
    await saveFyersToken(data.token);
    return { success: true };
  });
