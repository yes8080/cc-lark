/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_drive_file tool - Manage Feishu Drive files.
 *
 * Actions: list, get_meta, copy, move, delete
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError } from '../common/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:drive:file');

// Schemas
const listActionSchema = {
  action: z.literal('list').describe('List files in a folder'),
  folder_token: z.string().optional().describe('Folder token (optional, defaults to root)'),
  page_size: z.number().min(1).max(200).optional().describe('Page size (default 200)'),
  page_token: z.string().optional().describe('Pagination token'),
  order_by: z.enum(['EditedTime', 'CreatedTime']).optional().describe('Sort order'),
  direction: z.enum(['ASC', 'DESC']).optional().describe('Sort direction'),
};

const docTypeEnum = z.enum([
  'doc',
  'sheet',
  'file',
  'bitable',
  'docx',
  'folder',
  'mindnote',
  'slides',
]);

const getMetaActionSchema = {
  action: z.literal('get_meta').describe('Get file metadata'),
  request_docs: z
    .array(
      z.object({
        doc_token: z.string().describe('Document token'),
        doc_type: docTypeEnum.describe('Document type'),
      })
    )
    .min(1)
    .max(50)
    .describe('Documents to query'),
};

const copyActionSchema = {
  action: z.literal('copy').describe('Copy a file'),
  file_token: z.string().describe('File token'),
  name: z.string().describe('New file name'),
  type: docTypeEnum.describe('Document type'),
  folder_token: z.string().optional().describe('Target folder token'),
};

const moveActionSchema = {
  action: z.literal('move').describe('Move a file'),
  file_token: z.string().describe('File token'),
  type: docTypeEnum.describe('Document type'),
  folder_token: z.string().describe('Target folder token'),
};

const deleteActionSchema = {
  action: z.literal('delete').describe('Delete a file'),
  file_token: z.string().describe('File token'),
  type: docTypeEnum.describe('Document type'),
};


export function registerDriveFileTool(registry: ToolRegistry): void {
  // List files
  registry.register({
    name: 'feishu_drive_file_list',
    description: 'List files in a Feishu Drive folder.\n\nRequires OAuth authorization.',
    inputSchema: listActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof listActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`list: folder_token=${p.folder_token || '(root)'}, page_size=${p.page_size ?? 200}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.drive.v1.file.list(
        {
          params: {
            folder_token: p.folder_token || '',
            page_size: p.page_size,
            page_token: p.page_token,
            order_by: p.order_by,
            direction: p.direction,
          },
        },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      return json({
        files: data?.files,
        has_more: data?.has_more,
        page_token: data?.next_page_token,
      });
    },
  });

  // Get metadata
  registry.register({
    name: 'feishu_drive_file_get_meta',
    description: 'Get metadata for Feishu documents.\n\nRequires OAuth authorization.',
    inputSchema: getMetaActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof getMetaActionSchema>>>;
      const { larkClient } = context;

      if (!p.request_docs || p.request_docs.length === 0) {
        return jsonError('request_docs must be a non-empty array');
      }

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`get_meta: querying ${p.request_docs.length} documents`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.drive.meta.batchQuery(
        { data: { request_docs: p.request_docs } },
        opts
      );
      assertLarkOk(res);

      return json({ metas: res.data?.metas ?? [] });
    },
  });

  // Copy file
  registry.register({
    name: 'feishu_drive_file_copy',
    description: 'Copy a Feishu Drive file.\n\nRequires OAuth authorization.',
    inputSchema: copyActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof copyActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`copy: file_token=${p.file_token}, name=${p.name}, type=${p.type}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = { name: p.name, type: p.type };
      if (p.folder_token) data.folder_token = p.folder_token;

      const res = await larkClient!.sdk.drive.file.copy(
        { path: { file_token: p.file_token }, data },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileData = res.data as any;

      return json({ file: fileData?.file });
    },
  });

  // Move file
  registry.register({
    name: 'feishu_drive_file_move',
    description: 'Move a Feishu Drive file.\n\nRequires OAuth authorization.',
    inputSchema: moveActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof moveActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`move: file_token=${p.file_token}, type=${p.type}, folder_token=${p.folder_token}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.drive.file.move(
        {
          path: { file_token: p.file_token },
          data: { type: p.type as 'file' | 'folder', folder_token: p.folder_token },
        },
        opts
      );
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.data as any;

      return json({
        success: true,
        task_id: data?.task_id,
        file_token: p.file_token,
        target_folder_token: p.folder_token,
      });
    },
  });

  // Delete file
  registry.register({
    name: 'feishu_drive_file_delete',
    description: 'Delete a Feishu Drive file.\n\nRequires OAuth authorization.',
    inputSchema: deleteActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof deleteActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`delete: file_token=${p.file_token}, type=${p.type}`);

      const opts = await withUserAccessToken(accessToken);

      const res = await larkClient!.sdk.drive.file.delete(
        { path: { file_token: p.file_token }, params: { type: p.type as 'file' | 'folder' } },
        opts
      );
      assertLarkOk(res);

      const data = res.data as Record<string, unknown>;

      return json({
        success: true,
        task_id: data?.task_id,
        file_token: p.file_token,
      });
    },
  });

  log.debug('feishu_drive_file tools registered');
}
