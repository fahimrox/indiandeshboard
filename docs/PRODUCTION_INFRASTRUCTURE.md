# Production Infrastructure & Deployment Guide

> **Single source of truth for the production infrastructure, runtime, deployment,
> and security of the Bazaar Mood / Indian Dashboard project.**
> Written for developers and AI coding agents to ensure production stability and
> prevent deployment failures.

---

## 1. Project & Domain Registry

- **GitHub Repository:** [fahimrox/indiandeshboard](https://github.com/fahimrox/indiandeshboard)
- **Production Branch:** `main`
- **Local Workspace Path:** `D:\Lovable Deshboard\indiandeshboard`
- **Live Domain:** [https://bazaarmood.com](https://bazaarmood.com)
- **Also configured:** [https://www.bazaarmood.com](https://www.bazaarmood.com)

---

## 2. Server Infrastructure (Oracle Cloud VMs)

The Bazaar Mood / Indian Dashboard project spans two separate virtual machines hosted on Oracle Cloud Infrastructure (OCI), both in the India West (Mumbai) region.

### 2.1 Production Application VM (`indian-dashboard-collector`)
This VM runs the main Indian Stock Market Dashboard application and the background market data collector. **It must remain untouched during OpenAlgo configuration or maintenance.**

| Parameter | Confirmed Value |
|-----------|-----------------|
| **VM Name** | `indian-dashboard-collector` |
| **Operating System** | Ubuntu 22.04 LTS |
| **Compute Shape** | `VM.Standard.A1.Flex` (ARM-based Ampere) |
| **Resources** | 1 OCPU, 6 GB RAM |
| **Public IP Address** | `92.4.75.251` |
| **Private IP Address** | `10.0.1.160` |
| **SSH User** | `ubuntu` |
| **Production App Directory** | `/home/ubuntu/apps/indiandeshboard` |

### 2.2 Broker Middleware VM (`Bazaarmood2`)
This VM is a dedicated host for OpenAlgo, running the broker connection middleware separate from the main dashboard application.

| Parameter | Confirmed Value |
|-----------|-----------------|
| **VM Name** | `Bazaarmood2` |
| **Operating System** | Ubuntu 22.04 LTS ARM64 |
| **Compute Shape** | `VM.Standard.A1.Flex` (ARM-based Ampere) |
| **Resources** | 1 OCPU, 6 GB RAM |
| **Public IP Address** | `146.56.55.42` |
| **SSH User** | `ubuntu` |
| **Domain Name** | `https://openalgo.bazaarmood.com` |

### 2.3 Oracle Always Free Capacity Warning
The combined resource footprint of both active VMs utilizes the maximum capacity permitted under a standard Oracle Cloud Always Free tier:
- **Total OCPUs:** 2 OCPUs (out of 4 max)
- **Total RAM:** 12 GB RAM (out of 24 GB max)
- **Total Boot Storage:** 94 GB (47 GB each VM)

> [!WARNING]
> Do not spin up any additional ARM virtual machines, or increase OCPU/RAM sizes on either VM, without verifying Oracle Always Free capacity constraints. Creating a third VM or resizing may result in billing charges or instance suspension.


---

## 3. Server Runtime & Network Configuration

- **Process Manager:** PM2 manages the Node server process.
  - **Process Name:** `indian-dashboard`
  - **PM2 state** is saved with `pm2 save` after each deployment.
- **Binding Restriction:** The application server binds **exclusively** to
  `127.0.0.1:3000` (localhost only — never exposed directly to public traffic).
- **Public Reverse Proxy:** Nginx runs on the host, listening on public ports
  `80` (HTTP) and `443` (HTTPS) and proxies requests to PM2.
- **Firewall & Security Lists:**
  - Public access to port `3000` is strictly **closed** in the OCI Security List
    and host `iptables`.
  - `iptables` rules are persisted using `netfilter-persistent`.
- **SSL Certificate:** Active Let's Encrypt certificate managed via certbot on Nginx.

---

## 4. Critical Build & Deployment Pipeline

### 4.1 Production Build Command

> [!CAUTION]
> **This rule is non-negotiable.** Every Oracle production build MUST explicitly
> set the server preset:
>
> ```bash
> NITRO_PRESET=node-server npm run build
> ```
>
> Plain `npm run build` may default to a Cloudflare-oriented preset
> (`cloudflare-module`) and will cause a **502 Bad Gateway** error in production.
> Never replace or simplify this command in Oracle deployment instructions.

### 4.2 Deployment Script

- **Script Path on VM:** `/home/ubuntu/deploy-indian-dashboard.sh`
- **Script Operations:**
  1. Performs `git pull` from the `main` branch.
  2. Runs `npm install` to update dependencies.
  3. Builds using `NITRO_PRESET=node-server npm run build`.
  4. Restarts the PM2 process with `HOST=127.0.0.1` and `PORT=3000`.
  5. Saves the PM2 process list (`pm2 save`).

> [!IMPORTANT]
> **Deployment Policy:** Local coding changes and production deployments are
> **separate operations**. AI agents are strictly forbidden from triggering or
> executing production deployments without explicit user approval.

---

## 5. Data Services & Pipeline Architecture

### 5.1 Dual-Storage Architecture (CRITICAL)

The production collector uses **dual storage** — both stores are written on every
scheduler tick during market hours.

| Store | Location | Role |
|-------|----------|------|
| **SQLite (primary)** | `backend/database/market_data.db` | Local, synchronous, always written |
| **Supabase Postgres** | Cloud (env: `SUPABASE_URL`) | Cloud mirror, async fire-and-forget |

Environment flag that enables cloud mirroring:
```env
SUPABASE_DUAL_WRITE=true
```

**Normal market-hours flow (09:15 – 15:30 IST):**
```
Market data sources
  → Oracle scheduler  (src/lib/services/scheduler.server.ts)
  → SQLite local write          ← always, synchronous (primary)
  → Supabase dual-write         ← fire-and-forget, non-blocking
```

> [!WARNING]
> Supabase dual-write is **fire-and-forget** — it must never block or throw on
> the SQLite path. If Supabase fails, the local SQLite write still succeeds.

### 5.2 Critical Collector Files

> **DO NOT** casually rewrite, relocate, delete, rename, or refactor these files.
> They are the production data collection backbone.

| File | Role |
|------|------|
| `src/lib/services/scheduler.server.ts` | Tick orchestration + dual-write hooks |
| `src/lib/services/supabase.server.ts` | Supabase client singleton + all insert helpers |
| `src/lib/services/database.server.ts` | SQLite schema, WAL config, all write/read helpers |

**Before modifying any of these files**, the agent MUST:
1. Read `AGENTS.md` → `PROJECT_MASTER.md` → `PRODUCTION_INFRASTRUCTURE.md` → `SESSION_HANDOVER.md`
2. Understand both the SQLite and Supabase schemas (see §6 below)
3. Preserve dual-write behaviour (SQLite primary, Supabase fire-and-forget)
4. Run build validation: `NITRO_PRESET=node-server npm run build`
5. Explain the migration impact and update documentation

### 5.3 Scheduler

- **Orchestration:** The intraday scheduler (`scheduler.server.ts`) runs every
  **~60 seconds** during market hours.
- **Each tick captures:** index quotes, market breadth, sector strength, and option
  chain snapshots — writing all to SQLite and (if enabled) Supabase.
- **At market close:** performs DB backup + 180-day prune.

### 5.4 Broker Fallback Priority

| Feature | Fallback chain |
|---------|---------------|
| **Quotes** | Upstox → Yahoo → EOD cache → throw |
| **Option Chain** | FYERS → Angel One → NSE → EOD cache → FAIL |
| **F&O OI** | NSE OI-spurts + Yahoo → EOD cache → empty `[]` |

---

## 6. Database Schemas

### 6.1 SQLite Tables (`backend/database/market_data.db`)

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `market_snapshots` | `id`, `index_name`, `timestamp`, `ltp`, `change_pct`, `change_val` | 4 rows per tick (one per index) |
| `market_breadth` | `id`, `timestamp`, `advances`, `declines`, `adr` | 1 row per tick |
| `sector_strength` | `id`, `timestamp`, `name`, `change_pct` | 12 rows per tick |
| `option_chain_snapshots` | `id` (UUID), `index_name`, `expiry`, `timestamp` | 3 rows per tick |
| `oi_activity` | `id`, `snapshot_id` (UUID FK), `strike`, `ce_oi`, `pe_oi` | 21 rows per option_chain_snapshot |
| `trade_signals` | `id`, `timestamp`, `signal_type` | Currently empty (separate feature) |
| `system_logs` | `id`, `timestamp`, `message` | Scheduler lifecycle events |

### 6.2 Supabase Tables (mirror of SQLite)

Same structure as SQLite. All tables populated via dual-write from the scheduler.

> [!CAUTION]
> **Critical Supabase schema relationships — do not alter without a migration plan:**
>
> - `option_chain_snapshots.id` = **UUID** (primary key)
> - `oi_activity.snapshot_id` = **UUID** foreign key → `option_chain_snapshots(id)`
>   with `ON DELETE CASCADE`
> - **Never change `oi_activity.snapshot_id` back to `bigint`.**

### 6.3 Supabase Schema Fixes Applied (13 July 2026)

The following columns were added or corrected to align the Supabase schema with
the current scheduler insert payload:

| Table | Fix |
|-------|-----|
| `market_snapshots` | Added `change_pct`, `change_val`; aligned other missing fields |
| `option_chain_snapshots` | Added `expiry`; aligned current snapshot fields |
| `market_breadth` | Added `adr` |
| `sector_strength` | Added `change_pct`, `name`; removed old `sector_name NOT NULL` blocker |
| `oi_activity` | `snapshot_id` changed from `bigint` → `UUID`; FK + `ON DELETE CASCADE` added; removed old `symbol NOT NULL` blocker |

### 6.4 Supabase Unique Business-Key Indexes (14 July 2026)

To enforce data integrity and prevent duplicate records during dual-writes, five composite unique indexes are defined on Supabase Postgres. These map to the canonical business keys (excluding `snapshot_time` which contains duplicates in 13 July historical data):

| Table | Index Name | Business Key Columns |
|-------|------------|-----------------------|
| `market_snapshots` | `uq_market_snapshots_business_key` | `trading_date`, `trading_time`, `symbol` |
| `market_breadth` | `uq_market_breadth_business_key` | `trading_date`, `trading_time` |
| `sector_strength` | `uq_sector_strength_business_key` | `trading_date`, `trading_time`, `symbol` |
| `option_chain_snapshots` | `uq_option_chain_snapshots_business_key` | `trading_date`, `trading_time`, `symbol`, `expiry` |
| `oi_activity` | `uq_oi_activity_business_key` | `snapshot_id`, `strike` |

*Excluded:* `system_logs` (logging duplicates is permitted), `trade_signals` (currently unused/different schema), and any `snapshot_time` columns.

#### Option-Chain Parent-ID Fallback
When a duplicate option chain snap arrives, Postgres ignores the insert (`ON CONFLICT DO NOTHING`) and returns zero rows. To prevent failure of child `oi_activity` insertions, `insertOptionChainSnapshot` safely queries the database for the existing row's ID using `.maybeSingle()` as a fallback when the upsert returns an empty array.

#### Rollback SQL Migration
To drop these unique indexes if needed:
```sql
DROP INDEX IF EXISTS uq_market_snapshots_business_key;
DROP INDEX IF EXISTS uq_market_breadth_business_key;
DROP INDEX IF EXISTS uq_sector_strength_business_key;
DROP INDEX IF EXISTS uq_option_chain_snapshots_business_key;
DROP INDEX IF EXISTS uq_oi_activity_business_key;
```

---

## 7. Verified Full-Day Production Data (13 July 2026)

The Oracle SQLite successfully stored the complete market session:
- **Session start:** ~09:15:10 IST
- **Session end:** ~15:30:10 IST

**Verified SQLite counts:**

| Table | Count | Interpretation |
|-------|-------|---------------|
| `market_snapshots` | **1504** | 4 index rows × 376 ticks |
| `market_breadth` | **376** | 1 row per scheduler tick |
| `sector_strength` | **4512** | 12 sector rows per tick |
| `option_chain_snapshots` | **1128** | 3 snapshots per tick |
| `oi_activity` | **23688** | 21 OI rows per option-chain snapshot |
| `trade_signals` | **0** | Separate feature, not yet active |

**Supabase backfill (13 July 2026) result:**

The same full trading-day dataset was successfully backfilled and verified in
Supabase. Final Supabase counts match the SQLite counts exactly:

| Table | Count |
|-------|-------|
| `market_snapshots` | **1504** |
| `market_breadth` | **376** |
| `sector_strength` | **4512** |
| `option_chain_snapshots` | **1128** |
| `oi_activity` | **23688** |

The temporary backfill script was deleted after a successful run.

---

## 8. Current Verification Status

| Item | Status |
|------|--------|
| Oracle app online under PM2 | ✅ Confirmed |
| SQLite full-day storage working | ✅ Confirmed |
| Supabase schema aligned with insert payload | ✅ Confirmed |
| Full-day Supabase backfill (13 Jul 2026) complete | ✅ Confirmed |
| PM2 state saved (`pm2 save`) | ✅ Confirmed |
| `SUPABASE_DUAL_WRITE=true` active in production | ✅ Confirmed |
| Automatic Supabase dual-write during live market session | ✅ Confirmed (14 July 2026) |

---

## 9. Automatic Live Dual-Write Verification Milestone (14 July 2026)

The pending live verification is officially **closed** and marked as **verified complete** on **14 July 2026, 18:01 IST**.

During the live trading session from **09:15:03 to 15:30:03 IST**, the scheduler saved ticks continuously to local SQLite and automatically dual-wrote them to Supabase Postgres.

**Verification Results:**
1. **PM2 logs check:** Confirmed that no fresh Supabase schema or insert errors appeared in PM2 logs.
2. **Database consistency:** Automatic row counts in Supabase matched the local SQLite database exactly for the four verified metrics:

| Table | 14 July Count | Meaning |
|-------|---------------|---------|
| `market_snapshots` | 1504 | 4 index rows × 376 ticks |
| `market_breadth` | 376 | 1 per scheduler tick |
| `sector_strength` | 4512 | 12 rows per tick |
| `option_chain_snapshots` | 1128 | 3 per tick |

*(Note: Schema design, including the `oi_activity.snapshot_id` foreign key relationship being UUID-based, was verified previously during the 13 July schema alignment milestone).*

---

## 10. Infrastructure Security Rules

- **Zero Secret Commits:** Never commit or expose `.env` values or credentials.
- **Sensitive variables that must never be logged or exposed:**
  - `ANGEL_ONE_MPIN`, `ANGEL_ONE_TOTP_SECRET`
  - Broker API keys and secrets
  - Session/access tokens, JWTs, refresh tokens
  - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
  - SSH private keys (`.pem` / `.pub`)
- **Immutable during routine tasks:** Nginx config, SSL settings,
  firewall/iptables rules, PM2 structures, host bindings, deployment scripts,
  scheduler startup logic, SQLite schemas, production `.env`.

---

## 11. Server/Client Boundary Rule

Node-only code must **never** enter the browser bundle. Dynamic imports are used
to keep Node-only modules out of the client bundle.

**Server-only modules (must stay in `*.server.ts` / `*.functions.ts`):**
- `node:fs`, `node:path`
- SQLite (`better-sqlite3`)
- Configuration stores (`configStore`, `config.server.ts`)
- Secret-key access
- Supabase service-role logic (`supabase.server.ts`)

Do not add static client-side imports that pull server-only services into
React/browser code.

---

## 12. Known Issues & Resolutions

### 12.1 Angel One Client Key — Resolved

- **Previous inconsistency:** `angelOneService.ts` used `ANGEL_ONE_CLIENT_CODE`;
  `settings.functions.ts` checked `ANGEL_ONE_CLIENT_ID`.
- **Resolution (2026-07-13):** Codebase standardised on `ANGEL_ONE_CLIENT_CODE`.
  A robust fallback to `ANGEL_ONE_CLIENT_ID` remains in both files for backward
  compatibility with environments that have not yet updated their `.env`.
- **Status:** ✅ Resolved — `CLIENT_CODE` is canonical; `CLIENT_ID` is accepted
  as a fallback and is not a current code defect.

---

## 13. Dedicated OpenAlgo Middleware (VM: `Bazaarmood2`)

OpenAlgo middleware is installed and active on the separate `Bazaarmood2` VM. This section documents the system configuration, runtime, networking, and security of this service.

### 13.1 Installation Details & Path Layout
- **Application Path:** `/var/python/openalgo`
- **Virtual Environment:** `/var/python/openalgo/.venv`
- **OpenAlgo Version:** `v2.0.1.5`
- **Python Compatibility:** Python 3.12 (specifically `python3.12.13` from deadsnakes PPA). The default Ubuntu 22.04 Python 3.10 is incompatible because `IPython 9.12` requires Python 3.12 or newer.
- **Installer Configuration:** Modified to use `PYTHON_CMD="python3.12"` and `uv venv --python python3.12`.

### 13.2 Systemd Service Configuration
The installer stopped before completing the systemd configuration due to initial SSL setup delays. The service was created manually.
- **Service Name:** `openalgo.service` (enabled and active)
- **Runtime Server:** Gunicorn using one Eventlet worker binding to a Unix socket: `unix:/var/python/openalgo/openalgo.sock`
- **Proxy Process:** A WebSocket proxy process runs concurrently under the same service.
- **Reboot Verification:** Verified. The service restarts automatically and remains active.
- **Memory Consumption:** ~721 MB observed after reboot. RAM must be monitored closely before adding more broker instances on the 6 GB RAM limit.

### 13.3 Nginx Reverse Proxy & SSL Certificate
- **Proxy Path:** Nginx reverse-proxies `https://openalgo.bazaarmood.com` to the Unix socket `/var/python/openalgo/openalgo.sock`.
- **Redirects:** All port 80 (HTTP) requests redirect to port 443 (HTTPS) automatically.
- **Let's Encrypt Certificate:** Active and managed via Certbot.
  - **Full Chain:** `/etc/letsencrypt/live/openalgo.bazaarmood.com/fullchain.pem`
  - **Private Key:** `/etc/letsencrypt/live/openalgo.bazaarmood.com/privkey.pem`
  - **Certificate Expiry:** 2026-10-15 (Automatic renewal certbot cron job is active).
- **Security Rule:** Never copy, log, or store certificate private-key contents in Git or documentation.

### 13.4 Host Firewall & Persistent Network Rules
- **Access Policies:** OCI Ingress permits ports 22, 80, and 443. UFW accepts SSH and Nginx Full.
- **OCI image IPTables conflict:** The original OCI Ubuntu image contained a pre-configured `INPUT REJECT` rule that dropped traffic on ports 80/443 before UFW rules could process them.
- **Firewall Fix:** A TCP ACCEPT rule for ports 80/443 was inserted before the OCI INPUT REJECT rule.
- **Persistence:** Rules saved to `/etc/iptables/rules.v4` using `sudo netfilter-persistent save`.
- **Reboot Verification:** Verified functional. Ingress and SSL remain stable across host restarts.
- **InstanceServices Warning:** Always preserve OCI default InstanceServices networking rules when editing the firewall to prevent OCI metadata connection issues.

---

## 14. Data-Source Flow & OpenAlgo Integration Status

It is critical to distinguish the operational status of OpenAlgo from the live data-source pipeline of the Indian Dashboard application.

### 14.1 Current Dashboard Pipeline (Direct Connections Only)
The Indian Dashboard has **not yet** been configured to route requests through the new OpenAlgo instance. It connects directly to live brokers.

- **Cash Quotes & LTP:** Direct REST Upstox API (`/v2/market-quote/quotes`) is primary, with Angel One SmartAPI as backup and Yahoo Finance as final fallback.
- **Option Chain & OI:** Direct FYERS v3 API is primary, with official NSE scrapers as fallback, and Angel One available in fallback configurations.
- **Storage Dual-Write:** Dual-write to local SQLite (`backend/database/market_data.db`) and Supabase Postgres remains active under `src/lib/services/scheduler.server.ts`. Database files, WAL files, and caches are excluded from Git.

### 14.2 Current OpenAlgo Status
- **Instance Domain:** `https://openalgo.bazaarmood.com`
- **Connected Broker:** Upstox
- **Live Mode:** Active
- **Master Contract:** Verified ready with approximately 100,308 symbols cached in OpenAlgo.
| Table | Index Name | Business Key Columns |
|-------|------------|-----------------------|
| `market_snapshots` | `uq_market_snapshots_business_key` | `trading_date`, `trading_time`, `symbol` |
| `market_breadth` | `uq_market_breadth_business_key` | `trading_date`, `trading_time` |
| `sector_strength` | `uq_sector_strength_business_key` | `trading_date`, `trading_time`, `symbol` |
| `option_chain_snapshots` | `uq_option_chain_snapshots_business_key` | `trading_date`, `trading_time`, `symbol`, `expiry` |
| `oi_activity` | `uq_oi_activity_business_key` | `snapshot_id`, `strike` |

*Excluded:* `system_logs` (logging duplicates is permitted), `trade_signals` (currently unused/different schema), and any `snapshot_time` columns.

#### Option-Chain Parent-ID Fallback
When a duplicate option chain snap arrives, Postgres ignores the insert (`ON CONFLICT DO NOTHING`) and returns zero rows. To prevent failure of child `oi_activity` insertions, `insertOptionChainSnapshot` safely queries the database for the existing row's ID using `.maybeSingle()` as a fallback when the upsert returns an empty array.

#### Rollback SQL Migration
To drop these unique indexes if needed:
```sql
DROP INDEX IF EXISTS uq_market_snapshots_business_key;
DROP INDEX IF EXISTS uq_market_breadth_business_key;
DROP INDEX IF EXISTS uq_sector_strength_business_key;
DROP INDEX IF EXISTS uq_option_chain_snapshots_business_key;
DROP INDEX IF EXISTS uq_oi_activity_business_key;
```

---

## 7. Verified Full-Day Production Data (13 July 2026)

The Oracle SQLite successfully stored the complete market session:
- **Session start:** ~09:15:10 IST
- **Session end:** ~15:30:10 IST

**Verified SQLite counts:**

| Table | Count | Interpretation |
|-------|-------|---------------|
| `market_snapshots` | **1504** | 4 index rows × 376 ticks |
| `market_breadth` | **376** | 1 row per scheduler tick |
| `sector_strength` | **4512** | 12 sector rows per tick |
| `option_chain_snapshots` | **1128** | 3 snapshots per tick |
| `oi_activity` | **23688** | 21 OI rows per option-chain snapshot |
| `trade_signals` | **0** | Separate feature, not yet active |

**Supabase backfill (13 July 2026) result:**

The same full trading-day dataset was successfully backfilled and verified in
Supabase. Final Supabase counts match the SQLite counts exactly:

| Table | Count |
|-------|-------|
| `market_snapshots` | **1504** |
| `market_breadth` | **376** |
| `sector_strength` | **4512** |
| `option_chain_snapshots` | **1128** |
| `oi_activity` | **23688** |

The temporary backfill script was deleted after a successful run.

---

## 8. Current Verification Status

| Item | Status |
|------|--------|
| Oracle app online under PM2 | ✅ Confirmed |
| SQLite full-day storage working | ✅ Confirmed |
| Supabase schema aligned with insert payload | ✅ Confirmed |
| Full-day Supabase backfill (13 Jul 2026) complete | ✅ Confirmed |
| PM2 state saved (`pm2 save`) | ✅ Confirmed |
| `SUPABASE_DUAL_WRITE=true` active in production | ✅ Confirmed |
| Automatic Supabase dual-write during live market session | ✅ Confirmed (14 July 2026) |

---

## 9. Automatic Live Dual-Write Verification Milestone (14 July 2026)

The pending live verification is officially **closed** and marked as **verified complete** on **14 July 2026, 18:01 IST**.

During the live trading session from **09:15:03 to 15:30:03 IST**, the scheduler saved ticks continuously to local SQLite and automatically dual-wrote them to Supabase Postgres.

**Verification Results:**
1. **PM2 logs check:** Confirmed that no fresh Supabase schema or insert errors appeared in PM2 logs.
2. **Database consistency:** Automatic row counts in Supabase matched the local SQLite database exactly for the four verified metrics:

| Table | 14 July Count | Meaning |
|-------|---------------|---------|
| `market_snapshots` | 1504 | 4 index rows × 376 ticks |
| `market_breadth` | 376 | 1 per scheduler tick |
| `sector_strength` | 4512 | 12 rows per tick |
| `option_chain_snapshots` | 1128 | 3 per tick |

*(Note: Schema design, including the `oi_activity.snapshot_id` foreign key relationship being UUID-based, was verified previously during the 13 July schema alignment milestone).*

---

## 10. Infrastructure Security Rules

- **Zero Secret Commits:** Never commit or expose `.env` values or credentials.
- **Sensitive variables that must never be logged or exposed:**
  - `ANGEL_ONE_MPIN`, `ANGEL_ONE_TOTP_SECRET`
  - Broker API keys and secrets
  - Session/access tokens, JWTs, refresh tokens
  - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
  - SSH private keys (`.pem` / `.pub`)
- **Immutable during routine tasks:** Nginx config, SSL settings,
  firewall/iptables rules, PM2 structures, host bindings, deployment scripts,
  scheduler startup logic, SQLite schemas, production `.env`.

---

## 11. Server/Client Boundary Rule

Node-only code must **never** enter the browser bundle. Dynamic imports are used
to keep Node-only modules out of the client bundle.

**Server-only modules (must stay in `*.server.ts` / `*.functions.ts`):**
- `node:fs`, `node:path`
- SQLite (`better-sqlite3`)
- Configuration stores (`configStore`, `config.server.ts`)
- Secret-key access
- Supabase service-role logic (`supabase.server.ts`)

Do not add static client-side imports that pull server-only services into
React/browser code.

---

## 12. Known Issues & Resolutions

### 12.1 Angel One Client Key — Resolved

- **Previous inconsistency:** `angelOneService.ts` used `ANGEL_ONE_CLIENT_CODE`;
  `settings.functions.ts` checked `ANGEL_ONE_CLIENT_ID`.
- **Resolution (2026-07-13):** Codebase standardised on `ANGEL_ONE_CLIENT_CODE`.
  A robust fallback to `ANGEL_ONE_CLIENT_ID` remains in both files for backward
  compatibility with environments that have not yet updated their `.env`.
- **Status:** ✅ Resolved — `CLIENT_CODE` is canonical; `CLIENT_ID` is accepted
  as a fallback and is not a current code defect.

---

## 13. Dedicated OpenAlgo Middleware (VM: `Bazaarmood2`)

OpenAlgo middleware is installed and active on the separate `Bazaarmood2` VM. This section documents the system configuration, runtime, networking, and security of this service.

### 13.1 Installation Details & Path Layout
- **Application Path:** `/var/python/openalgo`
- **Virtual Environment:** `/var/python/openalgo/.venv`
- **OpenAlgo Version:** `v2.0.1.5`
- **Python Compatibility:** Python 3.12 (specifically `python3.12.13` from deadsnakes PPA). The default Ubuntu 22.04 Python 3.10 is incompatible because `IPython 9.12` requires Python 3.12 or newer.
- **Installer Configuration:** Modified to use `PYTHON_CMD="python3.12"` and `uv venv --python python3.12`.

### 13.2 Systemd Service Configuration
The installer stopped before completing the systemd configuration due to initial SSL setup delays. The service was created manually.
- **Service Name:** `openalgo.service` (enabled and active)
- **Runtime Server:** Gunicorn using one Eventlet worker binding to a Unix socket: `unix:/var/python/openalgo/openalgo.sock`
- **Proxy Process:** A WebSocket proxy process runs concurrently under the same service.
- **Reboot Verification:** Verified. The service restarts automatically and remains active.
- **Memory Consumption:** ~721 MB observed after reboot. RAM must be monitored closely before adding more broker instances on the 6 GB RAM limit.

### 13.3 Nginx Reverse Proxy & SSL Certificate
- **Proxy Path:** Nginx reverse-proxies `https://openalgo.bazaarmood.com` to the Unix socket `/var/python/openalgo/openalgo.sock`.
- **Redirects:** All port 80 (HTTP) requests redirect to port 443 (HTTPS) automatically.
- **Let's Encrypt Certificate:** Active and managed via Certbot.
  - **Full Chain:** `/etc/letsencrypt/live/openalgo.bazaarmood.com/fullchain.pem`
  - **Private Key:** `/etc/letsencrypt/live/openalgo.bazaarmood.com/privkey.pem`
  - **Certificate Expiry:** 2026-10-15 (Automatic renewal certbot cron job is active).
- **Security Rule:** Never copy, log, or store certificate private-key contents in Git or documentation.

### 13.4 Host Firewall & Persistent Network Rules
- **Access Policies:** OCI Ingress permits ports 22, 80, and 443. UFW accepts SSH and Nginx Full.
- **OCI image IPTables conflict:** The original OCI Ubuntu image contained a pre-configured `INPUT REJECT` rule that dropped traffic on ports 80/443 before UFW rules could process them.
- **Firewall Fix:** A TCP ACCEPT rule for ports 80/443 was inserted before the OCI INPUT REJECT rule.
- **Persistence:** Rules saved to `/etc/iptables/rules.v4` using `sudo netfilter-persistent save`.
- **Reboot Verification:** Verified functional. Ingress and SSL remain stable across host restarts.
- **InstanceServices Warning:** Always preserve OCI default InstanceServices networking rules when editing the firewall to prevent OCI metadata connection issues.

---

## 14. Data-Source Flow & OpenAlgo Integration Status

It is critical to distinguish the operational status of OpenAlgo from the live data-source pipeline of the Indian Dashboard application.

### 14.1 Current Dashboard Pipeline (Direct Connections Only)
The Indian Dashboard has **not yet** been configured to route requests through the new OpenAlgo instance. It connects directly to live brokers.

- **Cash Quotes & LTP:** Direct REST Upstox API (`/v2/market-quote/quotes`) is primary, with Angel One SmartAPI as backup and Yahoo Finance as final fallback.
- **Option Chain & OI:** Direct FYERS v3 API is primary, with official NSE scrapers as fallback, and Angel One available in fallback configurations.
- **Storage Dual-Write:** Dual-write to local SQLite (`backend/database/market_data.db`) and Supabase Postgres remains active under `src/lib/services/scheduler.server.ts`. Database files, WAL files, and caches are excluded from Git.

### 14.2 Current OpenAlgo Status
- **Instance Domain:** `https://openalgo.bazaarmood.com`
- **Connected Broker:** Upstox
- **Live Mode:** Active
- **Master Contract:** Verified ready with approximately 100,308 symbols cached in OpenAlgo.
- **Integration Role:** OpenAlgo is currently a **separate system**. It is not feeding any live quotes, option chains, or historical data to the Indian Dashboard.
- **Integration Plan:** OpenAlgo should be integrated first as an optional, shadow data source behind a toggle to prevent production outages.

---

*Production infrastructure only. Application architecture: `docs/PROJECT_MASTER.md`.
Active task: `docs/CURRENT_TASK.md`. Last session: `docs/SESSION_HANDOVER.md`.*
