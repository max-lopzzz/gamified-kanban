import { useEffect, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import TaskCard from "./TaskCard.jsx";
import TokenMultiSelect from "./TokenMultiSelect.jsx";
import ChecklistEditor from "./ChecklistEditor.jsx";
import {
  assigneeOptions,
  encodeAssignees,
  decodeAssignees,
  dependencyOptions,
} from "../lib/task-form.js";

function defaultSprintFor(sprintFilter) {
  return sprintFilter && sprintFilter !== "all" && sprintFilter !== "backlog"
    ? sprintFilter
    : "";
}

let draftCounter = 0;

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
  onTaskMutated,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  const [showForm, setShowForm] = useState(false);
  const [title_, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [points, setPoints] = useState(2);
  const [assignees, setAssignees] = useState([]);
  const [dependencyIds, setDependencyIds] = useState([]);
  const [checklist, setChecklist] = useState([]); // { id, title, done:false }
  const [sprintId, setSprintId] = useState(defaultSprintFor(sprintFilter));

  useEffect(() => {
    setSprintId(defaultSprintFor(sprintFilter));
  }, [sprintFilter]);

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("normal");
    setPoints(2);
    setAssignees([]);
    setDependencyIds([]);
    setChecklist([]);
    setSprintId(defaultSprintFor(sprintFilter));
    setShowForm(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!title_.trim()) return;
    try {
      await onCreateTask({
        title: title_.trim(),
        description,
        priority,
        storyPoints: Number(points),
        assignees: decodeAssignees(assignees),
        sprintId: sprintId || null,
        dependencyIds,
        subtasks: checklist.map((c) => c.title),
      });
    } catch {
      return; // Board shows the error; keep the form open
    }
    reset();
  }

  return (
    <div className="column">
      <div className="column-header">
        <span className="column-title">{title}</span>
        <span className="column-count">{tasks.length}</span>
      </div>

      <div
        ref={setNodeRef}
        className={"column-body" + (isOver ? " drag-over" : "")}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            board={board}
            onUpdate={onUpdateTask}
            onDelete={onDeleteTask}
            onTaskMutated={onTaskMutated}
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
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />

              <textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />

              <div className="new-task-row">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
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
                  onChange={(e) => setPoints(e.target.value)}
                  title="Story points"
                />
              </div>

              <label>Assignees</label>
              <TokenMultiSelect
                options={assigneeOptions(board)}
                value={assignees}
                onChange={setAssignees}
                placeholder="Add people or teams…"
                emptyText="No members or teams yet"
              />

              <label>Sprint</label>
              <select
                value={sprintId}
                onChange={(e) => setSprintId(e.target.value)}
              >
                <option value="">No sprint</option>
                {(board.sprints || []).map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.name}
                  </option>
                ))}
              </select>

              <label>Dependencies</label>
              <TokenMultiSelect
                options={dependencyOptions(board.tasks, null)}
                value={dependencyIds}
                onChange={setDependencyIds}
                placeholder="Blocked by…"
                emptyText="No other tasks yet"
              />

              <label>Checklist</label>
              <ChecklistEditor
                items={checklist}
                onAdd={(t) =>
                  setChecklist((c) => [
                    ...c,
                    { id: `draft_${++draftCounter}`, title: t, done: false },
                  ])
                }
                onToggle={(item) =>
                  setChecklist((c) =>
                    c.map((x) =>
                      x.id === item.id ? { ...x, done: !x.done } : x
                    )
                  )
                }
                onRemove={(item) =>
                  setChecklist((c) => c.filter((x) => x.id !== item.id))
                }
              />

              <div className="new-task-row">
                <button className="btn-primary" type="submit">
                  Add
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={reset}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button className="btn-ghost" onClick={() => setShowForm(true)}>
              + Add task
            </button>
          )}
        </div>
      )}
    </div>
  );
}
