import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '@nosdesk/core/apiClient';
import pluginService from '@nosdesk/core/services/pluginService';

vi.mock('@nosdesk/core/apiClient', () => ({ default: { get: vi.fn() } }));

describe('authenticated asset history service', () => {
  beforeEach(() => { vi.mocked(apiClient.get).mockReset(); });

  it('addresses only the calling plugin and requested asset and passes date/cursor filters', async () => {
    const page = { rows: [], next_cursor: null };
    vi.mocked(apiClient.get).mockResolvedValue({ data: page });
    const query = { cursor: 'opaque+cursor/with?characters', limit: 50, since: '2026-10-01T00:00:00Z', include_category_changes: true };
    await expect(pluginService.getAssetHistory('caller/plugin', 12, query)).resolves.toBe(page);
    expect(apiClient.get).toHaveBeenCalledWith('/plugins/caller%2Fplugin/assets/12/history', { params: query });
  });

  it('propagates an HTTP denial without returning an empty page', async () => {
    const denied = { response: { status: 403 } };
    vi.mocked(apiClient.get).mockRejectedValue(denied);
    await expect(pluginService.getAssetHistory('caller', 12)).rejects.toBe(denied);
  });
});
