import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const CONFIG_FILE = path.join(process.cwd(), "fyers_config.enc");

// Derived key from env or a stable fallback
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  ? crypto.scryptSync(process.env.ENCRYPTION_KEY, "salt", 32)
  : crypto.scryptSync("lovable-indian-dashboard-salt-12345", "salt", 32);

const IV_LENGTH = 16;

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(text: string): string {
  const parts = text.split(":");
  const iv = Buffer.from(parts.shift() || "", "hex");
  const encryptedText = Buffer.from(parts.join(":"), "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

export interface FyersStatus {
  accessToken: string;
  isExpired: boolean;
  expiryError?: string;
  lastChecked?: number;
}

let inMemoryConfig: FyersStatus = {
  accessToken: process.env.FYERS_ACCESS_TOKEN || "",
  isExpired: false,
};

let loaded = false;

async function loadFromDisk() {
  if (loaded) return;
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const decrypted = decrypt(data);
    const parsed = JSON.parse(decrypted);
    inMemoryConfig = { ...inMemoryConfig, ...parsed };
    loaded = true;
  } catch (e) {
    // File doesn't exist or is invalid; fallback to environment variable
    loaded = true;
  }
}

export async function getFyersClientId(): Promise<string> {
  // 1. Check environment variables
  if (process.env.FYERS_CLIENT_ID) {
    return process.env.FYERS_CLIENT_ID;
  }
  if (process.env.FYERS_APP_ID) {
    return process.env.FYERS_APP_ID;
  }

  // 2. Try to read from generate_token.py
  try {
    const filePath = path.join(process.cwd(), "generate_token.py");
    const content = await fs.readFile(filePath, "utf-8");
    const match = content.match(/client_id\s*=\s*["']([^"']+)["']/);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {
    // Ignore error if file doesn't exist
  }

  // 3. Fallback
  return "GHIT2K4T2R-100";
}

export async function getFyersConfig(): Promise<FyersStatus> {
  await loadFromDisk();
  return inMemoryConfig;
}


export async function saveFyersToken(token: string): Promise<void> {
  inMemoryConfig = {
    accessToken: token,
    isExpired: false,
    expiryError: undefined,
    lastChecked: Date.now(),
  };
  try {
    const encrypted = encrypt(JSON.stringify(inMemoryConfig));
    await fs.writeFile(CONFIG_FILE, encrypted, "utf-8");
  } catch (err) {
    console.error("Failed to write encrypted Fyers config file:", err);
  }
}

export async function markFyersExpired(errorMsg: string): Promise<void> {
  await loadFromDisk();
  inMemoryConfig = {
    ...inMemoryConfig,
    isExpired: true,
    expiryError: errorMsg,
    lastChecked: Date.now(),
  };
  try {
    const encrypted = encrypt(JSON.stringify(inMemoryConfig));
    await fs.writeFile(CONFIG_FILE, encrypted, "utf-8");
  } catch (err) {
    console.error("Failed to write Fyers config file:", err);
  }
}
