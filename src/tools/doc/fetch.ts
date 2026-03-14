/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_fetch_doc tool - Get document content.
 *
 * Fetches Feishu document content, returning title and Markdown content.
 * Supports pagination for large documents.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult } from '../common/auth-helper.js';
import { callMcpTool, processMcpResult, type ToolResult } from './shared.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:doc:fetch');

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const fetchDocSchema = {
  doc_id: z.string().describe('Document ID or URL (supports auto-parsing)'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Character offset (optional, default 0). Use for paginating large documents.'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum characters to return (optional). Use only when pagination is requested.'),
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the feishu_fetch_doc tool.
 */
export function registerFetchDocTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_fetch_doc',
    description: [
      'Fetch Feishu document content, returning title and Markdown format.',
      '',
      'Usage:',
      '- Provide doc_id (document ID or full URL)',
      '- Use offset and limit for paginating large documents',
      '',
      'Parameters:',
      '- doc_id: Document ID or URL (required)',
      '- offset: Character offset for pagination (optional, default 0)',
      '- limit: Maximum characters to return (optional)',
      '',
      'Returns:',
      '- { title, content, has_more? } where content is Markdown text',
      '',
      'Requires OAuth authorization (use feishu_oauth tool first).',
    ].join('\n'),
    inputSchema: fetchDocSchema,
    handler: async (args, context) => {
      return handleFetchDoc(args, context);
    },
  });

  log.debug('feishu_fetch_doc tool registered');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleFetchDoc(
  args: unknown,
  context: { larkClient: import('../../core/lark-client.js').LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as Record<string, unknown>;

  const tokenResult = await getToolAccessToken(context);
  if (isToolResult(tokenResult)) return tokenResult;
  const accessToken = tokenResult;

  log.info('Fetching document', {
    doc_id: p.doc_id,
    offset: p.offset,
    limit: p.limit,
  });

  // Build MCP tool arguments
  const mcpArgs: Record<string, unknown> = {
    doc_id: p.doc_id,
  };
  if (p.offset !== undefined) mcpArgs.offset = p.offset;
  if (p.limit !== undefined) mcpArgs.limit = p.limit;

  // Generate a unique tool call ID
  const toolCallId = `fetch-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Call the MCP endpoint
  const result = await callMcpTool('fetch-doc', mcpArgs, toolCallId, accessToken);

  log.info('Document fetched');

  return processMcpResult(result);
}
