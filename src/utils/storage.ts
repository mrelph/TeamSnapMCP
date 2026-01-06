import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { CONFIG_DIR, CREDENTIALS_FILE } from "./config.js";

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  teamsnapUserId?: string;
  teamsnapEmail?: string;
  clientId: string;
  clientSecret: string;
}

interface EncryptedData {
  encrypted: string;
  iv: string;
  salt: string;
}

// Use machine-specific key derivation
function getEncryptionKey(salt: Buffer): Buffer {
  // Use a combination of factors for the key
  const machineId = `teamsnap-mcp-${process.env.USER || "default"}`;
  return scryptSync(machineId, salt, 32);
}

function encrypt(text: string): EncryptedData {
  const salt = randomBytes(16);
  const key = getEncryptionKey(salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted + authTag.toString("hex"),
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
  };
}

function decrypt(data: EncryptedData): string {
  const salt = Buffer.from(data.salt, "hex");
  const key = getEncryptionKey(salt);
  const iv = Buffer.from(data.iv, "hex");

  // Last 32 hex chars (16 bytes) are the auth tag
  const authTag = Buffer.from(data.encrypted.slice(-32), "hex");
  const encryptedText = data.encrypted.slice(0, -32);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveCredentials(credentials: StoredCredentials): void {
  ensureConfigDir();
  const encrypted = encrypt(JSON.stringify(credentials));
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}

export function loadCredentials(): StoredCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8")) as EncryptedData;
    const decrypted = decrypt(data);
    return JSON.parse(decrypted) as StoredCredentials;
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_FILE)) {
    writeFileSync(CREDENTIALS_FILE, "", { mode: 0o600 });
  }
}

export function hasCredentials(): boolean {
  return loadCredentials() !== null;
}
