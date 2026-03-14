/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_create_doc tool - Create a new docx document from Markdown.
 *
 * Creates a new Feishu document from Markdown content.
 * Supports async task status checking via task_id.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { callMcpTool, jsonError, processMcpResult, type ToolResult } from './shared.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:doc:create');

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const createDocSchema = {
  markdown: z.string().optional().describe('Markdown content for the document'),
  title: z.string().optional().describe('Document title'),
  folder_token: z.string().optional().describe('Parent folder token (optional)'),
  wiki_node: z
    .string()
    .optional()
    .describe('Wiki node token or URL (optional, creates document under this node)'),
  wiki_space: z.string().optional().describe('Wiki space ID (optional, special value: my_library)'),
  task_id: z
    .string()
    .optional()
    .describe('Async task ID. If provided, queries task status instead of creating a new document'),
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateCreateDocParams(p: Record<string, unknown>): void {
  // If task_id is provided, we're just querying status
  if (p.task_id) return;

  // For creating new doc, markdown and title are required
  if (!p.markdown || !p.title) {
    throw new Error('create-doc: When not providing task_id, markdown and title are required');
  }

  // Only one of folder_token, wiki_node, wiki_space can be provided
  const flags = [p.folder_token, p.wiki_node, p.wiki_space].filter(Boolean);
  if (flags.length > 1) {
    throw new Error('create-doc: folder_token / wiki_node / wiki_space are mutually exclusive, provide only one');
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the feishu_create_doc tool.
 */
export function registerCreateDocTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_create_doc',
    description: [
      'Create a new Feishu docx document from Markdown content.',
      '',
      'Usage:',
      '- Provide markdown and title to create a new document',
      '- Provide task_id to check async task status',
      '- Optionally specify folder_token, wiki_node, or wiki_space for document location',
      '',
      'Parameters:',
      '- markdown: Markdown content for the document (required for new doc)',
      '- title: Document title (required for new doc)',
      '- folder_token: Parent folder token (optional)',
      '- wiki_node: Wiki node token or URL (optional)',
      '- wiki_space: Wiki space ID (optional)',
      '- task_id: Async task ID for status check (optional)',
      '',
      'Returns:',
      '- For new doc: { task_id, doc_id } or completed document info',
      '- For task_id query: { status, result? }',
      '',
      'Requires OAuth authorization (use feishu_oauth tool first).',
    ].join('\n'),
    inputSchema: createDocSchema,
    handler: async (args, context) => {
      return handleCreateDoc(args, context);
    },
  });

  log.debug('feishu_create_doc tool registered');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleCreateDoc(
  args: unknown,
  context: { larkClient: LarkClient | null; config: import('../../core/types.js').FeishuConfig }
): Promise<ToolResult> {
  const p = args as Record<string, unknown>;
  const { larkClient, config } = context;

  if (!larkClient) {
    return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
  }

  const { appId, appSecret, brand } = config;
  if (!appId || !appSecret) {
    return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
  }

  // Validate parameters
  try {
    validateCreateDocParams(p);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }

  // Get the first stored user token
  const { listStoredTokens } = await import('../../core/token-store.js');
  const tokens = await listStoredTokens(appId);
  if (tokens.length === 0) {
    return jsonError(
      'No user authorization found. Please use the feishu_oauth tool with action="authorize" to authorize a user first.'
    );
  }

  const userOpenId = tokens[0].userOpenId;

  try {
    const accessToken = await getValidAccessToken({
      userOpenId,
      appId,
      appSecret,
      domain: brand ?? 'feishu',
    });

    log.info('Creating document', {
      title: p.title,
      has_markdown: !!p.markdown,
      folder_token: p.folder_token,
      wiki_node: p.wiki_node,
      task_id: p.task_id,
    });

    // Build MCP tool arguments
    const mcpArgs: Record<string, unknown> = {};
    if (p.markdown) mcpArgs.markdown = p.markdown;
    if (p.title) mcpArgs.title = p.title;
    if (p.folder_token) mcpArgs.folder_token = p.folder_token;
    if (p.wiki_node) mcpArgs.wiki_node = p.wiki_node;
    if (p.wiki_space) mcpArgs.wiki_space = p.wiki_space;
    if (p.task_id) mcpArgs.task_id = p.task_id;

    // Generate a unique tool call ID
    const toolCallId = `create-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Call the MCP endpoint
    const result = await callMcpTool('create-doc', mcpArgs, toolCallId, accessToken);

    log.info('Document created/task queried', { result });

    return processMcpResult(result);
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    log.error('Create document failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
