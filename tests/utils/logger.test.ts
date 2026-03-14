/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for the logger utility.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, defaultLogger } from '../../src/utils/logger.js';

describe('logger', () => {
  // Mock console methods
  const originalConsole = {
    log: console.log,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    console.log = vi.fn();
    console.debug = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('logger factory', () => {
    it('should create a logger with the correct subsystem', () => {
      const log = logger('test');
      expect(log.subsystem).toBe('test');
    });

    it('should create child loggers with nested subsystems', () => {
      const log = logger('parent');
      const child = log.child('child');
      expect(child.subsystem).toBe('parent/child');

      const grandchild = child.child('grandchild');
      expect(grandchild.subsystem).toBe('parent/child/grandchild');
    });
  });

  describe('logging methods', () => {
    it('should call console.debug for debug level', () => {
      const log = logger('test');
      log.debug('test message');

      expect(console.debug).toHaveBeenCalled();
      const call = (console.debug as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('cc-lark/test');
      expect(call[1]).toContain('test message');
    });

    it('should call console.log for info level', () => {
      const log = logger('test');
      log.info('test message');

      expect(console.log).toHaveBeenCalled();
      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('cc-lark/test');
      expect(call[1]).toContain('test message');
    });

    it('should call console.warn for warn level', () => {
      const log = logger('test');
      log.warn('test message');

      expect(console.warn).toHaveBeenCalled();
      const call = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('cc-lark/test');
      expect(call[1]).toContain('test message');
    });

    it('should call console.error for error level', () => {
      const log = logger('test');
      log.error('test message');

      expect(console.error).toHaveBeenCalled();
      const call = (console.error as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('cc-lark/test');
      expect(call[1]).toContain('test message');
    });
  });

  describe('metadata handling', () => {
    it('should format metadata in message', () => {
      const log = logger('test');
      log.info('test message', { key: 'value', count: 42 });

      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('key=value');
      expect(call[1]).toContain('count=42');
    });

    it('should handle empty metadata', () => {
      const log = logger('test');
      log.info('test message', {});

      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('test message');
    });

    it('should handle null and undefined metadata values', () => {
      const log = logger('test');
      log.info('test message', { key: null, other: undefined });

      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('test message');
    });

    it('should stringify object values in metadata', () => {
      const log = logger('test');
      log.info('test message', { obj: { nested: 'value' } });

      const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toContain('obj={"nested":"value"}');
    });
  });

  describe('defaultLogger', () => {
    it('should have subsystem "core"', () => {
      expect(defaultLogger.subsystem).toBe('core');
    });

    it('should be a valid logger instance', () => {
      expect(typeof defaultLogger.info).toBe('function');
      expect(typeof defaultLogger.debug).toBe('function');
      expect(typeof defaultLogger.warn).toBe('function');
      expect(typeof defaultLogger.error).toBe('function');
      expect(typeof defaultLogger.child).toBe('function');
    });
  });
});
