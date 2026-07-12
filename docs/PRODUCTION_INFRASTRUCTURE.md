# Production Infrastructure & Deployment Guide

> **Single source of truth for the production infrastructure, runtime, deployment, and security of the Bazaar Mood / Indian Dashboard project.**
> Written for developers and AI coding agents to ensure production stability and prevent deployment failures.

---

## 1. Project & Domain Registry

- **GitHub Repository:** [fahimrox/indiandeshboard](https://github.com/fahimrox/indiandeshboard)
- **Production Branch:** `main`
- **Local Workspace Path:** `D:\Lovable Deshboard\indiandeshboard`
- **Live Domain:** [https://bazaarmood.com](https://bazaarmood.com) (configured with and without `www`: [https://www.bazaarmood.com](https://www.bazaarmood.com))

---

## 2. Server Infrastructure (Oracle Cloud VM)

The application collector and server run on an Oracle Cloud Infrastructure (OCI) Virtual Machine.

| Parameter | Confirmed Value |
|---|---|
| **VM Name** | `indian-dashboard-collector` |
| **Operating System** | Ubuntu 22.04 LTS |
| **Compute Shape** | `VM.Standard.A1.Flex` (ARM-based Ampere) |
| **Resources** | 1 OCPU, 6 GB RAM |
| **Public IP Address** | `92.4.75.251` |
| **Private IP Address** | `10.0.1.160` |
| **SSH User** | `ubuntu` |
| **Production App Directory** | `/home/ubuntu/apps/indiandeshboard` |

---

## 3. Server Runtime & Network Configuration

- **Process Manager:** PM2 is used to manage the Node server process.
  - **Process Name:** `indian-dashboard`
- **Binding Restriction:** The application server binds exclusively to `127.0.0.1:3000` (localhost).
- **Public Reverse Proxy:** Nginx runs on the host, listening on public ports `80` (HTTP) and `443` (HTTPS) to proxy requests to PM2.
- **Firewall & Security Lists:**
  - Public access to port `3000` is strictly **closed** in the OCI Security List and host `iptables`.
  - `iptables` rules are persisted using `netfilter-persistent`.
- **SSL Certificate:** Active Let's Encrypt SSL certificate managed via certbot on Nginx.

---

## 4. Critical Build & Deployment Pipeline

### 4.1 Production Build Command
When building the application for production on the Oracle Cloud VM, the builder **MUST** explicitly define the server preset:

```bash
NITRO_PRESET=node-server npm run build
```

> [!WARNING]
> **Crucial Rule:** A normal `npm run build` command without `NITRO_PRESET=node-server` may default to a Cloudflare-oriented preset (e.g., `cloudflare-module`), causing the server entry point to build incorrectly for a Node/Linux host environment. This will lead to a **502 Bad Gateway** error in production.

### 4.2 Deployment script
- **Script Path on VM:** `/home/ubuntu/deploy-indian-dashboard.sh`
- **Script Operations:**
  1. Performs `git pull` from the `main` branch.
  2. Runs `npm install` to update dependencies.
  3. Builds using `NITRO_PRESET=node-server npm run build`.
  4. Restarts the PM2 process specifying `HOST=127.0.0.1` and `PORT=3000`.
  5. Saves the PM2 process list (`pm2 save`).

> [!IMPORTANT]
> **Deployment Policy:** Local coding changes and production deployments are separate operations. AI agents are **strictly forbidden** from triggering or executing production deployments automatically without explicit user approval.

---

## 5. Data Services & Pipeline Architecture

### 5.1 Databases
- **Primary Database (Local):** SQLite database located at `backend/database/market_data.db`.
- **Supabase Syncing (Dual-Write):** Dual-write capability is enabled in the environment using:
  ```env
  SUPABASE_DUAL_WRITE=true
  ```
  This duplicates updates from the scheduler asynchronously to Supabase tables.

### 5.2 Scheduler
- **Orchestration:** The intraday scheduler runs every **60 seconds** during market hours to collect quotes, option chains, sector strength, and market breadth.

### 5.3 Broker Fallback Priority
When querying market feeds, the system processes data requests sequentially through the following fallback routes:

- **Quotes:** Upstox → Angel One → Yahoo
- **Option Chain:** FYERS → Angel One → NSE Scraper
- **Futures Open Interest (OI):** Angel One → NSE Scraper

---

## 6. Infrastructure Security Rules

- **Zero Secret Commits:** Never commit or expose `.env` values or credentials in pull requests, Git commits, or documentation.
- **Sensitive Variables Guard:** The following parameters must never be logged, printed, or exposed:
  - `ANGEL_ONE_MPIN`, `ANGEL_ONE_TOTP_SECRET`
  - Broker API keys and secrets
  - Session/access tokens, JWTs, refresh tokens
  - Supabase service-role key
  - SSH private keys (`.pem` / `.pub`)
- **Immutable Configurations:** During routine fixes or unrelated tasks, do **NOT** modify or attempt to alter Nginx configurations, SSL settings, firewall/iptables rules, PM2 structures, host bindings, deployment scripts, scheduler startup logic, SQLite schemas, or the production `.env` file.

---

## 7. Known Production Issues

### 7.1 Angel One Client Key Inconsistency
- **Symptom:** There is a mismatch in environment variable usage between broker service initialization and verification.
  - [angelOneService.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/services/angelOneService.ts) references `ANGEL_ONE_CLIENT_CODE`.
  - [settings.functions.ts](file:///d:/Lovable%20Deshboard/indiandeshboard/src/lib/settings.functions.ts) checks against `ANGEL_ONE_CLIENT_ID`.
- **Resolution:** The canonical variable name across the application is `ANGEL_ONE_CLIENT_CODE`.
- **Action Item:** Do **NOT** modify this variable discrepancy in unrelated tasks. Keep this listed as a known inconsistency to be resolved only under explicit instructions.
