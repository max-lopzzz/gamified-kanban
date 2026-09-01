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

export default function Board({ boardId, currentUserId, onGamificationEvent }) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const data = await api.board(boardId);
    setBoard(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, [boardId]);

  async function handleCreateTask({ title, priority, storyPoints }) {
    await api.createTask({
      boardId,
      title,
      priority,
      storyPoints,
      assigneeId: currentUserId,
    });
    refresh();
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id;
    const newStatus = over.id;
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    // optimistic update
    setBoard((b) => ({
      ...b,
      tasks: b.tasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    }));

    const result = await api.moveTask(taskId, newStatus, 0);
    if (result.gamification) {
      onGamificationEvent(result.gamification);
    }
    refresh();
  }

  if (loading || !board) return <div className="board-page">Loading board...</div>;

  return (
    <div className="board-page">
      <div className="board-header">
        <h2 className="board-title">{board.name}</h2>
      </div>
      <DndContext onDragEnd={handleDragEnd}>
        <div className="columns">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              title={col.title}
              tasks={board.tasks.filter((t) => t.status === col.status)}
              onCreateTask={handleCreateTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
