import { describe, expect, it, vi } from 'vitest';
import type { Plugin } from '@nosdesk/core/types/plugin';
import { createHostApiImpl } from './sandboxHostApi';

const history = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ createPluginAPI: () => ({
  version: '1.1.0', plugin: { uuid: 'caller', name: 'asset-history' },
  tickets: {}, assets: { history }, users: {}, attachments: {}, storage: {}, settings: {},
  ui: {},
}) }));

describe('asset history sandbox adapter', () => {
  it('forwards the async method through the governed host API without losing JSON presence flags', async () => {
    const row = { id: '9007199254740993', diff: [{ field: 'attributes.enabled', old: null, new: false, old_present: false, new_present: true }] };
    const page = { rows: [row], next_cursor: 'opaque', asset_id: 12, retention_days: 540, related_capture_since: null, category_changes_included: false };
    history.mockResolvedValueOnce(page);
    const { hostApi } = createHostApiImpl({ uuid: 'caller' } as Plugin);
    const query = { limit: 50, include_category_changes: false };
    await expect(hostApi.assets.history(12, query)).resolves.toEqual(page);
    expect(history).toHaveBeenCalledWith(12, query);
  });
});
