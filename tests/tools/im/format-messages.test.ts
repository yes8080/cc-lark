/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for IM tools message formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  extractMentionOpenId,
  convertMessageContent,
  buildConvertContextFromItem,
  type ApiMessageItem,
} from '../../../src/tools/im/format-messages.js';

describe('format-messages', () => {
  describe('extractMentionOpenId', () => {
    it('should extract open_id from string', () => {
      expect(extractMentionOpenId('ou_abc123')).toBe('ou_abc123');
    });

    it('should extract open_id from object', () => {
      expect(extractMentionOpenId({ open_id: 'ou_abc123' })).toBe('ou_abc123');
    });

    it('should return empty string for null', () => {
      expect(extractMentionOpenId(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(extractMentionOpenId(undefined)).toBe('');
    });

    it('should return empty string for object without open_id', () => {
      expect(extractMentionOpenId({ user_id: 'abc' })).toBe('');
    });
  });

  describe('convertMessageContent', () => {
    const ctx = {
      messageId: 'test-msg',
    };

    it('should convert text message', () => {
      const content = JSON.stringify({ text: 'Hello world' });
      const result = convertMessageContent(content, 'text', ctx);
      expect(result).toBe('Hello world');
    });

    it('should convert image message', () => {
      const content = JSON.stringify({ image_key: 'img_abc123' });
      const result = convertMessageContent(content, 'image', ctx);
      expect(result).toBe('[Image: img_abc123]');
    });

    it('should convert file message', () => {
      const content = JSON.stringify({ file_key: 'file_abc123', file_name: 'document.pdf' });
      const result = convertMessageContent(content, 'file', ctx);
      expect(result).toBe('[File: document.pdf]');
    });

    it('should convert audio message', () => {
      const content = JSON.stringify({ file_key: 'file_abc123', file_name: 'recording.mp3' });
      const result = convertMessageContent(content, 'audio', ctx);
      expect(result).toBe('[Audio: recording.mp3]');
    });

    it('should convert media message', () => {
      const content = JSON.stringify({ media_key: 'media_abc123', file_name: 'video.mp4' });
      const result = convertMessageContent(content, 'media', ctx);
      expect(result).toBe('[Media: video.mp4]');
    });

    it('should convert sticker message', () => {
      const content = JSON.stringify({ file_key: 'sticker_abc123' });
      const result = convertMessageContent(content, 'sticker', ctx);
      expect(result).toBe('[Sticker: sticker_abc123]');
    });

    it('should convert interactive card message', () => {
      const content = JSON.stringify({});
      const result = convertMessageContent(content, 'interactive', ctx);
      expect(result).toBe('[Interactive Card]');
    });

    it('should convert share_chat message', () => {
      const content = JSON.stringify({ chat_id: 'oc_abc123' });
      const result = convertMessageContent(content, 'share_chat', ctx);
      expect(result).toBe('[Share Chat: oc_abc123]');
    });

    it('should convert share_user message', () => {
      const content = JSON.stringify({ user_id: 'ou_abc123' });
      const result = convertMessageContent(content, 'share_user', ctx);
      expect(result).toBe('[Share User: ou_abc123]');
    });

    it('should convert merge_forward message', () => {
      const content = JSON.stringify({});
      const result = convertMessageContent(content, 'merge_forward', ctx);
      expect(result).toBe('[Merged Forwarded Messages]');
    });

    it('should convert post message with title and content', () => {
      const content = JSON.stringify({
        zh_cn: {
          title: 'Title',
          content: [
            [{ tag: 'text', text: 'Line 1' }],
            [{ tag: 'text', text: 'Line 2' }],
          ],
        },
      });
      const result = convertMessageContent(content, 'post', ctx);
      expect(result).toContain('Title');
      expect(result).toContain('Line 1');
      expect(result).toContain('Line 2');
    });

    it('should return raw content for unknown message type', () => {
      const content = '{"custom": "data"}';
      const result = convertMessageContent(content, 'unknown_type', ctx);
      expect(result).toBe('{"custom": "data"}');
    });

    it('should return raw content for invalid JSON', () => {
      const content = 'not valid json';
      const result = convertMessageContent(content, 'text', ctx);
      expect(result).toBe('not valid json');
    });

    it('should handle empty content', () => {
      const result = convertMessageContent('', 'text', ctx);
      expect(result).toBe('');
    });
  });

  describe('buildConvertContextFromItem', () => {
    it('should build context from API message item', () => {
      const item: ApiMessageItem = {
        message_id: 'om_test123',
        msg_type: 'text',
        body: { content: '{"text":"hello"}' },
        sender: { id: 'ou_sender', sender_type: 'user' },
        mentions: [
          { key: '@_user_1', id: 'ou_mentioned', name: 'John' },
        ],
      };

      const ctx = buildConvertContextFromItem(item, 'fallback-id', 'account-1');

      expect(ctx.messageId).toBe('om_test123');
      expect(ctx.accountId).toBe('account-1');
      // mentions and mentionsByOpenId are internal Maps, not exposed on ConvertContext
    });

    it('should use fallback message ID if not present', () => {
      const item: ApiMessageItem = {};
      const ctx = buildConvertContextFromItem(item, 'fallback-id');

      expect(ctx.messageId).toBe('fallback-id');
    });

    it('should handle empty mentions', () => {
      const item: ApiMessageItem = {
        message_id: 'om_test',
        mentions: [],
      };

      const ctx = buildConvertContextFromItem(item, 'fallback');
      // mentions and mentionsByOpenId are internal Maps, not exposed on ConvertContext
      expect(ctx.messageId).toBe('om_test');
    });

    it('should handle missing mentions', () => {
      const item: ApiMessageItem = {
        message_id: 'om_test',
      };

      const ctx = buildConvertContextFromItem(item, 'fallback');
      expect(ctx.messageId).toBe('om_test');
    });
  });
});
