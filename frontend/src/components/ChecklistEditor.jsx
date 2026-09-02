import { useState } from "react";

/*
 * Presentational checklist. `items` are `{ id, title, done }`. The parent owns
 * the data — for a new task that's local state, for an existing task it's the
 * live subtask list. Callbacks: onAdd(title), onToggle(item), onRemove(item).
 */
export default function ChecklistEditor({ items, onAdd, onToggle, onRemove }) {
  const [draft, setDraft] = useState("");
  const done = items.filter((i) => i.done).length;

  function submitDraft() {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  }

  return (
    <div className="checklist">
      {items.length > 0 && (
        <div className="checklist-head">
          <div className="checklist-bar">
            <div
              className="checklist-bar-fill"
              style={{ width: `${Math.round((done / items.length) * 100)}%` }}
            />
          </div>
          <span className="checklist-count">
            {done}/{items.length}
          </span>
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          className={"checklist-item" + (item.done ? " done" : "")}
        >
          <label>
            <input
              type="checkbox"
              checked={!!item.done}
              onChange={() => onToggle(item)}
            />
            <span>{item.title}</span>
          </label>
          <button
            type="button"
            className="checklist-remove"
            aria-label="Remove"
            onClick={() => onRemove(item)}
          >
            ×
          </button>
        </div>
      ))}

      <div className="checklist-add">
        <input
          type="text"
          placeholder="Add an item…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitDraft();
            }
          }}
        />
        <button type="button" className="btn-ghost" onClick={submitDraft}>
          Add
        </button>
      </div>
    </div>
  );
}
