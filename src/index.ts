#!/usr/bin/env node
/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * MCP Server entry point for cc-lark.
 *
 * This is the main executable that starts the MCP Server and registers
 * all Feishu/Lark tools for Claude Code.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { logger } from './utils/logger.js';
import { getPackageVersion } from './core/version.js';
import { loadConfig, validateConfig } from './core/config.js';
import { LarkClient } from './core/lark-client.js';
import { registerAllTools } from './tools/index.js';

const log = logger('server');

// ---------------------------------------------------------------------------
// Server initialization
// ---------------------------------------------------------------------------

/**
 * Create and configure the MCP Server instance.
 */
function createServer(): McpServer {
  const version = getPackageVersion();
  const server = new McpServer(
    {
      name: 'cc-lark',
      version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('Starting cc-lark MCP Server...', { version: getPackageVersion() });

  // Load and validate configuration
  const config = loadConfig();
  const validation = validateConfig(config);

  if (!validation.valid) {
    log.error('Invalid configuration', { errors: validation.errors });
    // Continue anyway - tools can report configuration errors when called
  } else {
    log.info('Configuration loaded', {
      appId: config.appId,
      brand: config.brand,
      hasUserAccessToken: !!config.userAccessToken,
    });
  }

  // Initialize LarkClient from environment (singleton)
  let larkClient: LarkClient | null = null;
  if (validation.valid) {
    try {
      larkClient = LarkClient.getInstance();
      log.info('LarkClient initialized', { appId: larkClient.appId, brand: larkClient.brand });
    } catch (err) {
      log.error('Failed to initialize LarkClient', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Create MCP Server
  const server = createServer();

  // Register all tools
  registerAllTools(server, larkClient, config);

  log.info('Tools registered');

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Handle graceful shutdown
  let isShuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info(`Received ${signal}, shutting down...`);

    try {
      await server.close();
      log.info('Server closed');
    } catch (err) {
      log.error('Error during shutdown', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
    process.exit(1);
  });

  // Connect to transport
  try {
    await server.connect(transport);
    log.info('Server connected to stdio transport');
  } catch (err) {
    log.error('Failed to connect server', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

// Run the server
main().catch((err) => {
  log.error('Server startup failed', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
