/** Read the latest saved lifecycle transition, independent of API array order.
 * Timestamps select the event; the stable record ID breaks equal-time ties.
 * These projections never write assets or fabricate a transition from status. */
export function latestLifecycleEvent(events) {
  return events.reduce((latest, event) => {
    const time = Date.parse(event.occurred_at);
    if (!Number.isFinite(time)) return latest;
    if (!latest) return event;
    const previous = Date.parse(latest.occurred_at);
    return time > previous || time === previous && event.id > latest.id ? event : latest;
  }, null);
}
export function lifecycleSummary(event) {
  if (!event) return '—';
  const label = value => String(value ?? '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  const transition = event.from_status ? label(event.from_status) + ' → ' + label(event.to_status) : label(event.to_status);
  return event.reason?.trim() ? transition + ' — ' + event.reason.trim() : transition;
}
