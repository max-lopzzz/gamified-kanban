// Shared helpers for the task create + edit forms.

export function assigneeOptions(board) {
  return [
    ...(board?.members || []).map((m) => ({
      value: `user:${m.id}`,
      label: m.display_name,
      group: "person",
    })),
    ...(board?.teams || []).map((t) => ({
      value: `team:${t.id}`,
      label: t.name,
      group: "team",
    })),
  ];
}

export const encodeAssignees = (arr) =>
  (arr || []).map((a) => `${a.type}:${a.id}`);

export function decodeAssignees(values) {
  return values.map((v) => {
    const i = v.indexOf(":");
    return { type: v.slice(0, i), id: v.slice(i + 1) };
  });
}

// Every board task except `selfId`; done tasks are allowed (shown muted).
export function dependencyOptions(tasks, selfId) {
  return (tasks || [])
    .filter((t) => t.id !== selfId)
    .map((t) => ({
      value: t.id,
      label: t.title,
      muted: t.status === "done",
      group: t.status === "done" ? "done" : undefined,
    }));
}
