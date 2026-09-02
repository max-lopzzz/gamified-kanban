/*
 * A sprint's "active" state is derived from the calendar, not stored: a sprint
 * is active while today's date falls within [starts_at, ends_at] (inclusive,
 * date-only comparison). If several sprints overlap today, the one that started
 * most recently wins (then the most recently created). Sprints missing either
 * date can never be auto-active.
 *
 * The `is_active` column still exists but is no longer the source of truth for
 * what the UI shows; callers should run their sprint rows through this.
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function activeSprintId(sprints, ref = today()) {
  const inWindow = sprints
    .filter(
      (s) => s.starts_at && s.ends_at && s.starts_at <= ref && ref <= s.ends_at
    )
    .sort(
      (a, b) =>
        String(b.starts_at).localeCompare(String(a.starts_at)) ||
        String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
    );
  return inWindow[0]?.id ?? null;
}

export function withDerivedActive(sprints, ref = today()) {
  const id = activeSprintId(sprints, ref);
  return sprints.map((s) => ({ ...s, is_active: s.id === id ? 1 : 0 }));
}
