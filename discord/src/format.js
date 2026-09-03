export const STATUS_ORDER = ["backlog", "todo", "in-progress", "done"];
export const STATUS_LABEL = {
  backlog: "Backlog", todo: "To Do", "in-progress": "In Progress", done: "Done",
};
const FIELD_MAX = 1024;

const assigneeNames = (t) =>
  t.assignees?.length ? t.assignees.map((a) => a.name).join(", ") : "unassigned";
const line = (t) => `• ${t.title} — ${assigneeNames(t)} · ${t.story_points}pt · ${t.priority}`;

function clampLines(lines) {
  const out = [];
  let len = 0, dropped = 0;
  for (const l of lines) {
    if (len + l.length + 1 > FIELD_MAX) { dropped++; continue; }
    out.push(l); len += l.length + 1;
  }
  return { value: out.join("\n") || "—", dropped };
}

export function formatTasks(board, { status, assignee, sprintId } = {}) {
  let tasks = board.tasks;
  if (assignee) tasks = tasks.filter((t) => t.assignees?.some((a) => a.id === assignee || a.name === assignee));
  if (sprintId) tasks = tasks.filter((t) => t.sprint_id === sprintId);

  if (status) {
    const { value, dropped } = clampLines(tasks.filter((t) => t.status === status).map(line));
    return {
      title: board.name,
      fields: [{ name: `Matching “${STATUS_LABEL[status] || status}” (${tasks.filter((t) => t.status === status).length})`, value }],
      ...(dropped ? { footer: { text: `+${dropped} more — narrow with status: or assignee:` } } : {}),
    };
  }

  let totalDropped = 0;
  const fields = STATUS_ORDER.map((s) => {
    const rows = tasks.filter((t) => t.status === s);
    const { value, dropped } = clampLines(rows.map(line));
    totalDropped += dropped;
    return { name: `${STATUS_LABEL[s]} (${rows.length})`, value };
  });
  return {
    title: board.name,
    fields,
    ...(totalDropped ? { footer: { text: `+${totalDropped} more — narrow with status: or assignee:` } } : {}),
  };
}

export function formatMine(boards) {
  const fields = [];
  for (const { board, tasks } of boards) {
    if (!tasks.length) continue;
    const groups = ["backlog", "todo", "in-progress", "done"]
      .map((s) => {
        const rows = tasks.filter((t) => t.status === s);
        return rows.length ? `__${STATUS_LABEL[s]}__\n${rows.map((t) => `• ${t.title} — ${t.assignees?.map((a) => a.name).join(", ") || "unassigned"} · ${t.story_points}pt · ${t.priority}`).join("\n")}` : null;
      })
      .filter(Boolean)
      .join("\n");
    fields.push({ name: board.name, value: groups.slice(0, 1024) });
  }
  return { title: "Your tasks", fields: fields.length ? fields : [{ name: "Your tasks", value: "Nothing assigned to you right now." }] };
}

export function formatStandup(board) {
  const doneIds = new Set(board.tasks.filter((t) => t.status === "done").map((t) => t.id));
  const inProg = board.tasks.filter((t) => t.status === "in-progress");
  const byAssignee = {};
  for (const t of inProg) {
    const key = t.assignees?.length ? t.assignees.map((a) => a.name).join(", ") : "Unassigned";
    (byAssignee[key] ||= []).push(t.title);
  }
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recentDone = board.tasks.filter(
    (t) => t.status === "done" && t.completed_at && Date.parse(t.completed_at) >= dayAgo
  );
  const blocked = board.tasks.filter(
    (t) => t.status !== "done" && (t.dependencies || []).some((d) => !doneIds.has(d.id))
  );

  const parts = [`**Standup — ${board.name}**`, "", "**In Progress**"];
  const names = Object.keys(byAssignee);
  parts.push(names.length ? names.map((n) => `${n}\n${byAssignee[n].map((x) => `  • ${x}`).join("\n")}`).join("\n") : "_nothing in progress_");
  parts.push("", "**Done since yesterday**");
  parts.push(recentDone.length ? recentDone.map((t) => `  • ${t.title}`).join("\n") : "_nothing_");
  parts.push("", "**Blocked**");
  parts.push(blocked.length ? blocked.map((t) => `  • ${t.title}`).join("\n") : "_nothing_");
  return { content: parts.join("\n").slice(0, 1900) };
}

export function formatSprint(board) {
  const sprint = (board.sprints || []).find((s) => s.is_active === 1 || s.is_active === true);
  if (!sprint) {
    return { title: board.name, fields: [{ name: "Sprint", value: "No active sprint." }] };
  }
  const inSprint = board.tasks.filter((t) => t.sprint_id === sprint.id);
  const totalPts = inSprint.reduce((n, t) => n + (t.story_points || 0), 0);
  const donePts = inSprint.filter((t) => t.status === "done").reduce((n, t) => n + (t.story_points || 0), 0);
  const counts = STATUS_ORDER.map((s) => `${STATUS_LABEL[s]}: ${inSprint.filter((t) => t.status === s).length}`).join(" · ");
  const pct = totalPts ? Math.round((donePts / totalPts) * 100) : 0;
  return {
    title: `${board.name} — ${sprint.name}`,
    fields: [
      { name: "Dates", value: `${sprint.starts_at || "?"} → ${sprint.ends_at || "?"}` },
      { name: "Tasks", value: counts },
      { name: "Points", value: `${donePts} / ${totalPts} done (${pct}%)` },
    ],
  };
}
