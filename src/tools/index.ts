/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tool registry for the cc-lark MCP Server.
 *
 * Provides a unified interface for registering MCP tools with the server.
 * Each tool defines its schema using Zod and implements a handler function.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  ZodRawShapeCompat,
  ShapeOutput,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { FeishuConfig } from '../core/types.js';
import type { LarkClient } from '../core/lark-client.js';
import { logger } from '../utils/logger.js';
import { registerOAuthTool } from './oauth.js';
import { registerImTools } from './im/index.js';
import { registerDocTools } from './doc/index.js';
import { registerBitableTools } from './bitable/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerTaskTools } from './task/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerWikiTools } from './wiki/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerSearchTools } from './search/index.js';
import { registerChatTools } from './chat/index.js';
import { registerCommonTools } from './common/index.js';

const log = logger('tools');

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

/**
 * Context passed to tool handlers.
 */
export interface ToolContext {
  /** LarkClient instance (may be null if config is invalid) */
  larkClient: LarkClient | null;
  /** Configuration loaded from environment */
  config: FeishuConfig;
}

/**
 * Handler function type for tool execution.
 */
export type ToolHandler<Args extends ZodRawShapeCompat = ZodRawShapeCompat> = (
  args: ShapeOutput<Args>,
  context: ToolContext
) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

/**
 * Definition for a single tool.
 */
export interface ToolDefinition<Args extends ZodRawShapeCompat = ZodRawShapeCompat> {
  /** Tool name (unique identifier) */
  name: string;
  /** Human-readable tool description */
  description: string;
  /** Zod schema for input parameters (raw shape object) */
  inputSchema: Args;
  /** Tool handler function */
  handler: ToolHandler<Args>;
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

/**
 * Registry for MCP tools.
 *
 * Manages tool registration with the MCP server and provides
 * a unified interface for tool handlers.
 */
export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
  }

  /**
   * Register a tool with the registry.
   *
   * @param definition - Tool definition
   */
  register<Args extends ZodRawShapeCompat>(definition: ToolDefinition<Args>): void {
    if (this.tools.has(definition.name)) {
      log.warn(`Tool "${definition.name}" is already registered, overwriting`);
    }
    this.tools.set(definition.name, definition as ToolDefinition);
    log.debug(`Registered tool: ${definition.name}`);
  }

  /**
   * Register all registered tools with the MCP server.
   *
   * @param server - MCP server instance
   */
  registerWithServer(server: McpServer): void {
    for (const [name, tool] of this.tools) {
      server.tool(name, tool.description, tool.inputSchema, async (args) => {
        try {
          log.debug(`Executing tool: ${name}`, { args: JSON.stringify(args) });
          const result = await tool.handler(args, this.context);
          log.debug(`Tool ${name} completed`, { isError: result.isError });
          return result;
        } catch (err) {
          log.error(`Tool ${name} failed`, {
            error: err instanceof Error ? err.message : String(err),
          });
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      });
    }
  }

  /**
   * Get a list of all registered tool names.
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register all available tools with the MCP server.
 *
 * @param server - MCP server instance
 * @param larkClient - LarkClient instance (may be null)
 * @param config - Configuration from environment
 */
export function registerAllTools(
  server: McpServer,
  larkClient: LarkClient | null,
  config: FeishuConfig
): void {
  const registry = new ToolRegistry({ larkClient, config });

  // Register OAuth tool
  registerOAuthTool(registry);

  // Register IM tools
  registerImTools(registry);

  // Register Doc tools
  registerDocTools(registry);

  // Register Bitable tools
  registerBitableTools(registry);

  // Register Calendar tools
  registerCalendarTools(registry);

  // Register Task tools
  registerTaskTools(registry);

  // Register Drive tools
  registerDriveTools(registry);

  // Register Wiki tools
  registerWikiTools(registry);

  // Register Sheets tools
  registerSheetsTools(registry);

  // Register Search tools
  registerSearchTools(registry);

  // Register Chat tools
  registerChatTools(registry);

  // Register Common tools
  registerCommonTools(registry);

  // Register all tools with the server
  registry.registerWithServer(server);

  log.info(`Registered ${registry.size} tools`, { tools: registry.getToolNames().join(', ') });
}
