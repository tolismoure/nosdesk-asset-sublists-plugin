import type { AssetLifecycleEvent } from '@nosdesk/core/types/asset';
export function latestLifecycleEvent(events:AssetLifecycleEvent[]):AssetLifecycleEvent|null;
export function lifecycleSummary(event:AssetLifecycleEvent|null):string;
