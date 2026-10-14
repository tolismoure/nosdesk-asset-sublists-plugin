// Host-only read bridge: input validation and consent do not replace server
// workspace/role authorization. Never implement a generic audit or storage reader here.
/** Read-only custom bridge for authoritative retained asset history.
 * This extension deliberately exposes neither generic audit queries nor writes. */
import pluginService from '@nosdesk/core/services/pluginService';
import { PluginApiError } from '@nosdesk/plugin-sdk';
import type { Plugin, PluginAssetHistoryQuery, PluginAssetHistoryPage } from '@nosdesk/core/types/plugin';
import { effectivePermissions } from './permissions';

const queryKeys = new Set(['cursor', 'limit', 'since', 'until', 'include_category_changes']);
const datePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Validate values received over the untyped sandbox boundary, then copy only
 * documented query keys into the authenticated service call. Server validation
 * and access checks remain authoritative. */
export function validatedAssetHistoryQuery(id: number, query: PluginAssetHistoryQuery = {}): PluginAssetHistoryQuery {
  const invalid = (message: string): never => { throw new PluginApiError('invalid', message); };
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) invalid('A positive asset ID is required');
  if (!query || typeof query !== 'object' || Array.isArray(query)) invalid('Invalid history query');
  if (Object.keys(query).some((key) => !queryKeys.has(key))) invalid('Unknown history filter');
  const params: PluginAssetHistoryQuery = {};
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length === 0 || query.cursor.length > 2048) invalid('Invalid history cursor');
    params.cursor = query.cursor;
  }
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200) invalid('History page size must be between 1 and 200');
    params.limit = query.limit;
  }
  for (const key of ['since', 'until'] as const) {
    const value = query[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !datePattern.test(value) || !Number.isFinite(Date.parse(value))) invalid('History dates must be RFC3339 timestamps with a timezone');
      params[key] = value;
    }
  }
  if (params.since && params.until && Date.parse(params.since) >= Date.parse(params.until)) invalid('History start date must precede the end date');
  if (query.include_category_changes !== undefined) {
    if (typeof query.include_category_changes !== 'boolean') invalid('Invalid category history option');
    params.include_category_changes = query.include_category_changes;
  }
  return params;
}

export function createAssetHistoryReader(plugin: Plugin): (id: number, query?: PluginAssetHistoryQuery) => Promise<PluginAssetHistoryPage> {
  return async (id, query = {}) => {
    // Recheck the effective (consented) grant at each call, never the raw request.
    if (!effectivePermissions(plugin).includes('asset:history:read')) {
      throw new PluginApiError('denied', 'asset:history:read not granted');
    }
    const params = validatedAssetHistoryQuery(id, query);
    try {
      return await pluginService.getAssetHistory(plugin.uuid, id, params);
    } catch (error) {
      // Both axios errors and the host's AppError preserve response.status. Use
      // fixed messages so a backend error cannot leak historical data across
      // the bridge. Failure is never mistaken for a successful empty timeline.
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      if (status === 401 || status === 403) {
        throw new PluginApiError('denied', 'Asset history requires a permitted workspace administrator');
      }
      if (status === 400 || status === 422) throw new PluginApiError('invalid', 'Invalid history query or cursor');
      if (status === 429) throw new PluginApiError('rate_limited', 'Asset history request rate exceeded');
      if (status === 404) throw new PluginApiError('not_found', 'No accessible retained history was found for this asset');
      throw new PluginApiError('upstream', 'Unable to retrieve asset history');
    }
  };
}
