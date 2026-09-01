import { useState } from "react";
import { useDraggable } from "@dnd-kit/core";

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

  function save(e) {
    e.preventDefault();

    if (!title.trim()) return;

    onUpdate(task.id, {
      title: title.trim(),
      description,
      priority,
      storyPoints: Number(points),
      dependencyIds,
      sprintId: sprintId || null,
    });

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