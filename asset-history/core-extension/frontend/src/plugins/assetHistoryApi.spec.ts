import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin, PluginAssetHistoryPage } from '@nosdesk/core/types/plugin';
import pluginService from '@nosdesk/core/services/pluginService';
import { createAssetHistoryReader, validatedAssetHistoryQuery } from './assetHistoryApi';

vi.mock('@nosdesk/core/services/pluginService', () => ({ default: { getAssetHistory: vi.fn() } }));

const page: PluginAssetHistoryPage = { rows: [], next_cursor: null, asset_id: 12, retention_days: 540, related_capture_since: null, category_changes_included: false };
const plugin = (consented: string[] | null = ['asset:history:read']) => ({
  uuid: '0190a5b2-0000-7000-8000-000000000001',
  name: 'asset-history',
  consented_permissions: consented,
  manifest: { permissions: ['asset:history:read'] },
} as unknown as Plugin);

describe('asset history custom bridge', () => {
  beforeEach(() => { vi.mocked(pluginService.getAssetHistory).mockReset(); });

  it('forwards the validated query with the calling plugin identity', async () => {
    vi.mocked(pluginService.getAssetHistory).mockResolvedValue(page);
    const query = { cursor: 'opaque-cursor', limit: 50, since: '2026-10-01T00:00:00Z', until: '2026-10-13T00:00:00Z', include_category_changes: true };
    await expect(createAssetHistoryReader(plugin())(12, query)).resolves.toBe(page);
    expect(pluginService.getAssetHistory).toHaveBeenCalledWith(plugin().uuid, 12, query);
  });

  it('rejects a requested but unconsented permission without an HTTP call', async () => {
    await expect(createAssetHistoryReader(plugin([]))(12)).rejects.toMatchObject({ code: 'denied' });
    expect(pluginService.getAssetHistory).not.toHaveBeenCalled();
  });

  it('rechecks grants and preserves the existing legacy-null consent policy', async () => {
    vi.mocked(pluginService.getAssetHistory).mockResolvedValue(page);
    const record = plugin(null);
    const read = createAssetHistoryReader(record);
    await expect(read(12)).resolves.toBe(page);
    record.consented_permissions = [];
    await expect(read(12)).rejects.toMatchObject({ code: 'denied' });
    expect(pluginService.getAssetHistory).toHaveBeenCalledTimes(1);
  });

  it.each([
    { response: { status: 403, data: { secret: 'must-not-cross-the-bridge' } } },
    { response: { status: 401 } },
  ])('does not turn server denials into an empty history', async (error) => {
    vi.mocked(pluginService.getAssetHistory).mockRejectedValue(error);
    await expect(createAssetHistoryReader(plugin())(12)).rejects.toMatchObject({ code: 'denied' });
  });

  it('does not expose backend error bodies', async () => {
    vi.mocked(pluginService.getAssetHistory).mockRejectedValue({ response: { status: 500, data: { secret: 'must-not-cross-the-bridge' } } });
    await expect(createAssetHistoryReader(plugin())(12)).rejects.toMatchObject({ code: 'upstream', message: 'upstream: Unable to retrieve asset history' });
  });

  it.each([[400, 'invalid'], [422, 'invalid'], [429, 'rate_limited'], [404, 'not_found']])('preserves the appropriate failure class for HTTP %s', async (status, code) => {
    vi.mocked(pluginService.getAssetHistory).mockRejectedValue({ response: { status } });
    await expect(createAssetHistoryReader(plugin())(12)).rejects.toMatchObject({ code });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])('rejects invalid asset ID %s', (id) => {
    expect(() => validatedAssetHistoryQuery(id)).toThrow();
  });

  it.each([
    { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: '50' },
    { cursor: '' }, { cursor: 'x'.repeat(2049) }, { include_category_changes: 'true' },
    { since: '2026-10-01' }, { since: '2026-10-01T00:00:00' },
    { since: '2026-10-13T00:00:00Z', until: '2026-10-01T00:00:00Z' },
    { table_name: 'users' }, null, [],
  ])('rejects malformed or unrelated history filters', (query) => {
    expect(() => validatedAssetHistoryQuery(12, query as never)).toThrow();
  });

  it('accepts a timezone-offset range and copies false category option', () => {
    const query = { since: '2026-10-01T00:00:00+10:00', until: '2026-10-13T00:00:00.123Z', include_category_changes: false };
    const result = validatedAssetHistoryQuery(12, query);
    expect(result).toEqual(query);
    expect(result).not.toBe(query);
  });
});
