function daysRemaining(endsAt) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

export default function SprintBar({ board, value, onChange }) {
  const sprints = board.sprints || [];
  const selected =
    value !== "all" && value !== "backlog"
      ? sprints.find((s) => s.id === value)
      : null;

  const sprintTasks = selected
    ? (board.tasks || []).filter((t) => t.sprint_id === selected.id)
    : [];
  const committed = sprintTasks.reduce((n, t) => n + (t.story_points || 0), 0);
  const completed = sprintTasks
    .filter((t) => t.status === "done")
    .reduce((n, t) => n + (t.story_points || 0), 0);
  const pct = committed > 0 ? Math.round((completed / committed) * 100) : 0;
  const left = selected ? daysRemaining(selected.ends_at) : null;

  return (
    <div className="sprint-bar">
      <div className="sprint-switcher">
        <button
          type="button"
          className={"sprint-chip" + (value === "all" ? " selected" : "")}
          onClick={() => onChange("all")}
        >
          All tasks
        </button>
        <button
          type="button"
          className={"sprint-chip" + (value === "backlog" ? " selected" : "")}
          onClick={() => onChange("backlog")}
        >
          Backlog
        </button>
        {sprints.map((s) => (
          <button
            key={s.id}
            type="button"
            className={
              "sprint-chip" +
              (value === s.id ? " selected" : "") +
              (s.is_active ? " is-active" : "")
            }
            onClick={() => onChange(s.id)}
          >
            {s.name}
            {s.is_active ? " ·  active" : ""}
          </button>
        ))}
      </div>

      {selected && (
        <div className="sprint-progress">
          <div className="sprint-progress-meta">
            <span>
              {completed} / {committed} pts
            </span>
            {left !== null && (
              <span>
                {left > 0 ? `${left} day${left === 1 ? "" : "s"} left` : "ended"}
              </span>
            )}
            {selected.goal && <span className="sprint-goal">{selected.goal}</span>}
          </div>
          <div className="sprint-progress-track">
            <div
              className="sprint-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
