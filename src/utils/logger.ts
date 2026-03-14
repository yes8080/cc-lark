/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Simple logger utility for the cc-lark MCP Server.
 *
 * Provides prefixed logging with ANSI color support for console output.
 * Adapted from openclaw-lark lark-logger for MCP Server architecture.
 */

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface Logger {
  readonly subsystem: string;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(name: string): Logger;
}

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

/**
 * Format a log message with optional metadata.
 *
 * @param prefix - Log prefix (subsystem tag)
 * @param message - Log message
 * @param meta - Optional metadata to include
 * @returns Formatted message string
 */
function formatMessage(
  prefix: string,
  message: string,
  meta: Record<string, unknown> | undefined
): string {
  if (!meta || Object.keys(meta).length === 0) {
    return `${prefix} ${message}`;
  }

  const parts = Object.entries(meta)
    .map(([k, v]) => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'object') return `${k}=${JSON.stringify(v)}`;
      return `${k}=${v}`;
    })
    .filter(Boolean);

  return parts.length > 0 ? `${prefix} ${message} (${parts.join(', ')})` : `${prefix} ${message}`;
}

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

/**
 * Create a new logger instance.
 *
 * @param subsystem - Subsystem name for log prefix
 * @returns Logger instance
 */
function createLogger(subsystem: string): Logger {
  const tag = `cc-lark/${subsystem}`;

  return {
    subsystem,

    debug(message: string, meta?: Record<string, unknown>): void {
      const formatted = formatMessage(tag, message, meta);
      console.debug(`${GRAY}[DEBUG]${RESET}`, formatted);
    },

    info(message: string, meta?: Record<string, unknown>): void {
      const formatted = formatMessage(tag, message, meta);
      console.log(`${CYAN}[INFO]${RESET}`, formatted);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
      const formatted = formatMessage(tag, message, meta);
      console.warn(`${YELLOW}[WARN]${RESET}`, formatted);
    },

    error(message: string, meta?: Record<string, unknown>): void {
      const formatted = formatMessage(tag, message, meta);
      console.error(`${RED}[ERROR]${RESET}`, formatted);
    },

    child(name: string): Logger {
      return createLogger(`${subsystem}/${name}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create a logger for a subsystem.
 *
 * @param subsystem - Name of the subsystem (e.g., "api", "tools", "config")
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const log = logger("api");
 * log.info("Request started", { method: "GET", path: "/users" });
 * log.error("Request failed", { error: "Connection timeout" });
 * ```
 */
export function logger(subsystem: string): Logger {
  return createLogger(subsystem);
}

/**
 * Default logger instance for general use.
 */
export const defaultLogger = logger('core');
