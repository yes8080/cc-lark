/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_search_doc_wiki tool - Search Feishu documents and wikis.
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { json, jsonError } from '../common/helpers.js';
import {
  parseTimeToTimestamp as parseTimeToTimestampStr,
  unixTimestampToISO8601,
} from '../im/time-utils.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:search:doc-wiki');

/**
 * Parse time string to Unix timestamp (seconds) as a number.
 * Wraps the shared parseTimeToTimestamp to return number | undefined.
 */
function parseTimeToTimestamp(input: string): number | undefined {
  const result = parseTimeToTimestampStr(input);
  return result !== null ? parseInt(result, 10) : undefined;
}

// Schemas
const docTypeEnum = z.enum([
  'DOC',
  'SHEET',
  'BITABLE',
  'MINDNOTE',
  'FILE',
  'WIKI',
  'DOCX',
  'FOLDER',
  'CATALOG',
  'SLIDES',
  'SHORTCUT',
]);

const timeRangeSchema = z.object({
  start: z.string().optional().describe('Start time (ISO 8601 with timezone)'),
  end: z.string().optional().describe('End time (ISO 8601 with timezone)'),
});

const filterSchema = z
  .object({
    creator_ids: z.array(z.string()).max(20).optional().describe('Creator OpenIDs (max 20)'),
    doc_types: z.array(docTypeEnum).max(10).optional().describe('Document types'),
    only_title: z.boolean().optional().describe('Search title only (default: false)'),
    open_time: timeRangeSchema.optional().describe('Open time range'),
    create_time: timeRangeSchema.optional().describe('Create time range'),
  })
  .optional();

const searchActionSchema = {
  action: z.literal('search').describe('Search documents and wikis'),
  query: z.string().max(50).optional().describe('Search query (optional, empty string for all)'),
  filter: filterSchema,
  page_size: z.number().min(1).max(20).optional().describe('Page size (default 15)'),
  page_token: z.string().optional().describe('Pagination token'),
};

function normalizeSearchResultTimeFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSearchResultTimeFields(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(source)) {
    if (key.endsWith('_time')) {
      const iso = unixTimestampToISO8601(item as string | number | undefined);
      if (iso) {
        normalized[key] = iso;
        continue;
      }
    }
    normalized[key] = normalizeSearchResultTimeFields(item);
  }

  return normalized as T;
}


export function registerSearchDocWikiTool(registry: ToolRegistry): void {
  registry.register({
    name: 'feishu_search_doc_wiki',
    description: 'Search Feishu documents and wikis.\n\nRequires OAuth authorization.',
    inputSchema: searchActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof searchActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      const query = p.query ?? '';
      log.info(
        `search: query="${query}", has_filter=${!!p.filter}, page_size=${p.page_size ?? 15}`
      );

      const opts = await withUserAccessToken(accessToken);

      // Build request body

      const requestData: any = {
        query,
        page_size: p.page_size,
        page_token: p.page_token,
      };

      if (p.filter) {
        const filter = { ...p.filter };

        // Convert time ranges
        if (filter.open_time) {
          const converted: any = {};
          if (filter.open_time.start) {
            const ts = parseTimeToTimestamp(filter.open_time.start);
            if (ts !== undefined) converted.start = ts;
          }
          if (filter.open_time.end) {
            const ts = parseTimeToTimestamp(filter.open_time.end);
            if (ts !== undefined) converted.end = ts;
          }
          filter.open_time = converted;
        }
        if (filter.create_time) {
          const converted: any = {};
          if (filter.create_time.start) {
            const ts = parseTimeToTimestamp(filter.create_time.start);
            if (ts !== undefined) converted.start = ts;
          }
          if (filter.create_time.end) {
            const ts = parseTimeToTimestamp(filter.create_time.end);
            if (ts !== undefined) converted.end = ts;
          }
          filter.create_time = converted;
        }

        requestData.doc_filter = filter;
        requestData.wiki_filter = filter;
      } else {
        requestData.doc_filter = {};
        requestData.wiki_filter = {};
      }

      // Use direct request since SDK doesn't have search API

      const res = await (larkClient!.sdk as any).request(
        {
          method: 'POST',
          url: '/open-apis/search/v2/doc_wiki/search',
          data: requestData,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
        },
        opts
      );

      // Check for API error - response might have code directly or wrapped
      if ((res as any).code !== undefined && (res as any).code !== 0) {
        return jsonError(`API Error: code=${(res as any).code}, msg=${(res as any).msg}`);
      }

      const data = res.data || {};

      log.info(`search: found ${data.res_units?.length ?? 0} results`);
      const normalizedResults = normalizeSearchResultTimeFields(data.res_units);

      return json({
        total: data.total,
        has_more: data.has_more,
        results: normalizedResults,
        page_token: data.page_token,
      });
    },
  });

  log.debug('feishu_search_doc_wiki tools registered');
}
