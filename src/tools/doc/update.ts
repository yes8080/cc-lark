/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_update_doc tool - Update document content.
 *
 * Updates Feishu document with various modes:
 * - overwrite: Replace entire document
 * - append: Add content at the end
 * - replace_range: Replace a selected range
 * - replace_all: Replace all occurrences of text
 * - insert_before: Insert content before a selection
 * - insert_after: Insert content after a selection
 * - delete_range: Delete a selected range
 *
 * Supports async task status checking via task_id.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { callMcpTool, json, jsonError, processMcpResult, type ToolResult } from './shared.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:doc:update');

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const updateModeSchema = z.enum([
  'overwrite',
  'append',
  'replace_range',
  'replace_all',
  'insert_before',
  'insert_after',
  'delete_range',
]);

const updateDocSchema = {
  doc_id: z.string().optional().describe('Document ID or URL'),
  markdown: z.string().optional().describe('Markdown content'),
  mode: updateModeSchema.describe(
    'Update mode: overwrite, append, replace_range, replace_all, insert_before, insert_after, delete_range (required)'
  ),
  selection_with_ellipsis: z
    .string()
    .optional()
    .describe('Selection expression: start_content...end_content (mutually exclusive with selection_by_title)'),
  selection_by_title: z
    .string()
    .optional()
    .describe('Title selection: e.g., ## Section Title (mutually exclusive with selection_with_ellipsis)'),
  new_title: z.string().optional().describe('New document title (optional)'),
  task_id: z
    .string()
    .optional()
    .describe('Async task ID for checking task status (optional)'),
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateUpdateDocParams(p: Record<string, unknown>): void {
  // If task_id is provided, we're just querying status
  if (p.task_id) return;

  // For update operations, doc_id is required
  if (!p.doc_id) {
    throw new Error('update-doc: doc_id is required when not providing task_id');
  }

  // Mode is required
  if (!p.mode) {
    throw new Error('update-doc: mode is required');
  }

  const mode = p.mode as string;

  // Selection modes require exactly one selection parameter
  const selectionModes = ['replace_range', 'insert_before', 'insert_after', 'delete_range'];
  if (selectionModes.includes(mode)) {
    const hasEllipsis = Boolean(p.selection_with_ellipsis);
    const hasTitle = Boolean(p.selection_by_title);
    if ((hasEllipsis && hasTitle) || (!hasEllipsis && !hasTitle)) {
      throw new Error(
        'update-doc: For modes replace_range/insert_before/insert_after/delete_range, ' +
          'exactly one of selection_with_ellipsis or selection_by_title must be provided'
      );
    }
  }

  // delete_range doesn't need markdown
  const needsMarkdown = mode !== 'delete_range';
  if (needsMarkdown && !p.markdown) {
    throw new Error(`update-doc: markdown is required for mode=${mode}`);
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the feishu_update_doc tool.
 */
export function registerUpdateDocTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_update_doc',
    description: [
      'Update a Feishu document with various modes.',
      '',
      'Modes:',
      '- overwrite: Replace entire document content',
      '- append: Add content at the end',
      '- replace_range: Replace selected text range',
      '- replace_all: Replace all occurrences of text',
      '- insert_before: Insert content before selection',
      '- insert_after: Insert content after selection',
      '- delete_range: Delete selected range',
      '',
      'Selection methods (for range-based modes):',
      '- selection_with_ellipsis: "start_text...end_text" pattern',
      '- selection_by_title: "## Section Title" to select by heading',
      '',
      'Parameters:',
      '- doc_id: Document ID or URL (required for update)',
      '- mode: Update mode (required)',
      '- markdown: New content (required for most modes)',
      '- selection_with_ellipsis: Range selection pattern',
      '- selection_by_title: Title-based selection',
      '- new_title: New document title (optional)',
      '- task_id: Async task ID for status check',
      '',
      'Returns:',
      '- { task_id } for async operations',
      '- { status, result? } for task_id queries',
      '',
      'Requires OAuth authorization (use feishu_oauth tool first).',
    ].join('\n'),
    inputSchema: updateDocSchema,
    handler: async (args, context) => {
      return handleUpdateDoc(args, context);
    },
  });

  log.debug('feishu_update_doc tool registered');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

async function handleUpdateDoc(
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
    validateUpdateDocParams(p);
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

    log.info('Updating document', {
      doc_id: p.doc_id,
      mode: p.mode,
      has_markdown: !!p.markdown,
      selection_with_ellipsis: p.selection_with_ellipsis ? '(provided)' : undefined,
      selection_by_title: p.selection_by_title,
      new_title: p.new_title,
      task_id: p.task_id,
    });

    // Build MCP tool arguments
    const mcpArgs: Record<string, unknown> = {};
    if (p.doc_id) mcpArgs.doc_id = p.doc_id;
    if (p.markdown) mcpArgs.markdown = p.markdown;
    if (p.mode) mcpArgs.mode = p.mode;
    if (p.selection_with_ellipsis) mcpArgs.selection_with_ellipsis = p.selection_with_ellipsis;
    if (p.selection_by_title) mcpArgs.selection_by_title = p.selection_by_title;
    if (p.new_title) mcpArgs.new_title = p.new_title;
    if (p.task_id) mcpArgs.task_id = p.task_id;

    // Generate a unique tool call ID
    const toolCallId = `update-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Call the MCP endpoint
    const result = await callMcpTool('update-doc', mcpArgs, toolCallId, accessToken);

    log.info('Document updated/task queried');

    return processMcpResult(result);
  } catch (err) {
    if (err instanceof NeedAuthorizationError) {
      return jsonError(
        `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
        { userOpenId }
      );
    }
    log.error('Update document failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
