/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Shared utilities for Doc tools.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 * - Removed OpenClaw runtime dependencies
 * - Uses direct MCP endpoint calls with user access token
 */

import { logger } from '../../utils/logger.js';
import { getUserAgent } from '../../core/version.js';

const log = logger('tools:doc:shared');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCP JSON-RPC success response */
export interface McpRpcSuccess {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

/** MCP JSON-RPC error response */
export interface McpRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type McpRpcResponse = McpRpcSuccess | McpRpcError;

/** Tool result type that matches MCP SDK expectations. */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

// ---------------------------------------------------------------------------
// MCP endpoint configuration
// ---------------------------------------------------------------------------

/** Default MCP endpoint for Feishu */
const DEFAULT_MCP_ENDPOINT = 'https://mcp.feishu.cn/mcp';

/**
 * Get the MCP endpoint URL.
 * Priority: FEISHU_MCP_ENDPOINT env var > default
 */
export function getMcpEndpoint(): string {
  return process.env.FEISHU_MCP_ENDPOINT?.trim() || DEFAULT_MCP_ENDPOINT;
}

/**
 * Build authorization header for MCP requests.
 */
function buildAuthHeader(): string | undefined {
  const token = process.env.FEISHU_MCP_BEARER_TOKEN?.trim() || process.env.FEISHU_MCP_TOKEN?.trim();

  if (!token) return undefined;
  return token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
}

// ---------------------------------------------------------------------------
// JSON-RPC utilities
// ---------------------------------------------------------------------------

/**
 * Check if a value is a plain object (not null, not array).
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Recursively unwrap JSON-RPC result envelopes.
 * Some MCP gateways wrap the result in additional JSON-RPC envelopes.
 */
export function unwrapJsonRpcResult(v: unknown): unknown {
  if (!isRecord(v)) return v;

  const hasJsonRpc = typeof v.jsonrpc === 'string';
  const hasId = 'id' in v;
  const hasResult = 'result' in v;
  const hasError = 'error' in v;

  if (hasJsonRpc && (hasResult || hasError)) {
    if (hasError) {
      const err = v.error;
      if (isRecord(err) && typeof err.message === 'string') {
        throw new Error(err.message);
      }
      throw new Error('MCP returned error, but could not parse message');
    }
    return unwrapJsonRpcResult(v.result);
  }

  // Some implementations wrap without jsonrpc field
  if (!hasJsonRpc && !hasId && hasResult && !hasError) {
    return unwrapJsonRpcResult(v.result);
  }

  return v;
}

// ---------------------------------------------------------------------------
// MCP client
// ---------------------------------------------------------------------------

/**
 * Call an MCP tool on the Feishu MCP endpoint.
 *
 * @param name - MCP tool name (e.g., 'create-doc', 'fetch-doc')
 * @param args - Tool arguments
 * @param toolCallId - Unique ID for this tool call
 * @param uat - User access token
 * @returns Tool result
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  toolCallId: string,
  uat: string
): Promise<unknown> {
  const endpoint = getMcpEndpoint();
  const auth = buildAuthHeader();

  const body = {
    jsonrpc: '2.0',
    id: toolCallId,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Lark-MCP-UAT': uat,
    'X-Lark-MCP-Allowed-Tools': name,
    'User-Agent': getUserAgent(),
  };
  if (auth) headers.authorization = auth;

  log.debug(`Calling MCP tool: ${name}`, { toolCallId, endpoint });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status} ${res.statusText}: ${text.slice(0, 4000)}`);
  }

  let data: McpRpcResponse;
  try {
    data = JSON.parse(text) as McpRpcResponse;
  } catch {
    throw new Error(`MCP returned non-JSON: ${text.slice(0, 4000)}`);
  }

  if ('error' in data) {
    throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
  }

  return unwrapJsonRpcResult(data.result);
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

/**
 * Format a successful tool result.
 */
export function json(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Format an error tool result.
 */
export function jsonError(message: string, details?: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, details }, null, 2) }],
    isError: true,
  };
}

/**
 * Process MCP tool result into MCP content format.
 * Handles the { content: [{ type, text }] } format from MCP tools/call.
 */
export function processMcpResult(result: unknown): ToolResult {
  // MCP tools/call returns { content: [{ type, text }] } format
  // Extract the text content and parse if JSON
  if (isRecord(result) && Array.isArray((result as Record<string, unknown>).content)) {
    const mcpContent = (result as Record<string, unknown>).content as Array<{
      type: string;
      text: string;
    }>;
    if (mcpContent.length === 1 && mcpContent[0]?.type === 'text') {
      try {
        JSON.parse(mcpContent[0].text);
        // text is valid JSON, return as-is
      } catch {
        // text is not JSON, keep original result
      }
    }
    return {
      content: mcpContent.map((c) => ({
        type: 'text' as const,
        text: c.text,
      })),
    };
  }
  return json(result);
}
