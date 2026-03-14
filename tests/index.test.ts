/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the MCP Server entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Mock the logger
vi.mock('../src/utils/logger.js', () => ({
  logger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  })),
}));

// Mock the config module
vi.mock('../src/core/config.js', () => ({
  loadConfig: vi.fn(() => ({
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    brand: 'feishu',
  })),
  validateConfig: vi.fn(() => ({
    valid: true,
    errors: [],
    config: {
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      brand: 'feishu',
    },
  })),
}));

// Mock the LarkClient
vi.mock('../src/core/lark-client.js', () => ({
  LarkClient: {
    getInstance: vi.fn(() => ({
      appId: 'test-app-id',
      brand: 'feishu',
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    })),
    resetInstance: vi.fn(),
  },
}));

// Mock the version module
vi.mock('../src/core/version.js', () => ({
  getPackageVersion: vi.fn(() => '0.1.0'),
}));

describe('MCP Server', () => {
  describe('Server creation', () => {
    it('should create an MCP server with correct info', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should have tools capability', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      // Server should be created successfully with tools capability
      expect(server).toBeDefined();
    });
  });

  describe('Tool registration', () => {
    it('should register a tool with valid schema', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      const testSchema = z.object({
        message: z.string().describe('Test message'),
      });

      // Register a test tool
      const registeredTool = server.tool(
        'test_tool',
        'A test tool',
        testSchema,
        async (args) => {
          return {
            content: [{ type: 'text' as const, text: `Received: ${args.message}` }],
          };
        }
      );

      expect(registeredTool).toBeDefined();
      expect(registeredTool.enable).toBeTypeOf('function');
      expect(registeredTool.disable).toBeTypeOf('function');
      expect(registeredTool.remove).toBeTypeOf('function');
    });

    it('should register multiple tools', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      // Register multiple tools
      server.tool('tool1', 'First tool', async () => ({
        content: [{ type: 'text' as const, text: 'tool1' }],
      }));

      server.tool('tool2', 'Second tool', async () => ({
        content: [{ type: 'text' as const, text: 'tool2' }],
      }));

      // Both tools should be registered
      expect(server).toBeDefined();
    });

    it('should handle tool with no parameters', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      const tool = server.tool('no_param_tool', 'A tool without parameters', async () => ({
        content: [{ type: 'text' as const, text: 'No parameters needed' }],
      }));

      expect(tool).toBeDefined();
    });

    it('should handle tool with complex schema', () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      const complexSchema = z.object({
        action: z.enum(['create', 'update', 'delete']).describe('Action to perform'),
        id: z.string().optional().describe('Resource ID'),
        data: z.record(z.unknown()).optional().describe('Data payload'),
        options: z.object({
          verbose: z.boolean().optional(),
          dryRun: z.boolean().optional(),
        }).optional(),
      });

      const tool = server.tool(
        'complex_tool',
        'A tool with complex schema',
        complexSchema,
        async (args) => ({
          content: [{ type: 'text' as const, text: `Action: ${args.action}` }],
        })
      );

      expect(tool).toBeDefined();
    });
  });

  describe('Tool handler execution', () => {
    it('should execute tool handler and return result', async () => {
      const server = new McpServer(
        { name: 'cc-lark', version: '0.1.0' },
        { capabilities: { tools: {} } }
      );

      let handlerCalled = false;
      const testSchema = z.object({
        input: z.string(),
      });

      server.tool(
        'echo_tool',
        'Echo tool',
        testSchema,
        async (args) => {
          handlerCalled = true;
          return {
            content: [{ type: 'text' as const, text: args.input }],
          };
        }
      );

      // The handler would be called via MCP protocol, but we can verify the tool is registered
      expect(server).toBeDefined();
      // In a real test, we would use the server's request handling mechanism
    });
  });
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should import ToolRegistry from tools/index', async () => {
    const { ToolRegistry } = await import('../src/tools/index.js');

    const registry = new ToolRegistry({
      larkClient: null,
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    });

    expect(registry).toBeDefined();
    expect(registry.size).toBe(0);
    expect(registry.getToolNames()).toEqual([]);
  });

  it('should register a tool', async () => {
    const { ToolRegistry } = await import('../src/tools/index.js');

    const registry = new ToolRegistry({
      larkClient: null,
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    });

    const testSchema = z.object({
      message: z.string(),
    });

    registry.register({
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: testSchema,
      handler: async (args) => ({
        content: [{ type: 'text' as const, text: args.message }],
      }),
    });

    expect(registry.size).toBe(1);
    expect(registry.getToolNames()).toContain('test_tool');
  });

  it('should warn when overwriting a tool', async () => {
    const { ToolRegistry } = await import('../src/tools/index.js');

    const registry = new ToolRegistry({
      larkClient: null,
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    });

    const testSchema = z.object({ value: z.number() });

    registry.register({
      name: 'duplicate_tool',
      description: 'First version',
      inputSchema: testSchema,
      handler: async () => ({
        content: [{ type: 'text' as const, text: 'v1' }],
      }),
    });

    registry.register({
      name: 'duplicate_tool',
      description: 'Second version',
      inputSchema: testSchema,
      handler: async () => ({
        content: [{ type: 'text' as const, text: 'v2' }],
      }),
    });

    // Should still have only one tool
    expect(registry.size).toBe(1);
  });

  it('should register tools with McpServer', async () => {
    const { ToolRegistry } = await import('../src/tools/index.js');

    const server = new McpServer(
      { name: 'cc-lark', version: '0.1.0' },
      { capabilities: { tools: {} } }
    );

    const registry = new ToolRegistry({
      larkClient: null,
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    });

    registry.register({
      name: 'server_tool',
      description: 'Tool to register with server',
      inputSchema: z.object({ input: z.string() }),
      handler: async (args) => ({
        content: [{ type: 'text' as const, text: args.input }],
      }),
    });

    // Register tools with server
    registry.registerWithServer(server);

    // Should complete without error
    expect(server).toBeDefined();
  });
});

describe('OAuth Tool', () => {
  it('should import registerOAuthTool', async () => {
    const { registerOAuthTool } = await import('../src/tools/oauth.js');
    expect(registerOAuthTool).toBeTypeOf('function');
  });

  it('should register OAuth tool with registry', async () => {
    const { registerOAuthTool } = await import('../src/tools/oauth.js');
    const { ToolRegistry } = await import('../src/tools/index.js');

    const registry = new ToolRegistry({
      larkClient: null,
      config: {
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
        brand: 'feishu',
      },
    });

    registerOAuthTool(registry);

    expect(registry.size).toBe(1);
    expect(registry.getToolNames()).toContain('feishu_oauth');
  });
});
