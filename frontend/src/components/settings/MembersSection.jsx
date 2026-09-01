import { useEffect, useState } from "react";
import { api } from "../../api";

export default function MembersSection({ boardId }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setError("");
      setMembers(await api.boardMembers(boardId));
      setInvitations(await api.boardInvitations(boardId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [boardId]);

  async function invite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      setError("");
      const res = await api.inviteMember(boardId, email.trim());
      setInviteUrl(`${window.location.origin}/invite/${res.token}`);
      setEmail("");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMember(userId) {
    if (!window.confirm("Remove this person from the board?")) return;
    try {
      await api.removeBoardMember(boardId, userId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelInvitation(id) {
    try {
      await api.cancelInvitation(boardId, id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-message">{error}</div>}

      <div className="settings-list">
        {members.map((m) => (
          <div key={m.id} className="settings-list-item">
            <div>
              <strong>{m.display_name}</strong>
              <small>{m.email}</small>
            </div>
            <span className="member-role">{m.role}</span>
            {m.role !== "owner" && (
              <button
                className="btn-danger"
                type="button"
                onClick={() => removeMember(m.id)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={invite} className="settings-form">
        <input
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-primary" type="submit">
          Create invitation
        </button>
      </form>

      {inviteUrl && (
        <div className="invite-url-row">
          <input type="text" readOnly value={inviteUrl} />
          <button
            className="btn-ghost"
            type="button"
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
          >
            Copy link
          </button>
        </div>
      )}

      {invitations.length > 0 && (
        <>
          <h4>Pending invitations</h4>
          <div className="settings-list">
            {invitations.map((inv) => (
              <div key={inv.id} className="settings-list-item">
                <span>{inv.email}</span>
                <span>pending</span>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => cancelInvitation(inv.id)}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
