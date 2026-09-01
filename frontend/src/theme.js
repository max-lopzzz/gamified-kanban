const STORAGE_KEY = "questboard-theme";

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") {
    root.dataset.theme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  } else {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

export function resolveInitial() {
  return getStoredTheme();
}

export function nextTheme(current) {
  if (current === null || current === undefined) return "light";
  if (current === "light") return "dark";
  return null;
}

export function themeLabel(mode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}
