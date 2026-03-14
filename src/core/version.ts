/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Version management for cc-lark MCP Server.
 *
 * Reads version from package.json and generates User-Agent string.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

/** Cached version string */
let cachedVersion: string | undefined;

/**
 * Get the package version from package.json.
 *
 * @returns Version string (e.g., "0.1.0") or "unknown" if read fails
 */
export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    // Current file: src/core/version.ts -> up two levels to project root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');

    const raw = readFileSync(packageJsonPath, 'utf8');
    const pkg = JSON.parse(raw) as { version?: string };
    cachedVersion = pkg.version ?? 'unknown';
    return cachedVersion;
  } catch {
    cachedVersion = 'unknown';
    return cachedVersion;
  }
}

/**
 * Generate User-Agent string for HTTP requests.
 *
 * @returns User-Agent string (e.g., "cc-lark/0.1.0")
 *
 * @example
 * ```typescript
 * getUserAgent() // => "cc-lark/0.1.0"
 * ```
 */
export function getUserAgent(): string {
  return `cc-lark/${getPackageVersion()}`;
}
