/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Core type definitions for the cc-lark MCP Server.
 *
 * Contains Feishu/Lark API types, configuration interfaces, and MCP-specific types.
 * Adapted from openclaw-lark for MCP Server architecture.
 */

// ---------------------------------------------------------------------------
// Domain & connection enums
// ---------------------------------------------------------------------------

/**
 * The Lark platform brand.
 * - `"feishu"` targets the China-mainland Feishu service.
 * - `"lark"` targets the international Lark service.
 * - Any other string is treated as a custom base URL.
 */
export type LarkBrand = 'feishu' | 'lark' | (string & {});

// ---------------------------------------------------------------------------
// Feishu identifiers
// ---------------------------------------------------------------------------

/** The four ID types recognised by the Feishu API. */
export type FeishuIdType = 'open_id' | 'user_id' | 'union_id' | 'chat_id';

// ---------------------------------------------------------------------------
// MCP-specific types
// ---------------------------------------------------------------------------

/** Standard MCP tool result structure. */
export interface ToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      name: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    };
  }>;
  isError?: boolean;
}

/** Tool definition for MCP server. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/** Feishu configuration loaded from environment variables. */
export interface FeishuConfig {
  /** Feishu App ID */
  appId: string;
  /** Feishu App Secret */
  appSecret: string;
  /** User Access Token (optional, for user-authorized operations) */
  userAccessToken?: string;
  /** The Lark platform brand (feishu, lark, or custom URL) */
  brand?: LarkBrand;
  /** Encrypt key for webhook event decryption */
  encryptKey?: string;
  /** Verification token for webhook validation */
  verificationToken?: string;
}

/** Validation result for configuration. */
export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  config?: FeishuConfig;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/** The minimum credential set needed to interact with the Lark API. */
export interface LarkCredentials {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  brand: LarkBrand;
}

// ---------------------------------------------------------------------------
// Lark API response types
// ---------------------------------------------------------------------------

/** Base response from Lark API. */
export interface LarkApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

/** Token response from Lark API. */
export interface LarkTokenResponse {
  tenant_access_token: string;
  expire: number;
}

/** User info from Lark API. */
export interface LarkUserInfo {
  open_id: string;
  user_id?: string;
  union_id?: string;
  name?: string;
  en_name?: string;
  nickname?: string;
  email?: string;
  mobile?: string;
  gender?: number;
  avatar_url?: string;
  status?: {
    is_frozen?: boolean;
    is_resigned?: boolean;
    is_activated?: boolean;
  };
  department_ids?: string[];
  leader_user_id?: string;
  city?: string;
  country?: string;
  work_station?: string;
  join_time?: number;
  employee_no?: string;
  employee_type?: number;
  positions?: string[];
  orders?: number;
}

/** Message content types. */
export type LarkMessageContent =
  | { text: string }
  | { image_key: string }
  | { file_key: string }
  | { audio_key: string }
  | { media_key: string }
  | { sticker_key: string }
  | { rich_text: LarkRichTextContent };

/** Rich text content structure. */
export interface LarkRichTextContent {
  zh_cn?: LarkRichTextSection[];
  en_us?: LarkRichTextSection[];
}

/** Rich text section. */
export interface LarkRichTextSection {
  title?: string;
  lines?: LarkRichTextLine[];
}

/** Rich text line. */
export interface LarkRichTextLine {
  text_run?: {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inline_code?: boolean;
    color?: string;
    link?: string;
  };
  mention_run?: {
    text: string;
    user_id: string;
  };
  equation_run?: {
    text: string;
  };
}

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------

/** Docx document metadata. */
export interface LarkDocxDocument {
  document_id: string;
  revision_id: number;
  title: string;
  create_time: number;
  update_time: number;
}

/** Docx block content. */
export interface LarkDocxBlock {
  block_type: number;
  block_id: string;
  parent_id?: string;
  children?: string[];
  text?: {
    initial_style: Record<string, unknown>;
    elements: Array<{
      text_run?: { content: string };
      mention_run?: { user_id: string; text: string };
      equation_run?: { content: string };
    }>;
  };
  heading1?: { elements: unknown[] };
  heading2?: { elements: unknown[] };
  heading3?: { elements: unknown[] };
  heading4?: { elements: unknown[] };
  heading5?: { elements: unknown[] };
  heading6?: { elements: unknown[] };
  heading7?: { elements: unknown[] };
  heading8?: { elements: unknown[] };
  heading9?: { elements: unknown[] };
  bullet?: { elements: unknown[] };
  ordered?: { elements: unknown[] };
  code?: { elements: unknown[] };
  quote?: { elements: unknown[] };
  table?: {
    rows: number;
    columns: number;
    property: {
      row_size: number[];
      column_size: number[];
    };
    cells: string[];
  };
  table_cell?: {
    property: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Sheet types
// ---------------------------------------------------------------------------

/** Spreadsheet metadata. */
export interface LarkSpreadsheet {
  spreadsheet_token: string;
  name: string;
  revision: number;
  owner_id: string;
  create_time: number;
  update_time: number;
}

/** Sheet (worksheet) metadata. */
export interface LarkSheet {
  sheet_id: string;
  title: string;
  index: number;
  row_count: number;
  column_count: number;
  frozen_row_count?: number;
  frozen_column_count?: number;
}

/** Sheet cell value. */
export interface LarkCellValue {
  value: string;
  type: number;
}

// ---------------------------------------------------------------------------
// Drive types
// ---------------------------------------------------------------------------

/** Drive file metadata. */
export interface LarkDriveFile {
  token: string;
  name: string;
  type: string;
  parent_token: string;
  create_time: number;
  update_time: number;
  size: number;
  creator_id?: string;
  modifier_id?: string;
}

/** Drive folder metadata. */
export interface LarkDriveFolder {
  token: string;
  name: string;
  parent_token: string;
  create_time: number;
  update_time: number;
  creator_id?: string;
}
