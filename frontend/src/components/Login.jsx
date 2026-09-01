import { useState } from "react";
import { api, setToken } from "../api";

export default function Login({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, displayName);
      setToken(result.token);
      onAuthed();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Questboard</h1>
        <p className="auth-sub">
          {mode === "login" ? "Log back in to keep your streak alive." : "Create an account to start earning XP."}
        </p>
        <form onSubmit={submit}>
          {mode === "register" && (
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "..." : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
        </button>
      </div>
    </div>
  );
}
