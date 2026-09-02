const PRIORITIES = ["low", "normal", "high", "urgent"];

export const EMPTY_FILTERS = { priorities: [], assignee: "any", text: "" };

export function filtersActive(f) {
  return f.priorities.length > 0 || f.assignee !== "any" || f.text.trim() !== "";
}

/*
 * Client-side board filters: priority (multi), assignee, and a text match on
 * title + description. State lives in BoardPage and resets on reload.
 */
export default function BoardFilters({ board, value, onChange }) {
  const togglePriority = (p) =>
    onChange({
      ...value,
      priorities: value.priorities.includes(p)
        ? value.priorities.filter((x) => x !== p)
        : [...value.priorities, p],
    });

  return (
    <div className="board-filters">
      <div className="filter-chips">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            className={
              "filter-chip filter-chip-" +
              p +
              (value.priorities.includes(p) ? " selected" : "")
            }
            onClick={() => togglePriority(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <select
        className="filter-assignee"
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
      >
        <option value="any">Anyone</option>
        <option value="me">Me</option>
        <option value="unassigned">Unassigned</option>
        {(board?.members || []).map((m) => (
          <option key={`u_${m.id}`} value={`u:${m.id}`}>
            {m.display_name}
          </option>
        ))}
        {(board?.teams || []).map((t) => (
          <option key={`t_${t.id}`} value={`t:${t.id}`}>
            {t.name} (team)
          </option>
        ))}
      </select>

      <input
        type="text"
        className="filter-search"
        placeholder="Search title / description"
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
      />

      {filtersActive(value) && (
        <button
          type="button"
          className="btn-ghost filter-clear"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Clear
        </button>
      )}
    </div>
  );
}

/*
 * Does a task pass the current filters? `currentUserId` is used for the "Me"
 * option (direct user-assignment only; team membership isn't known client-side).
 */
export function taskMatchesFilters(task, filters, currentUserId) {
  if (
    filters.priorities.length > 0 &&
    !filters.priorities.includes(task.priority)
  ) {
    return false;
  }

  const assignees = task.assignees || [];
  const a = filters.assignee;
  if (a === "unassigned" && assignees.length > 0) return false;
  if (a === "me" && !assignees.some((x) => x.type === "user" && x.id === currentUserId)) {
    return false;
  }
  if (a.startsWith("u:") && !assignees.some((x) => x.type === "user" && x.id === a.slice(2))) {
    return false;
  }
  if (a.startsWith("t:") && !assignees.some((x) => x.type === "team" && x.id === a.slice(2))) {
    return false;
  }

  const text = filters.text.trim().toLowerCase();
  if (text) {
    const hay = `${task.title} ${task.description || ""}`.toLowerCase();
    if (!hay.includes(text)) return false;
  }

  return true;
}
