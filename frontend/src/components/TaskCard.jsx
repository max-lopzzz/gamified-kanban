import { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import AssigneePicker from "./AssigneePicker.jsx";
import { api } from "../api";

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const XP_PER_POINT = 10;

const PRIORITY_MULT = {
  low: 0.75,
  normal: 1,
  high: 1.25,
  urgent: 1.5,
};

export default function TaskCard({
  task,
  allTasks,
  board,
  onUpdate,
  onDelete,
  onTaskMutated,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: task.id,
  });

  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(
    task.description || ""
  );
  const [priority, setPriority] = useState(
    task.priority
  );
  const [points, setPoints] = useState(
    task.story_points
  );
  const [dependencyIds, setDependencyIds] = useState(
    (task.dependencies || []).map((d) => d.id)
  );
  const [sprintId, setSprintId] = useState(
    task.sprint_id || ""
  );
  const [assignees, setAssignees] = useState(
    (task.assignees || []).map((a) => ({ type: a.type, id: a.id }))
  );

  // Subtasks are edited live (each toggle is its own request), so keep a local
  // copy that also resyncs when the board reloads.
  const [subtasks, setSubtasks] = useState(task.subtasks || []);
  const [newSubtask, setNewSubtask] = useState("");
  useEffect(() => {
    setSubtasks(task.subtasks || []);
  }, [JSON.stringify(task.subtasks || [])]);

  const subDone = subtasks.filter((s) => s.done).length;
  const subPct = subtasks.length
    ? Math.round((subDone / subtasks.length) * 100)
    : 0;

  async function addSubtask(e) {
    e.preventDefault();
    const title = newSubtask.trim();
    if (!title) return;
    try {
      const created = await api.createSubtask(task.id, title);
      setSubtasks((cur) => [...cur, created]);
      setNewSubtask("");
    } catch {
      /* ignore; keep the input */
    }
  }

  async function toggleSubtask(sub) {
    const next = !sub.done;
    setSubtasks((cur) =>
      cur.map((s) => (s.id === sub.id ? { ...s, done: next ? 1 : 0 } : s))
    );
    try {
      const res = await api.updateSubtask(sub.id, { done: next });
      if (res.taskCompleted) onTaskMutated?.(res.gamification);
    } catch {
      setSubtasks((cur) =>
        cur.map((s) => (s.id === sub.id ? { ...s, done: next ? 0 : 1 } : s))
      );
    }
  }

  async function removeSubtask(sub) {
    setSubtasks((cur) => cur.filter((s) => s.id !== sub.id));
    try {
      await api.deleteSubtask(sub.id);
    } catch {
      setSubtasks((cur) => [...cur, sub]);
    }
  }

  const style = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
      }
    : undefined;

  const xp = Math.round(
    task.story_points *
      XP_PER_POINT *
      (PRIORITY_MULT[task.priority] ?? 1)
  );

  async function save(e) {
    e.preventDefault();

    if (!title.trim()) return;

    try {
      await onUpdate(task.id, {
        title: title.trim(),
        description,
        priority,
        storyPoints: Number(points),
        dependencyIds,
        assignees,
        sprintId: sprintId || null,
      });
    } catch {
      // Board surfaces the error; keep the editor open so the edit isn't lost.
      return;
    }

    setEditing(false);
  }

  function toggleDependency(id) {
    setDependencyIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
    );
  }

  if (editing) {
    return (
      <div className="task-card task-card-editing">
        <form onSubmit={save}>
          <input
            type="text"
            value={title}
            onChange={(e) =>
              setTitle(e.target.value)
            }
            autoFocus
          />

          <textarea
            value={description}
            onChange={(e) =>
              setDescription(e.target.value)
            }
            placeholder="Description"
            rows={4}
          />

          <div className="new-task-row">
            <select
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value)
              }
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>

            <input
              type="number"
              min={1}
              max={1000}
              value={points}
              onChange={(e) =>
                setPoints(e.target.value)
              }
            />
          </div>

          <label>Sprint</label>

          <select
            value={sprintId}
            onChange={(e) =>
              setSprintId(e.target.value)
            }
          >
            <option value="">No sprint</option>

            {(board?.sprints || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label>Assignees</label>
          <AssigneePicker
            board={board}
            value={assignees}
            onChange={setAssignees}
          />

          <label>
            Checklist
            {subtasks.length > 0 && ` — ${subDone}/${subtasks.length}`}
          </label>
          <div className="subtask-list">
            {subtasks.map((s) => (
              <div key={s.id} className="subtask-row">
                <label className="dependency-option">
                  <input
                    type="checkbox"
                    checked={!!s.done}
                    onChange={() => toggleSubtask(s)}
                  />
                  <span className={s.done ? "subtask-done" : undefined}>
                    {s.title}
                  </span>
                </label>
                <button
                  type="button"
                  className="subtask-remove"
                  title="Remove"
                  onClick={() => removeSubtask(s)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="new-task-row">
            <input
              type="text"
              placeholder="Add a checklist item"
              value={newSubtask}
              onChange={(e) => setNewSubtask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSubtask(e);
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              onClick={addSubtask}
            >
              Add
            </button>
          </div>

          {allTasks.filter((t) => t.id !== task.id).length >
            0 && (
            <div className="dependency-picker">
              <label>Dependencies</label>

              <div className="dependency-options">
                {allTasks
                  .filter((t) => t.id !== task.id)
                  .map((otherTask) => (
                    <label
                      key={otherTask.id}
                      className="dependency-option"
                    >
                      <input
                        type="checkbox"
                        checked={dependencyIds.includes(
                          otherTask.id
                        )}
                        onChange={() =>
                          toggleDependency(otherTask.id)
                        }
                      />

                      <span>{otherTask.title}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          <div className="new-task-row">
            <button
              className="btn-primary"
              type="submit"
            >
              Save
            </button>

            <button
              className="btn-ghost"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>

          <button
            className="btn-danger"
            type="button"
            onClick={() => onDelete(task)}
          >
            Delete task
          </button>
        </form>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        "task-card" +
        (isDragging ? " dragging" : "")
      }
    >
      <div
        {...listeners}
        {...attributes}
        className="task-card-drag-area"
      >
        <div className="task-card-title">
          {task.title}
        </div>

        {task.description && (
          <div className="task-card-description">
            {task.description}
          </div>
        )}

        <div className="task-card-meta">
          <span
            className={`task-priority ${task.priority}`}
          >
            {task.priority}
          </span>

          <span className="task-xp">
            +{xp} XP
          </span>
        </div>

        {subtasks.length > 0 && (
          <div className="subtask-progress">
            <div className="subtask-progress-track">
              <div
                className="subtask-progress-fill"
                style={{ width: `${subPct}%` }}
              />
            </div>
            <span className="subtask-progress-label">
              {subDone}/{subtasks.length}
            </span>
          </div>
        )}

        {task.assignees?.length > 0 && (
          <div className="task-assignees">
            {task.assignees.map((a) => (
              <span
                key={`${a.type}_${a.id}`}
                className={`assignee-chip assignee-chip-${a.type}`}
                title={a.name || a.id}
              >
                {a.type === "team" ? a.name : initials(a.name)}
              </span>
            ))}
          </div>
        )}

        {task.dependencies?.length > 0 && (
          <div className="task-dependencies">
            Depends on:{" "}
            {task.dependencies
              .map((dependency) => dependency.title)
              .join(", ")}
          </div>
        )}
      </div>

      <div className="task-card-actions">
        <button
          className="btn-ghost"
          type="button"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>

        <button
          className="btn-danger"
          type="button"
          onClick={() => onDelete(task)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}