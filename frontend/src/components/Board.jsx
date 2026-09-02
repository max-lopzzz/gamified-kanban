import { useEffect, useState } from "react";
import { DndContext } from "@dnd-kit/core";
import Column from "./Column.jsx";
import { api } from "../api";

const COLUMNS = [
  { status: "backlog", title: "Backlog" },
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "done", title: "Done" },
];

export default function Board({
  boardId,
  currentUserId,
  onGamificationEvent,
  sprintFilter = "all",
  onBoardLoaded,
}) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setError("");

      const data = await api.board(boardId);

      setBoard(data);
      onBoardLoaded?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [boardId]);

  /*
   * Create task
   *
   * IMPORTANT:
   * Do NOT force assigneeId to currentUserId here.
   * The task form decides whether the task is assigned to
   * a person, a team, or nobody.
   */
  async function handleCreateTask(payload) {
    try {
      await api.createTask({ boardId, ...payload });
      await refresh();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleUpdateTask(taskId, payload) {
    try {
      await api.updateTask(taskId, payload);
      await refresh();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleDeleteTask(task) {
    const confirmed = window.confirm(
      `Delete "${task.title}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await api.deleteTask(task.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDragEnd(event) {
    const { active, over } = event;

    if (!over) return;

    const taskId = active.id;
    const newStatus = over.id;

    const task = board.tasks.find((t) => t.id === taskId);

    if (!task || task.status === newStatus) return;

    setBoard((b) => ({
      ...b,
      tasks: b.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus }
          : t
      ),
    }));

    try {
      const result = await api.moveTask(
        taskId,
        newStatus,
        0
      );

      if (result.gamification) {
        onGamificationEvent(result.gamification);
      }

      await refresh();
    } catch (err) {
      setError(err.message);
      await refresh();
    }
  }

  if (loading || !board) {
    return (
      <div className="board-page">
        Loading board...
      </div>
    );
  }

  const visibleTasks = (board.tasks || []).filter((t) => {
    if (sprintFilter === "all") return true;
    if (sprintFilter === "backlog") return t.sprint_id == null;
    return t.sprint_id === sprintFilter;
  });

  return (
    <div className="board-page">
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="board-header">
        <div>
          <h2 className="board-title">
            {board.name}
          </h2>

          <div className="board-subtitle">
            {board.members?.length || 0} members ·{" "}
            {board.teams?.length || 0} teams ·{" "}
            {board.sprints?.length || 0} sprints
          </div>
        </div>
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div className="columns">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              title={col.title}
              tasks={visibleTasks.filter(
                (t) => t.status === col.status
              )}
              allTasks={visibleTasks}
              board={board}
              sprintFilter={sprintFilter}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
