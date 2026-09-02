/*
 * Multi-select of assignees for a task: any mix of board members and teams.
 * `value` is an array of { type: "user" | "team", id }.
 */
export default function AssigneePicker({ board, value, onChange }) {
  const members = board?.members || [];
  const teams = board?.teams || [];
  if (members.length === 0 && teams.length === 0) return null;

  const has = (type, id) => value.some((a) => a.type === type && a.id === id);
  const toggle = (type, id) =>
    onChange(
      has(type, id)
        ? value.filter((a) => !(a.type === type && a.id === id))
        : [...value, { type, id }]
    );

  return (
    <div className="assignee-picker">
      {members.map((m) => (
        <label key={`u_${m.id}`} className="dependency-option">
          <input
            type="checkbox"
            checked={has("user", m.id)}
            onChange={() => toggle("user", m.id)}
          />
          <span>{m.display_name}</span>
        </label>
      ))}
      {teams.map((t) => (
        <label key={`t_${t.id}`} className="dependency-option">
          <input
            type="checkbox"
            checked={has("team", t.id)}
            onChange={() => toggle("team", t.id)}
          />
          <span>
            {t.name} <span className="assignee-team-tag">team</span>
          </span>
        </label>
      ))}
    </div>
  );
}
