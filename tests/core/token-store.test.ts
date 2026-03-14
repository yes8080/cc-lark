/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Tests for token-store.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getStoredToken,
  setStoredToken,
  removeStoredToken,
  listStoredTokens,
  clearAllTokens,
  tokenStatus,
  maskToken,
  getTokensFilePath,
  tokensStorageExists,
  type StoredUAToken,
} from '../../src/core/token-store.js';
import { mkdir, readFile, writeFile, unlink, stat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  chmod: vi.fn(),
  stat: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('maskToken', () => {
  it('should mask short tokens', () => {
    expect(maskToken('abc')).toBe('****');
    expect(maskToken('12345678')).toBe('****');
  });

  it('should show last 4 chars for longer tokens', () => {
    expect(maskToken('123456789')).toBe('****6789');
    expect(maskToken('abcdefghijklmnop')).toBe('****mnop');
  });
});

describe('tokenStatus', () => {
  const now = Date.now();

  it('should return "valid" for token not expiring soon', () => {
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: now + 60 * 60 * 1000, // 1 hour from now
      refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
      scope: 'test',
      grantedAt: now,
    };
    expect(tokenStatus(token)).toBe('valid');
  });

  it('should return "needs_refresh" for token expiring within 5 minutes', () => {
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: now + 4 * 60 * 1000, // 4 minutes from now (within 5 min refresh window)
      refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
      scope: 'test',
      grantedAt: now,
    };
    expect(tokenStatus(token)).toBe('needs_refresh');
  });

  it('should return "needs_refresh" for expired access token but valid refresh token', () => {
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: now - 1000, // Already expired
      refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days from now
      scope: 'test',
      grantedAt: now,
    };
    expect(tokenStatus(token)).toBe('needs_refresh');
  });

  it('should return "expired" when both tokens are expired', () => {
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: now - 1000, // Already expired
      refreshExpiresAt: now - 1000, // Already expired
      scope: 'test',
      grantedAt: now,
    };
    expect(tokenStatus(token)).toBe('expired');
  });
});

describe('getTokensFilePath', () => {
  it('should return path in user home directory', () => {
    const path = getTokensFilePath();
    expect(path).toBe(join(homedir(), '.cc-lark', 'tokens.json'));
  });
});

describe('tokensStorageExists', () => {
  beforeEach(() => {
    vi.mocked(stat).mockReset();
  });

  it('should return true when file exists', async () => {
    vi.mocked(stat).mockResolvedValueOnce({} as any);
    const exists = await tokensStorageExists();
    expect(exists).toBe(true);
  });

  it('should return false when file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(stat).mockRejectedValueOnce(error);
    const exists = await tokensStorageExists();
    expect(exists).toBe(false);
  });
});

describe('getStoredToken', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(mkdir).mockReset();
  });

  it('should return null when storage file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(readFile).mockRejectedValueOnce(error);

    const token = await getStoredToken('app-1', 'user-1');
    expect(token).toBeNull();
  });

  it('should return stored token when exists', async () => {
    const now = Date.now();
    const storedToken: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'test-scope',
      grantedAt: now,
    };

    const storage = {
      version: 1,
      tokens: {
        'app-1:user-1': storedToken,
      },
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));

    const token = await getStoredToken('app-1', 'user-1');
    expect(token).toEqual(storedToken);
  });

  it('should return null when token not found', async () => {
    const storage = {
      version: 1,
      tokens: {},
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));

    const token = await getStoredToken('app-1', 'user-1');
    expect(token).toBeNull();
  });

  it('should return null for unsupported version', async () => {
    const storage = {
      version: 2,
      tokens: {},
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));

    const token = await getStoredToken('app-1', 'user-1');
    expect(token).toBeNull();
  });
});

describe('setStoredToken', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(writeFile).mockReset();
    vi.mocked(mkdir).mockReset();
    vi.mocked(chmod).mockReset();
  });

  it('should create new storage file if not exists', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(readFile).mockRejectedValueOnce(error);
    vi.mocked(mkdir).mockResolvedValueOnce(undefined);
    vi.mocked(writeFile).mockResolvedValueOnce(undefined);
    vi.mocked(chmod).mockResolvedValueOnce(undefined);

    const now = Date.now();
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'test-scope',
      grantedAt: now,
    };

    await setStoredToken(token);

    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    const writtenData = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenData);
    expect(parsed.version).toBe(1);
    expect(parsed.tokens['app-1:user-1']).toEqual(token);
  });

  it('should update existing storage', async () => {
    const now = Date.now();
    const existingToken: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      expiresAt: now,
      refreshExpiresAt: now,
      scope: 'old-scope',
      grantedAt: now,
    };

    const storage = {
      version: 1,
      tokens: {
        'app-1:user-1': existingToken,
      },
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));
    vi.mocked(mkdir).mockResolvedValueOnce(undefined);
    vi.mocked(writeFile).mockResolvedValueOnce(undefined);
    vi.mocked(chmod).mockResolvedValueOnce(undefined);

    const newToken: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'new-scope',
      grantedAt: now,
    };

    await setStoredToken(newToken);

    const writtenData = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenData);
    expect(parsed.tokens['app-1:user-1']).toEqual(newToken);
  });
});

describe('removeStoredToken', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
    vi.mocked(writeFile).mockReset();
    vi.mocked(unlink).mockReset();
  });

  it('should remove existing token', async () => {
    const now = Date.now();
    const token: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'test-scope',
      grantedAt: now,
    };

    const storage = {
      version: 1,
      tokens: {
        'app-1:user-1': token,
      },
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));
    vi.mocked(writeFile).mockResolvedValueOnce(undefined);

    await removeStoredToken('app-1', 'user-1');

    const writtenData = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenData);
    expect(parsed.tokens['app-1:user-1']).toBeUndefined();
  });

  it('should do nothing when storage does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(readFile).mockRejectedValueOnce(error);

    await removeStoredToken('app-1', 'user-1');
    // Should not throw
  });

  it('should do nothing when token does not exist', async () => {
    const storage = {
      version: 1,
      tokens: {},
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));

    await removeStoredToken('app-1', 'user-1');
    // Should not write since no token was removed
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('listStoredTokens', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  it('should list all tokens for given appId', async () => {
    const now = Date.now();
    const token1: StoredUAToken = {
      userOpenId: 'user-1',
      appId: 'app-1',
      accessToken: 'at1',
      refreshToken: 'rt1',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'scope1',
      grantedAt: now,
    };
    const token2: StoredUAToken = {
      userOpenId: 'user-2',
      appId: 'app-1',
      accessToken: 'at2',
      refreshToken: 'rt2',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'scope2',
      grantedAt: now,
    };
    const token3: StoredUAToken = {
      userOpenId: 'user-3',
      appId: 'app-2', // Different app
      accessToken: 'at3',
      refreshToken: 'rt3',
      expiresAt: now + 3600000,
      refreshExpiresAt: now + 604800000,
      scope: 'scope3',
      grantedAt: now,
    };

    const storage = {
      version: 1,
      tokens: {
        'app-1:user-1': token1,
        'app-1:user-2': token2,
        'app-2:user-3': token3,
      },
    };

    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(storage));

    const tokens = await listStoredTokens('app-1');
    expect(tokens).toHaveLength(2);
    expect(tokens).toContainEqual(token1);
    expect(tokens).toContainEqual(token2);
    expect(tokens).not.toContainEqual(token3);
  });

  it('should return empty array when no tokens', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(readFile).mockRejectedValueOnce(error);

    const tokens = await listStoredTokens('app-1');
    expect(tokens).toEqual([]);
  });
});

describe('clearAllTokens', () => {
  beforeEach(() => {
    vi.mocked(unlink).mockReset();
  });

  it('should delete tokens file', async () => {
    vi.mocked(unlink).mockResolvedValueOnce(undefined);

    await clearAllTokens();

    expect(unlink).toHaveBeenCalled();
  });

  it('should not throw when file does not exist', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    vi.mocked(unlink).mockRejectedValueOnce(error);

    await clearAllTokens(); // Should not throw
  });
});
