import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import TaskCard from "./TaskCard.jsx";
import AssigneePicker from "./AssigneePicker.jsx";

function defaultSprintFor(sprintFilter) {
  return sprintFilter && sprintFilter !== "all" && sprintFilter !== "backlog"
    ? sprintFilter
    : "";
}

export default function Column({
  status,
  title,
  tasks,
  allTasks,
  onCreateTask,
  board,
  sprintFilter,
  onUpdateTask,
  onDeleteTask,
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  const [showForm, setShowForm] = useState(false);

  const [title_, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [points, setPoints] = useState(2);

  const [assignees, setAssignees] = useState([]);

  const [sprintId, setSprintId] = useState(
    defaultSprintFor(sprintFilter)
  );

  // Keep the new-task sprint in step with the sprint being viewed in the
  // SprintBar; switching sprints there should retarget the form.
  useEffect(() => {
    setSprintId(defaultSprintFor(sprintFilter));
  }, [sprintFilter]);

  const [dependencyIds, setDependencyIds] =
    useState([]);

  async function submit(e) {
    e.preventDefault();

    if (!title_.trim()) return;

    try {
      await onCreateTask({
        title: title_.trim(),
        description,
        priority,
        storyPoints: Number(points),
        assignees,
        sprintId: sprintId || null,
        dependencyIds,
      });
    } catch {
      // Board surfaces the error; keep the form open with its input intact.
      return;
    }

    setTitle("");
    setDescription("");
    setPriority("normal");
    setPoints(2);
    setAssignees([]);
    setSprintId(defaultSprintFor(sprintFilter));
    setDependencyIds([]);
    setShowForm(false);
  }

  function toggleDependency(id) {
    setDependencyIds((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id]
    );
  }

  return (
    <div className="column">
      <div className="column-header">
        <span className="column-title">{title}</span>
        <span className="column-count">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={
          "column-body" +
          (isOver ? " drag-over" : "")
        }
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            board={board}
            onUpdate={onUpdateTask}
            onDelete={onDeleteTask}
            allTasks={allTasks}
          />
        ))}
      </div>

      {status === "backlog" && (
        <div className="new-task-form">
          {showForm ? (
            <form onSubmit={submit}>

              <input
                type="text"
                placeholder="Task title"
                value={title_}
                onChange={(e) =>
                  setTitle(e.target.value)
                }
                autoFocus
              />

              <textarea
                placeholder="Description"
                value={description}
                onChange={(e) =>
                  setDescription(e.target.value)
                }
                rows={3}
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
                  title="Story points"
                />
              </div>

              <label>Assignees</label>
              <AssigneePicker
                board={board}
                value={assignees}
                onChange={setAssignees}
              />

              <label>
                Sprint
              </label>

              <select
                value={sprintId}
                onChange={(e) =>
                  setSprintId(e.target.value)
                }
              >
                <option value="">
                  No sprint
                </option>

                {(board.sprints || []).map((sprint) => (
                  <option
                    key={sprint.id}
                    value={sprint.id}
                  >
                    {sprint.name}
                  </option>
                ))}
              </select>

              <label>
                Dependencies
              </label>

              <div className="dependency-list">
                {(board.tasks || [])
                  .filter((task) => task.status !== "done")
                  .map((task) => (
                    <label
                      key={task.id}
                      className="dependency-option"
                    >
                      <input
                        type="checkbox"
                        checked={dependencyIds.includes(task.id)}
                        onChange={() =>
                          toggleDependency(task.id)
                        }
                      />

                      {task.title}
                    </label>
                  ))}
              </div>

              <div className="new-task-row">
                <button
                  className="btn-primary"
                  type="submit"
                >
                  Add
                </button>

                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="btn-ghost"
              onClick={() => setShowForm(true)}
            >
              + Add task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
