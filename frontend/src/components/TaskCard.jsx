import { useDraggable } from "@dnd-kit/core";

const XP_PER_POINT = 10;
const PRIORITY_MULT = { low: 0.75, normal: 1, high: 1.25, urgent: 1.5 };

export default function TaskCard({ task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const xp = Math.round(task.story_points * XP_PER_POINT * (PRIORITY_MULT[task.priority] ?? 1));

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={"task-card" + (isDragging ? " dragging" : "")}
    >
      <div className="task-card-title">{task.title}</div>
      <div className="task-card-meta">
        <span className={`task-priority ${task.priority}`}>{task.priority}</span>
        <span className="task-xp">+{xp} XP</span>
      </div>
    </div>
  );
}
