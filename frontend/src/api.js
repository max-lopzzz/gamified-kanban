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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  register: (email, password, displayName) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ email, password, displayName }) }),
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request("/users/me"),
  leaderboard: () => request("/users/leaderboard"),
  boards: () => request("/boards"),
  createBoard: (name) => request("/boards", { method: "POST", body: JSON.stringify({ name }) }),
  board: (id) => request(`/boards/${id}`),
  createTask: (payload) => request("/tasks", { method: "POST", body: JSON.stringify(payload) }),
  moveTask: (id, status, position) =>
    request(`/tasks/${id}/move`, { method: "PATCH", body: JSON.stringify({ status, position }) }),
  updateTask: (id, payload) => request(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: "DELETE" }),
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
