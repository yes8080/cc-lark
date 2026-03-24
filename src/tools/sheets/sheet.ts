/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * feishu_sheet tool - Manage Feishu Spreadsheets.
 *
 * Actions: info, read, write, append, create
 */

import { z } from 'zod';
import type { ToolRegistry } from '../index.js';
import { LarkClient } from '../../core/lark-client.js';
import { getToolAccessToken, isToolResult, withUserAccessToken } from '../common/auth-helper.js';
import { assertLarkOk } from '../../core/api-error.js';
import { json, jsonError } from '../common/helpers.js';
import { logger } from '../../utils/logger.js';

const log = logger('tools:sheets:sheet');

const MAX_READ_ROWS = 200;

/**
 * Parse spreadsheet URL to extract token and optional sheet ID.
 */
function parseSheetUrl(url: string): { token: string; sheetId?: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/(?:sheets|wiki)\/([^/?#]+)/);
    if (!match) return null;
    return {
      token: match[1],
      sheetId: u.searchParams.get('sheet') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Convert column number to letter (A, B, ..., Z, AA, AB, ...).
 * Used for spreadsheet column references (e.g., A1, B2).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function colLetter(n: number): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

// Schemas
const infoActionSchema = {
  action: z.literal('info').describe('Get spreadsheet info'),
  spreadsheet_token: z.string().optional().describe('Spreadsheet token'),
  url: z.string().optional().describe('Spreadsheet URL'),
};

const readActionSchema = {
  action: z.literal('read').describe('Read data from a spreadsheet'),
  spreadsheet_token: z.string().optional().describe('Spreadsheet token'),
  url: z.string().optional().describe('Spreadsheet URL'),
  range: z.string().optional().describe('Range to read (e.g., Sheet1!A1:D10)'),
  sheet_id: z.string().optional().describe('Sheet ID'),
};

const writeActionSchema = {
  action: z.literal('write').describe('Write data to a spreadsheet (overwrites existing data)'),
  spreadsheet_token: z.string().optional().describe('Spreadsheet token'),
  url: z.string().optional().describe('Spreadsheet URL'),
  range: z.string().optional().describe('Range to write (e.g., Sheet1!A1)'),
  sheet_id: z.string().optional().describe('Sheet ID'),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('Data to write (2D array)'),
};

const appendActionSchema = {
  action: z.literal('append').describe('Append data to a spreadsheet'),
  spreadsheet_token: z.string().optional().describe('Spreadsheet token'),
  url: z.string().optional().describe('Spreadsheet URL'),
  range: z.string().optional().describe('Range to append to (e.g., Sheet1)'),
  sheet_id: z.string().optional().describe('Sheet ID'),
  values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).describe('Data to append (2D array)'),
};

const createActionSchema = {
  action: z.literal('create').describe('Create a new spreadsheet'),
  title: z.string().describe('Spreadsheet title'),
  folder_token: z.string().optional().describe('Folder token (optional)'),
};


async function resolveToken(
  p: { url?: string; spreadsheet_token?: string },
  _larkClient: LarkClient,
  _accessToken: string
): Promise<{ token: string; urlSheetId?: string }> {
  let token: string;
  let urlSheetId: string | undefined;

  if (p.spreadsheet_token) {
    token = p.spreadsheet_token;
  } else if (p.url) {
    const parsed = parseSheetUrl(p.url);
    if (!parsed) {
      throw new Error(`Failed to parse spreadsheet_token from URL: ${p.url}`);
    }
    token = parsed.token;
    urlSheetId = parsed.sheetId;
  } else {
    throw new Error('url or spreadsheet_token is required');
  }

  return { token, urlSheetId };
}

export function registerSheetTool(registry: ToolRegistry): void {
  // Info
  registry.register({
    name: 'feishu_sheet_info',
    description: 'Get Feishu spreadsheet info and sheet list.\n\nRequires OAuth authorization.',
    inputSchema: infoActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof infoActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      const { token } = await resolveToken(p, larkClient!, accessToken);
      log.info(`info: token=${token}`);

      const opts = await withUserAccessToken(accessToken);

      const [spreadsheetRes, sheetsRes] = await Promise.all([
        larkClient!.sdk.sheets.spreadsheet.get({ path: { spreadsheet_token: token } }, opts),
        larkClient!.sdk.sheets.spreadsheetSheet.query({ path: { spreadsheet_token: token } }, opts),
      ]);
      assertLarkOk(spreadsheetRes);
      assertLarkOk(sheetsRes);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spreadsheet = spreadsheetRes.data?.spreadsheet as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sheets = (sheetsRes.data?.sheets ?? []).map((s: any) => ({
        sheet_id: s.sheet_id,
        title: s.title,
        index: s.index,
        row_count: s.grid_properties?.row_count,
        column_count: s.grid_properties?.column_count,
      }));

      return json({
        title: spreadsheet?.title,
        spreadsheet_token: token,
        url: `https://www.feishu.cn/sheets/${token}`,
        sheets,
      });
    },
  });

  // Read
  registry.register({
    name: 'feishu_sheet_read',
    description: 'Read data from a Feishu spreadsheet.\n\nRequires OAuth authorization.',
    inputSchema: readActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof readActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      const { token, urlSheetId } = await resolveToken(p, larkClient!, accessToken);
      let range = p.range;
      if (!range && (p.sheet_id || urlSheetId)) {
        range = p.sheet_id || urlSheetId;
      }

      if (!range) {
        // Get first sheet
        const opts = await withUserAccessToken(accessToken);
        const sheetsRes = await larkClient!.sdk.sheets.spreadsheetSheet.query(
          { path: { spreadsheet_token: token } },
          opts
        );
        assertLarkOk(sheetsRes);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const firstSheet = (sheetsRes.data?.sheets ?? [])[0] as any;
        if (!firstSheet?.sheet_id) {
          return jsonError('Spreadsheet has no worksheets');
        }
        range = firstSheet.sheet_id;
      }

      log.info(`read: token=${token}, range=${range}`);

      // Use direct API call for reading values
      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (larkClient!.sdk as any).request(
        {
          method: 'GET',
          url: `/open-apis/sheets/v2/spreadsheets/${token}/values/${encodeURIComponent(range!)}`,
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        opts
      );

      if (res.code && res.code !== 0) {
        return jsonError(res.msg || `API error: ${res.code}`);
      }

      const valueRange = res.data?.valueRange;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let values = valueRange?.values as any[][] | undefined;

      // Truncate if needed
      let truncated = false;

      const totalRows = values?.length ?? 0;
      if (values && values.length > MAX_READ_ROWS) {
        values = values.slice(0, MAX_READ_ROWS);
        truncated = true;
      }

      return json({
        range: valueRange?.range,
        values,
        ...(truncated
          ? {
              truncated: true,
              total_rows: totalRows,
              hint: `Data exceeds ${MAX_READ_ROWS} rows, truncated.`,
            }
          : {}),
      });
    },
  });

  // Write
  registry.register({
    name: 'feishu_sheet_write',
    description:
      'Write data to a Feishu spreadsheet (overwrites existing data).\n\nRequires OAuth authorization.',
    inputSchema: writeActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof writeActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      const { token, urlSheetId } = await resolveToken(p, larkClient!, accessToken);
      let range = p.range;
      if (!range && (p.sheet_id || urlSheetId)) {
        range = p.sheet_id || urlSheetId;
      }

      log.info(`write: token=${token}, range=${range}, rows=${p.values?.length}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (larkClient!.sdk as any).request(
        {
          method: 'PUT',
          url: `/open-apis/sheets/v2/spreadsheets/${token}/values`,
          data: { valueRange: { range, values: p.values } },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        opts
      );

      if (res.code && res.code !== 0) {
        return jsonError(res.msg || `API error: ${res.code}`);
      }

      return json({
        updated_range: res.data?.updatedRange,
        updated_rows: res.data?.updatedRows,
        updated_columns: res.data?.updatedColumns,
        updated_cells: res.data?.updatedCells,
      });
    },
  });

  // Append
  registry.register({
    name: 'feishu_sheet_append',
    description: 'Append data to a Feishu spreadsheet.\n\nRequires OAuth authorization.',
    inputSchema: appendActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof appendActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      const { token, urlSheetId } = await resolveToken(p, larkClient!, accessToken);
      let range = p.range;
      if (!range && (p.sheet_id || urlSheetId)) {
        range = p.sheet_id || urlSheetId;
      }

      log.info(`append: token=${token}, range=${range}, rows=${p.values?.length}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (larkClient!.sdk as any).request(
        {
          method: 'POST',
          url: `/open-apis/sheets/v2/spreadsheets/${token}/values_append`,
          data: { valueRange: { range, values: p.values } },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        opts
      );

      if (res.code && res.code !== 0) {
        return jsonError(res.msg || `API error: ${res.code}`);
      }

      const updates = res.data?.updates;

      return json({
        table_range: res.data?.tableRange,
        updated_range: updates?.updatedRange,
        updated_rows: updates?.updatedRows,
        updated_columns: updates?.updatedColumns,
        updated_cells: updates?.updatedCells,
      });
    },
  });

  // Create
  registry.register({
    name: 'feishu_sheet_create',
    description: 'Create a new Feishu spreadsheet.\n\nRequires OAuth authorization.',
    inputSchema: createActionSchema,
    handler: async (args, context) => {
      const p = args as z.infer<ReturnType<typeof z.object<typeof createActionSchema>>>;
      const { larkClient } = context;

      const tokenResult = await getToolAccessToken(context);
      if (isToolResult(tokenResult)) return tokenResult;
      const accessToken = tokenResult;

      log.info(`create: title=${p.title}, folder=${p.folder_token ?? '(root)'}`);

      const opts = await withUserAccessToken(accessToken);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = { title: p.title };
      if (p.folder_token) data.folder_token = p.folder_token;

      const res = await larkClient!.sdk.sheets.spreadsheet.create({ data }, opts);
      assertLarkOk(res);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spreadsheet = res.data?.spreadsheet as any;
      const token = spreadsheet?.spreadsheet_token;

      return json({
        spreadsheet_token: token,
        title: p.title,
        url: `https://www.feishu.cn/sheets/${token}`,
      });
    },
  });

  log.debug('feishu_sheet tools registered');
}
