import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import TaskCard from "./TaskCard.jsx";

export default function Column({ status, title, tasks, onCreateTask }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [showForm, setShowForm] = useState(false);
  const [title_, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [points, setPoints] = useState(2);

  function submit(e) {
    e.preventDefault();
    if (!title_.trim()) return;
    onCreateTask({ title: title_.trim(), priority, storyPoints: Number(points) });
    setTitle("");
    setPriority("normal");
    setPoints(2);
    setShowForm(false);
  }

  return (
    <div className="column">
      <div className="column-header">
        <span className="column-title">{title}</span>
        <span className="column-count">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={"column-body" + (isOver ? " drag-over" : "")}>
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} />
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
              <div className="new-task-row">
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
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
              <div className="new-task-row">
                <button className="btn-primary" type="submit">
                  Add
                </button>
                <button className="btn-ghost" type="button" onClick={() => setShowForm(false)}>
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
