/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * UAT (User Access Token) persistent storage for cc-lark MCP Server.
 *
 * Stores OAuth token data in a file-based storage in the user's home directory.
 * For MCP Server architecture, we use a simple JSON file approach instead of
 * OS-native credential services for simplicity and portability.
 *
 * Storage location: ~/.cc-lark/tokens.json
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { mkdir, readFile, writeFile, unlink, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger.js';

const log = logger('token-store');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredUAToken {
  userOpenId: string;
  appId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms – access_token expiry
  refreshExpiresAt: number; // Unix ms – refresh_token expiry
  scope: string;
  grantedAt: number; // Unix ms – original grant time
}

// Internal storage structure
interface TokenStorage {
  version: 1;
  tokens: Record<string, StoredUAToken>; // key: appId:userOpenId
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKENS_DIR = join(homedir(), '.cc-lark');
const TOKENS_FILE = join(TOKENS_DIR, 'tokens.json');

/** Refresh proactively when access_token expires within this window. */
const REFRESH_AHEAD_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accountKey(appId: string, userOpenId: string): string {
  return `${appId}:${userOpenId}`;
}

/** Mask a token for safe logging: only the last 4 chars are visible. */
export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return `****${token.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Ensure the tokens directory exists with proper permissions.
 */
async function ensureTokensDir(): Promise<void> {
  try {
    await mkdir(TOKENS_DIR, { recursive: true, mode: 0o700 });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }
  }
  // Ensure directory has restrictive permissions
  try {
    await chmod(TOKENS_DIR, 0o700);
  } catch {
    // Ignore permission errors on Windows
  }
}

/**
 * Read the token storage file.
 * Returns null if the file doesn't exist or is invalid.
 */
async function readTokenStorage(): Promise<TokenStorage | null> {
  try {
    const data = await readFile(TOKENS_FILE, 'utf8');
    const parsed = JSON.parse(data) as TokenStorage;
    if (parsed.version !== 1) {
      log.warn('unsupported token storage version, ignoring');
      return null;
    }
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    log.warn(`failed to read token storage: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Write the token storage file.
 */
async function writeTokenStorage(storage: TokenStorage): Promise<void> {
  await ensureTokensDir();
  const data = JSON.stringify(storage, null, 2);
  await writeFile(TOKENS_FILE, data, { mode: 0o600 });
  // Ensure file has restrictive permissions
  try {
    await chmod(TOKENS_FILE, 0o600);
  } catch {
    // Ignore permission errors on Windows
  }
}

// ---------------------------------------------------------------------------
// Public API – Credential operations
// ---------------------------------------------------------------------------

/**
 * Read the stored UAT for a given (appId, userOpenId) pair.
 * Returns `null` when no entry exists or the payload is unparseable.
 */
export async function getStoredToken(
  appId: string,
  userOpenId: string
): Promise<StoredUAToken | null> {
  try {
    const storage = await readTokenStorage();
    if (!storage) return null;
    const key = accountKey(appId, userOpenId);
    return storage.tokens[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a UAT using file-based storage.
 *
 * Overwrites any existing entry for the same (appId, userOpenId).
 */
export async function setStoredToken(token: StoredUAToken): Promise<void> {
  const storage = (await readTokenStorage()) ?? { version: 1, tokens: {} };
  const key = accountKey(token.appId, token.userOpenId);
  storage.tokens[key] = token;
  await writeTokenStorage(storage);
  log.info(`saved UAT for ${token.userOpenId} (at:${maskToken(token.accessToken)})`);
}

/**
 * Remove a stored UAT from the storage.
 */
export async function removeStoredToken(appId: string, userOpenId: string): Promise<void> {
  const storage = await readTokenStorage();
  if (!storage) return;

  const key = accountKey(appId, userOpenId);
  if (storage.tokens[key]) {
    delete storage.tokens[key];
    await writeTokenStorage(storage);
    log.info(`removed UAT for ${userOpenId}`);
  }
}

/**
 * List all stored tokens for a given appId.
 */
export async function listStoredTokens(appId: string): Promise<StoredUAToken[]> {
  const storage = await readTokenStorage();
  if (!storage) return [];

  const tokens: StoredUAToken[] = [];
  for (const [key, token] of Object.entries(storage.tokens)) {
    if (key.startsWith(`${appId}:`)) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Clear all stored tokens.
 * Use with caution - this removes all stored credentials.
 */
export async function clearAllTokens(): Promise<void> {
  try {
    await unlink(TOKENS_FILE);
    log.info('cleared all stored tokens');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Token validity check
// ---------------------------------------------------------------------------

/**
 * Determine the freshness of a stored token.
 *
 * - `"valid"`         – access_token is still good (expires > 5 min from now)
 * - `"needs_refresh"` – access_token expired/expiring but refresh_token is valid
 * - `"expired"`       – both tokens are expired; re-authorization required
 */
export function tokenStatus(token: StoredUAToken): 'valid' | 'needs_refresh' | 'expired' {
  const now = Date.now();
  if (now < token.expiresAt - REFRESH_AHEAD_MS) {
    return 'valid';
  }
  if (now < token.refreshExpiresAt) {
    return 'needs_refresh';
  }
  return 'expired';
}

// ---------------------------------------------------------------------------
// Storage path utilities (for testing/debugging)
// ---------------------------------------------------------------------------

/**
 * Get the path to the tokens storage file.
 */
export function getTokensFilePath(): string {
  return TOKENS_FILE;
}

/**
 * Check if tokens storage file exists.
 */
export async function tokensStorageExists(): Promise<boolean> {
  try {
    await stat(TOKENS_FILE);
    return true;
  } catch {
    return false;
  }
}
