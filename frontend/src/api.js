const BASE = import.meta.env.VITE_API_URL || "/api";

function getToken() {
  return localStorage.getItem("qb_token");
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    // Expired/invalid token: drop it and bounce to the login screen, rather
    // than leaving the app stuck with a null user and no way to sign out.
    // Auth endpoints (login/register) are exempt: a bad-credentials 401 there
    // must fall through so the form can show its own error instead of reloading.
    try {
      localStorage.removeItem("qb_token");
    } catch {}
    if (typeof window !== "undefined") window.location.assign("/");
    throw new Error("Session expired");
  }

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    const text = await res.text();
    if (!res.ok) throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
    return text;
  }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (email, password, displayName) =>
    request("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        displayName,
      }),
    }),

  login: (email, password) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
      }),
    }),

  me: () => request("/users/me"),

  leaderboard: (boardId) =>
    request(
      "/users/leaderboard" +
        (boardId ? `?boardId=${encodeURIComponent(boardId)}` : "")
    ),

  boards: () =>
    request("/boards"),

  createBoard: (name) =>
    request("/boards", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  board: (id) =>
    request(`/boards/${id}`),

  deleteBoard: (id) =>
    request(`/boards/${id}`, {
      method: "DELETE",
    }),

  createTask: (payload) =>
    request("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  moveTask: (id, status, position) =>
    request(`/tasks/${id}/move`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        position,
      }),
    }),

  updateTask: (id, payload) =>
    request(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteTask: (id) =>
    request(`/tasks/${id}`, {
      method: "DELETE",
    }),

  // Board members
  boardMembers: (boardId) =>
    request(`/boards/${boardId}/members`),

  removeBoardMember: (boardId, userId) =>
    request(
      `/boards/${boardId}/members/${userId}`,
      {
        method: "DELETE",
      }
    ),

  // Invitations
  inviteMember: (boardId, email) =>
    request(`/boards/${boardId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  boardInvitations: (boardId) =>
    request(`/boards/${boardId}/invitations`),

  cancelInvitation: (boardId, invitationId) =>
    request(
      `/boards/${boardId}/invitations/${invitationId}`,
      {
        method: "DELETE",
      }
    ),

  acceptInvitation: (token) =>
    request(`/boards/invitations/${token}/accept`, {
      method: "POST",
    }),

  // Teams
  teams: (boardId) =>
    request(`/teams/board/${boardId}`),

  createTeam: (boardId, name, description = "") =>
    request("/teams", {
      method: "POST",
      body: JSON.stringify({
        boardId,
        name,
        description,
      }),
    }),

  teamMembers: (teamId) =>
    request(`/teams/${teamId}/members`),

  addTeamMember: (teamId, userId) =>
    request(`/teams/${teamId}/members`, {
      method: "POST",
      body: JSON.stringify({
        userId,
      }),
    }),

  removeTeamMember: (teamId, userId) =>
    request(
      `/teams/${teamId}/members/${userId}`,
      {
        method: "DELETE",
      }
    ),

  deleteTeam: (teamId) =>
    request(`/teams/${teamId}`, {
      method: "DELETE",
    }),

  // Sprints
  sprints: (boardId) =>
    request(`/sprints/board/${boardId}`),

  createSprint: (boardId, name, startsAt, endsAt, goal = "") =>
    request("/sprints", {
      method: "POST",
      body: JSON.stringify({
        boardId,
        name,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        goal,
        isActive: false,
      }),
    }),

  updateSprint: (sprintId, payload) =>
    request(`/sprints/${sprintId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  deleteSprint: (sprintId) =>
    request(`/sprints/${sprintId}`, {
      method: "DELETE",
    }),
};

export function setToken(token) {
  localStorage.setItem("qb_token", token);
}
export function clearToken() {
  localStorage.removeItem("qb_token");
}
export function hasToken() {
  return !!getToken();
}
