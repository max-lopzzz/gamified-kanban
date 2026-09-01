import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import TaskCard from "./TaskCard.jsx";

export default function Column({
  status,
  title,
  tasks,
  allTasks,
  onCreateTask,
  board,
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

  const [assigneeType, setAssigneeType] =
    useState("unassigned");

  const [assigneeId, setAssigneeId] =
    useState("");

  const [teamId, setTeamId] =
    useState("");

  const [sprintId, setSprintId] =
    useState("");

  const [dependencies, setDependencies] =
    useState([]);

  function submit(e) {
    e.preventDefault();

    if (!title_.trim()) return;

    if (assigneeType === "user" && !assigneeId) {
      alert("Please select a person.");
      return;
    }

    if (assigneeType === "team" && !teamId) {
      alert("Please select a team.");
      return;
    }

    onCreateTask({
      title: title_.trim(),
      description,
      priority,
      storyPoints: Number(points),
      assigneeType,
      assigneeId: assigneeType === "user" ? assigneeId : null,
      teamId: assigneeType === "team" ? teamId : null,
      sprintId: sprintId || null,
      dependencies,
    });

    setTitle("");
    setDescription("");
    setPriority("normal");
    setPoints(2);
    setAssigneeType("unassigned");
    setAssigneeId("");
    setTeamId("");
    setSprintId("");
    setDependencies([]);
    setShowForm(false);
  }

  function toggleDependency(id) {
    setDependencies((current) =>
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

              <label>
                Assignee
              </label>

              <select
                value={assigneeType}
                onChange={(e) =>
                  setAssigneeType(e.target.value)
                }
              >
                <option value="unassigned">
                  Up for grabs
                </option>
                <option value="user">
                  Specific person
                </option>
                <option value="team">
                  Specific team
                </option>
              </select>

              {assigneeType === "user" && (
                <select
                  value={assigneeId}
                  onChange={(e) =>
                    setAssigneeId(e.target.value)
                  }
                >
                  <option value="">
                    Select person
                  </option>

                  {(board.members || []).map((member) => (
                    <option
                      key={member.id}
                      value={member.id}
                    >
                      {member.display_name}
                    </option>
                  ))}
                </select>
              )}

              {assigneeType === "team" && (
                <select
                  value={teamId}
                  onChange={(e) =>
                    setTeamId(e.target.value)
                  }
                >
                  <option value="">
                    Select team
                  </option>

                  {(board.teams || []).map((team) => (
                    <option
                      key={team.id}
                      value={team.id}
                    >
                      {team.name}
                    </option>
                  ))}
                </select>
              )}

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
                        checked={dependencies.includes(task.id)}
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
