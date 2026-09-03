const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

export const board = {
  id: "board_1",
  name: "Questboard",
  members: [
    { id: "u_max", email: "max@x.com", display_name: "Max", role: "owner" },
    { id: "u_mor", email: "mor@x.com", display_name: "Moralilst", role: "member" },
  ],
  teams: [{ id: "t_core", name: "Core", member_ids: ["u_max", "u_mor"] }],
  sprints: [
    { id: "s_1", name: "Sprint 1", starts_at: "2026-09-01", ends_at: "2026-09-14", is_active: 1 },
  ],
  tasks: [
    { id: "k1", title: "Wire up auth", status: "in-progress", priority: "high", story_points: 5,
      completed_at: null, sprint_id: "s_1", assignees: [{ type: "user", id: "u_max", name: "Max" }],
      dependencies: [], subtasks: [] },
    { id: "k2", title: "Design schema", status: "done", priority: "normal", story_points: 3,
      completed_at: iso(2 * 3600 * 1000), sprint_id: "s_1", assignees: [{ type: "user", id: "u_mor", name: "Moralilst" }],
      dependencies: [], subtasks: [] },
    { id: "k3", title: "Ship it", status: "todo", priority: "urgent", story_points: 8,
      completed_at: null, sprint_id: "s_1", assignees: [],
      dependencies: [{ id: "k1", title: "Wire up auth" }], subtasks: [] },
    { id: "k4", title: "Old done thing", status: "done", priority: "low", story_points: 1,
      completed_at: iso(72 * 3600 * 1000), sprint_id: null, assignees: [], dependencies: [], subtasks: [] },
  ],
};
