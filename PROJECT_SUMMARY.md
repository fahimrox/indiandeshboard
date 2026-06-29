# Project Summary: Indian Stock Market Dashboard

This document provides a comprehensive technical overview of the **Indian Stock Market Dashboard** project. It serves as a standalone reference guide for developers and AI agents to understand the repository structure, data flow, tech stack, and API design without needing to explore the codebase from scratch.

---

## 🚀 Tech Stack & Core Libraries

- **Framework**: [TanStack Start](https://tanstack.com/router/latest/docs/start/overview) (Full-stack React framework built on TanStack Router, Vite, and Nitro).
- **Routing**: [TanStack Router](https://tanstack.com/router) (Typesafe routing with automatic route generation).
- **Data Fetching**: [TanStack React Query](https://tanstack.com/query) (State management, caching, and auto-refetching).
- **Styling**: Tailwind CSS v4 (configured via `@tailwindcss/vite` inside `src/styles.css` with a customized dark theme).
- **UI Components**: Radix UI primitives styled via [Shadcn UI](https://ui.shadcn.com/) located in `src/components/ui`.
- **Charts & Visualizations**:
  - [ECharts](https://echarts.apache.org/) (via `echarts-for-react` for advanced rendering, e.g., index contributions).
  - [Recharts](https://recharts.org/) (for simpler charts).
- **Form & Validation**: `react-hook-form` + `zod` for typesafe input validation.
- **Package Manager**: Bun (using `bun.lock` and `bunfig.toml` alongside npm's `package-lock.json`).

---

## 📂 Project Structure & Directory Layout

```
.
├── .env / .env.example             # Configuration variables for API credentials
├── package.json                    # Project dependencies & scripts
├── vite.config.ts                  # Vite build-system setup
├── tsconfig.json                   # TypeScript rules and path aliases
├── fyers_config.enc                # Encrypted FYERS tokens (created at runtime)
├── angel_one_scrip_master.json     # Filtered local instrument cache for Angel One API
├── upstox_instruments.json         # Filtered local instrument cache for Upstox API
├── generate_auth_url.py            # Python helper for FYERS OAuth login URL
├── generate_token.py               # Python helper for exchanging FYERS auth code for tokens
├── eod_cache/                      # Local JSON cache for End-of-Day market snapshots
└── src/
    ├── server.ts                   # TanStack Start backend entry point
    ├── start.ts                    # TanStack Start client entry point
    ├── router.tsx                  # TanStack Router instance configuration
    ├── routeTree.gen.ts            # Auto-generated routing table
    ├── styles.css                  # Tailwind v4 imports and design tokens
    ├── routes/                     # Pages / Endpoints (TanStack Router file-based routing)
    ├── components/                 # React components (ui/, layout/, and page-specific)
    ├── features/                   # Core business features (AI Sentiment, OI Analysis)
    ├── hooks/                      # Custom React hooks (market-hours, debounce, responsive)
    └── lib/                        # Services, data layer, and server-side RPC functions
```

---

## 🔄 Data Architecture & Broker APIs

The dashboard uses a multi-tier fallback architecture to retrieve real-time quotes, options chain data, and sector performance:

- **Quotes Feed**: Tries **Upstox** $\rightarrow$ **Angel One** $\rightarrow$ **Yahoo Finance**.
- **Option Chains Feed**: Tries **FYERS** $\rightarrow$ **Angel One** $\rightarrow$ **NSE Scraper** $\rightarrow$ **Local EOD cache** $\rightarrow$ **Synthetic mock generator** (to prevent UI crashes).

### 1. **Data Layer Orchestrator** ([marketDataLayer.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/marketDataLayer.ts))
Determines which broker feeds to fetch from depending on availability:
- **Quotes**: Tries **Upstox** $\rightarrow$ **Angel One** $\rightarrow$ **Yahoo Finance**.
- **Option Chains**: Tries **FYERS** $\rightarrow$ **Angel One** $\rightarrow$ **NSE Scraper** $\rightarrow$ **Local EOD cache** $\rightarrow$ **Synthetic mock generator**.

### 2. **Integrations & Services** (`src/lib/services/`)
- **Upstox Service** ([upstoxService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/upstoxService.ts)):
  - Fetches index and equity quotes.
  - Downloads and decompresses the Upstox NSE instrument list (`NSE.json.gz`) to map trading symbols to their unique `instrument_key` IDs (stored in `upstox_instruments.json`).
- **Angel One Service** ([angelOneService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/angelOneService.ts)):
  - Automated login using `clientCode`, `mpin`, `apiKey`, and generating TOTP tokens.
  - Fetches option chains by downloading the Angel One OpenAPI master list, filtering indices (`NIFTY`, `BANKNIFTY`, `SENSEX`) and main equities, saving them to `angel_one_scrip_master.json`.
- **FYERS Service** ([fyersService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/fyersService.ts)):
  - Primary source for options chains using the `options-chain-v3` API endpoint.
- **NSE Fallback Service** ([nseFallbackService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/nseFallbackService.ts)):
  - Performs direct scraper fetches from `nseindia.com`. Retrieves cookie values from the homepage first and then requests option chain data by contract or index.
- **Yahoo Finance Service** ([yahooService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/yahooService.ts)):
  - Uses the public `spark` and `chart` REST endpoints. Used for quotes backup and charting historical stock movements.

### 3. **Persistent Cache & Settings**
- **EOD Cache** ([persistentCache.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/persistentCache.ts)): Saves valid real-time response records on the server's disk inside the `eod_cache/` folder. Acts as a fail-safe backup for when live API data is missing or rate-limited.
- **Config Storage** ([configStore.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/configStore.ts)): Encrypts and decrypts Fyers configurations on disk in `fyers_config.enc` using **AES-256-CBC** encryption.

---

## ⚡ Server-Side RPC Functions (`.functions.ts` files)

TanStack Start handles API routes through **Server Functions** that act as remote RPC endpoints:

- **Market Functions** ([market.functions.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/market.functions.ts)):
  - `getQuotes`: Retrieves prices for an array of ticker symbols.
  - `getDashboard`: Orchestrates the main landing page data (index values, top sector gains, and top gainers/losers).
  - `getIndexConstituents`: Fetches components of indices (NIFTY 50, BANK NIFTY, SENSEX).
  - `getIndexContributions`: Computes weighted points contribution of individual constituent stocks (e.g. Reliance, HDFC Bank) toward index movement.
- **NSE Functions** ([nse.functions.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/nse.functions.ts)):
  - `getOptionChain`: Pulls live options contracts, calculating Put-Call Ratio (PCR) and Support/Resistance levels (R1, R2, S1, S2).
  - `getFnoStocks` & `getFnoScreener`: Analyzes open interest buildup flags (Long Buildup, Short Buildup, Short Covering, Long Unwinding, Volume Shockers).

---

## 🗺️ Routing & Page Architecture (`src/routes/`)

TanStack Router loads layout structures dynamically based on file names:

1. **`__root.tsx`** ([__root.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/__root.tsx))
   - Root page shell. Defines metadata tags, sets up the stylesheet path, and injects the global `QueryClientProvider` context.
2. **`index.tsx`** ([index.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/index.tsx))
   - Home Dashboard. Features index hero cards, market breadth meters (advances vs declines), average change, sector indices, and an **AI Sentiment commentary block**.
3. **`optionchain.tsx`** ([optionchain.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/optionchain.tsx))
   - Options analytics dashboard. Renders interactive Call/Put lists, signal indicators (Short Cover, Long Unwind), and 4-tier support and resistance metrics.
4. **`index-contribution.tsx`** ([index-contribution.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/index-contribution.tsx))
   - Real-time stock contribution graphs. Renders an interactive waterfall/bar chart using ECharts to visualize stock impact.
5. **`future-dashboard.tsx`** / `fno.tsx` / `fnoboard.tsx`
   - Features tracking derivative metrics, contracts, and future rollovers.
6. **`screener.tsx`** ([screener.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/screener.tsx))
   - F&O Screener. Filters stocks breaking their Day/Week/Month Highs or Lows, or experiencing volume shocks.
7. **`oi-analysis.tsx`** ([oi-analysis.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/oi-analysis.tsx))
   - Detailed open interest buildup charting dashboard.
8. **`heatmap.tsx`** ([heatmap.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/heatmap.tsx))
   - Sector Heatmap dashboard visualizing performance across industries.
9. **`banknifty.tsx`** / `nifty50.tsx` / `sensex.tsx`
   - Index tracking routes with live quotes and constituents lists.
10. **`sector.$key.tsx`** ([sector.$key.tsx](file:///d:/Lovable%20Deshboard/indiandeshboard/src/routes/sector.$key.tsx))
    - Dynamic route showcasing constituent stocks of a chosen sector (IT, Pharma, Banking, etc.).

---

## 🔒 Configuration & Environment Variables (`.env`)

To run the application, the backend requires broker API configurations inside `.env`:

```bash
# UPSTOX (Primary Quotes feed)
UPSTOX_ACCESS_TOKEN=your_upstox_access_token_here

# ANGEL ONE (Backup feed & Options)
ANGEL_ONE_CLIENT_ID=your_client_id
ANGEL_ONE_MPIN=your_login_mpin
ANGEL_ONE_API_KEY=your_developer_key
ANGEL_ONE_TOTP_SECRET=your_totp_secret_key

# FYERS (Primary Options feed)
FYERS_CLIENT_ID=your_fyers_app_id
FYERS_SECRET_KEY=your_fyers_secret_key

# SECURITY
ENCRYPTION_KEY=lovable-indian-dashboard-salt-12345
```

---

## 📝 Guidelines for Future Code Writing

When implementing features or bug fixes in the future, adhere to the following conventions:

1. **Vite bundling boundaries**: Always write server-only imports (e.g. `fs`, `path`, `crypto`, broker APIs) within files marked as `.server.ts` or inside server functions (`.functions.ts` / `createServerFn`). This prevents Vite from compiling Node libraries into client-side JS.
2. **Typesafety**: Always update input validation validators (`zod` schemas) in `market.functions.ts` and `nse.functions.ts` when introducing new parameters.
3. **Graceful Fallbacks**: Ensure any data fetch wrapper is integrated inside `marketDataLayer.ts` to fallback to backups (Angel One/Yahoo/NSE/Synthetic) automatically if the primary feed fails. Never let a single service downtime crash the dashboard pages.
4. **Tailwind CSS versioning**: The application uses **Tailwind CSS v4**. Custom design tokens (bull/bear colors, neon variables, card backgrounds) must be defined inside `@theme inline` in [src/styles.css](file:///d:/Lovable%20Deshboard/indiandeshboard/src/styles.css) rather than tailwind configurations.
