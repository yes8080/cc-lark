/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_im_fetch_resource tool - Download IM message attachments with user identity.
 *
 * Uses Feishu API:
 *   - im.v1.messageResource.get: GET /open-apis/im/v1/messages/:message_id/resources/:file_key
 *
 * All calls use user access token (UAT) - requires OAuth authorization.
 *
 * Adapted from openclaw-lark for MCP Server architecture.
 */

import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolRegistry } from '../index.js';
import { getValidAccessToken, NeedAuthorizationError } from '../../core/uat-client.js';
import { json, jsonError } from './helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:im:resource');

// ---------------------------------------------------------------------------
// MIME type mapping
// ---------------------------------------------------------------------------

const MIME_TO_EXT: Record<string, string> = {
  // Images
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  // Videos
  'video/mp4': '.mp4',
  'video/mpeg': '.mpeg',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/webm': '.webm',
  // Audio
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  // Documents
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  // Others
  'application/zip': '.zip',
  'application/x-rar-compressed': '.rar',
  'text/plain': '.txt',
  'application/json': '.json',
};

// ---------------------------------------------------------------------------
// Input schema (raw shape for ZodRawShapeCompat)
// ---------------------------------------------------------------------------

const fetchResourceShape = {
  message_id: z
    .string()
    .describe('Message ID (om_xxx format), obtained from message events or message list'),
  file_key: z
    .string()
    .describe(
      'Resource key from message body. For images use image_key (img_xxx), for files use file_key (file_xxx)'
    ),
  type: z
    .enum(['image', 'file'])
    .describe(
      'Resource type: image (image in image message) or file (file/audio/video in file message)'
    ),
};

// ---------------------------------------------------------------------------
// Temp file helper
// ---------------------------------------------------------------------------

function buildRandomTempFilePath(options: { prefix?: string; extension?: string } = {}): string {
  const { prefix = 'resource', extension } = options;
  const randomId = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now();
  const baseName = `${prefix}-${timestamp}-${randomId}`;
  return join(tmpdir(), 'cc-lark', extension ? `${baseName}${extension}` : baseName);
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register the feishu_im_fetch_resource tool.
 */
export function registerImFetchResourceTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_im_fetch_resource',
    description: [
      'Download IM message file/image attachments to local file with user identity.',
      '',
      'Usage:',
      '- Use message_id from message list or search results',
      '- Use file_key from message content (image_key for images, file_key for files)',
      '- Use type="image" for images, type="file" for files/audio/video',
      '',
      'The downloaded file is saved to the system temp directory.',
      'Returns: message_id, file_key, type, size_bytes, content_type, saved_path',
      '',
      'Limitations:',
      '- File size limit: 100MB',
      '- Does not support stickers, merge-forward messages, or card resources',
      '',
      'Requires OAuth authorization (use feishu_oauth tool with action="authorize" first).',
    ].join('\n'),
    inputSchema: fetchResourceShape,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof fetchResourceShape>>>;

      if (!context.larkClient) {
        return jsonError('LarkClient not initialized. Check FEISHU_APP_ID and FEISHU_APP_SECRET.');
      }

      const { appId, appSecret, brand } = context.config;
      if (!appId || !appSecret) {
        return jsonError('Missing FEISHU_APP_ID or FEISHU_APP_SECRET.');
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

        log.info('fetch_resource: downloading', {
          message_id: p.message_id,
          file_key: p.file_key,
          type: p.type,
        });

        const Lark = await import('@larksuiteoapi/node-sdk');
        const opts = Lark.withUserAccessToken(accessToken);

        // Download the resource
        const res = await context.larkClient.sdk.im.v1.messageResource.get(
          {
            params: { type: p.type },
            path: { message_id: p.message_id, file_key: p.file_key },
          },
          opts
        );

        // Response is a binary stream, use getReadableStream()
        const stream = res.getReadableStream();
        const chunks: Buffer[] = [];

        for await (const chunk of stream) {
          chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        log.info(`fetch_resource: downloaded ${buffer.length} bytes`);

        // Get Content-Type from response headers
        const contentType = (res.headers as Record<string, string>)?.['content-type'] || '';
        log.info(`fetch_resource: content-type=${contentType}`);

        // Infer extension from Content-Type
        const mimeType = contentType ? contentType.split(';')[0].trim() : '';
        const mimeExt = mimeType ? MIME_TO_EXT[mimeType] : undefined;

        const finalPath = buildRandomTempFilePath({
          prefix: 'im-resource',
          extension: mimeExt,
        });
        log.info(`fetch_resource: saving to ${finalPath}`);

        // Ensure parent directory exists
        await mkdir(dirname(finalPath), { recursive: true });

        // Write file
        await writeFile(finalPath, buffer);
        log.info(`fetch_resource: saved to ${finalPath}`);

        return json({
          message_id: p.message_id,
          file_key: p.file_key,
          type: p.type,
          size_bytes: buffer.length,
          content_type: contentType,
          saved_path: finalPath,
        });
      } catch (err) {
        if (err instanceof NeedAuthorizationError) {
          return jsonError(
            `User authorization required or expired. Please use feishu_oauth tool with action="authorize" to re-authorize.`,
            { userOpenId }
          );
        }
        log.error('fetch_resource failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  log.debug('feishu_im_fetch_resource tool registered');
}
