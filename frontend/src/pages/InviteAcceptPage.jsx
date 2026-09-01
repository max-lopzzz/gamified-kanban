import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, hasToken } from "../api";
import Login from "../components/Login.jsx";

export default function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(hasToken());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!authed) {
    return (
      <div className="board-page">
        <p>Log in or register to accept this invitation.</p>
        <Login onAuthed={() => setAuthed(true)} />
      </div>
    );
  }

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await api.acceptInvitation(token);
      navigate(`/board/${res.boardId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="board-page invite-accept">
      <h2>You've been invited to a board</h2>
      {error && <div className="error-message">{error}</div>}
      <button
        className="btn-primary"
        type="button"
        onClick={accept}
        disabled={busy}
      >
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
    </div>
  );
}
