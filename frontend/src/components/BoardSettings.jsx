import { useEffect, useState } from "react";
import { api } from "../api";

function MembersTab({ boardId, members, onRefresh }) {
  const [email, setEmail] = useState("");
  const [invitations, setInvitations] = useState([]);
  const [error, setError] = useState("");

  async function loadInvitations() {
    try {
      const data = await api.boardInvitations(boardId);
      setInvitations(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadInvitations();
  }, [boardId]);

  async function invite(e) {
    e.preventDefault();

    if (!email.trim()) return;

    try {
      setError("");

      await api.inviteMember(boardId, email.trim());

      setEmail("");
      await loadInvitations();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMember(userId) {
    if (
      !window.confirm(
        "Remove this person from the board?"
      )
    ) {
      return;
    }

    try {
      await api.removeBoardMember(boardId, userId);
      await onRefresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelInvitation(id) {
    try {
      await api.cancelInvitation(boardId, id);
      await loadInvitations();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="settings-section">
      <h3>Members</h3>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="settings-list">
        {members.map((member) => (
          <div
            key={member.id}
            className="settings-list-item"
          >
            <div>
              <strong>
                {member.display_name}
              </strong>

              <small>
                {member.email}
              </small>
            </div>

            <span>
              {member.role}
            </span>

            {member.role !== "owner" && (
              <button
                className="btn-danger"
                type="button"
                onClick={() =>
                  removeMember(member.id)
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <hr />

      <h3>Invite someone</h3>

      <form
        onSubmit={invite}
        className="settings-form"
      >
        <input
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
        />

        <button
          className="btn-primary"
          type="submit"
        >
          Send invitation
        </button>
      </form>

      {invitations.length > 0 && (
        <>
          <h3>Pending invitations</h3>

          <div className="settings-list">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="settings-list-item"
              >
                <span>
                  {invitation.email}
                </span>

                <span>Pending</span>

                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() =>
                    cancelInvitation(
                      invitation.id
                    )
                  }
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

function TeamsTab({ boardId, members }) {
  const [teams, setTeams] = useState([]);
  const [teamMembers, setTeamMembers] = useState({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function loadTeams() {
    try {
      setError("");

      const data = await api.teams(boardId);

      setTeams(data);

      const memberData = {};

      for (const team of data) {
        memberData[team.id] =
          await api.teamMembers(team.id);
      }

      setTeamMembers(memberData);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadTeams();
  }, [boardId]);

  async function createTeam(e) {
    e.preventDefault();

    if (!name.trim()) return;

    try {
      await api.createTeam(
        boardId,
        name.trim(),
        description.trim()
      );

      setName("");
      setDescription("");

      await loadTeams();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addMember(teamId, userId) {
    if (!userId) return;

    try {
      await api.addTeamMember(teamId, userId);
      await loadTeams();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMember(teamId, userId) {
    try {
      await api.removeTeamMember(
        teamId,
        userId
      );

      await loadTeams();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTeam(team) {
    if (
      !window.confirm(
        `Delete "${team.name}"?\n\nAll team membership will be removed.`
      )
    ) {
      return;
    }

    try {
      await api.deleteTeam(team.id);
      await loadTeams();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="settings-section">
      <h3>Teams</h3>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {teams.length === 0 ? (
        <p>No teams have been created yet.</p>
      ) : (
        <div className="team-list">
          {teams.map((team) => {
            const currentMembers =
              teamMembers[team.id] || [];

            return (
              <div
                key={team.id}
                className="team-card"
              >
                <div className="team-card-header">
                  <div>
                    <h4>{team.name}</h4>

                    {team.description && (
                      <p>{team.description}</p>
                    )}
                  </div>

                  <button
                    className="btn-danger"
                    type="button"
                    onClick={() =>
                      deleteTeam(team)
                    }
                  >
                    Delete
                  </button>
                </div>

                <h5>Members</h5>

                {currentMembers.map((member) => (
                  <div
                    key={member.id}
                    className="team-member"
                  >
                    <span>
                      {member.display_name}
                    </span>

                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() =>
                        removeMember(
                          team.id,
                          member.id
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <select
                  defaultValue=""
                  onChange={(e) => {
                    addMember(
                      team.id,
                      e.target.value
                    );
                    e.target.value = "";
                  }}
                >
                  <option value="">
                    Add board member...
                  </option>

                  {members
                    .filter(
                      (member) =>
                        !currentMembers.some(
                          (m) =>
                            m.id === member.id
                        )
                    )
                    .map((member) => (
                      <option
                        key={member.id}
                        value={member.id}
                      >
                        {member.display_name}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <hr />

      <h3>Create team</h3>

      <form
        onSubmit={createTeam}
        className="settings-form"
      >
        <input
          type="text"
          placeholder="Team name"
          value={name}
          onChange={(e) =>
            setName(e.target.value)
          }
        />

        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) =>
            setDescription(e.target.value)
          }
          rows={3}
        />

        <button
          className="btn-primary"
          type="submit"
        >
          + Create team
        </button>
      </form>
    </div>
  );
}

function SprintsTab({ boardId }) {
  const [sprints, setSprints] = useState([]);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState("");

  async function loadSprints() {
    try {
      setError("");
      const data = await api.sprints(boardId);
      setSprints(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadSprints();
  }, [boardId]);

  async function createSprint(e) {
    e.preventDefault();

    if (!name.trim()) return;

    if (!startsAt || !endsAt) {
      setError(
        "Start and end dates are required."
      );
      return;
    }

    if (endsAt < startsAt) {
      setError(
        "The end date cannot be before the start date."
      );
      return;
    }

    try {
      await api.createSprint(
        boardId,
        name.trim(),
        startsAt,
        endsAt
      );

      setName("");
      setStartsAt("");
      setEndsAt("");

      await loadSprints();
    } catch (err) {
      setError(err.message);
    }
  }

  async function setActive(sprint) {
    try {
      await api.updateSprint(sprint.id, {
        isActive: true,
      });

      await loadSprints();
    } catch (err) {
      setError(err.message);
    }
  }

  async function finishSprint(sprint) {
    if (
      !window.confirm(
        `Finish "${sprint.name}"?`
      )
    ) {
      return;
    }

    try {
      await api.updateSprint(sprint.id, {
        isActive: false,
      });

      await loadSprints();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteSprint(sprint) {
    if (
      !window.confirm(
        `Delete "${sprint.name}"?\n\nTasks assigned to this sprint will remain, but will no longer belong to this sprint.`
      )
    ) {
      return;
    }

    try {
      await api.deleteSprint(sprint.id);
      await loadSprints();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="settings-section">
      <h3>Sprints</h3>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {sprints.length === 0 ? (
        <p>No sprints have been created yet.</p>
      ) : (
        <div className="sprint-list">
          {sprints.map((sprint) => (
            <div
              key={sprint.id}
              className="sprint-card"
            >
              <div>
                <h4>{sprint.name}</h4>

                <p>
                  {sprint.starts_at || "No start date"}
                  {" → "}
                  {sprint.ends_at || "No end date"}
                </p>

                <strong>
                  {sprint.is_active
                    ? "Active"
                    : "Inactive"}
                </strong>
              </div>

              <div className="sprint-actions">
                {!sprint.is_active && (
                  <button
                    className="btn-primary"
                    type="button"
                    onClick={() =>
                      setActive(sprint)
                    }
                  >
                    Start
                  </button>
                )}

                {sprint.is_active && (
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() =>
                      finishSprint(sprint)
                    }
                  >
                    Finish
                  </button>
                )}

                <button
                  className="btn-danger"
                  type="button"
                  onClick={() =>
                    deleteSprint(sprint)
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <hr />

      <h3>Create sprint</h3>

      <form
        onSubmit={createSprint}
        className="settings-form"
      >
        <input
          type="text"
          placeholder="Sprint name"
          value={name}
          onChange={(e) =>
            setName(e.target.value)
          }
        />

        <label>
          Start date
        </label>

        <input
          type="date"
          value={startsAt}
          onChange={(e) =>
            setStartsAt(e.target.value)
          }
        />

        <label>
          End date
        </label>

        <input
          type="date"
          value={endsAt}
          onChange={(e) =>
            setEndsAt(e.target.value)
          }
        />

        <button
          className="btn-primary"
          type="submit"
        >
          + Create sprint
        </button>
      </form>
    </div>
  );
}

export default function BoardSettings({
  boardId,
  open,
  onClose,
  onBoardRefresh,
}) {
  const [tab, setTab] = useState("members");
  const [members, setMembers] = useState([]);

  async function loadMembers() {
    const data =
      await api.boardMembers(boardId);

    setMembers(data);
  }

  useEffect(() => {
    if (open) {
      loadMembers();
    }
  }, [open, boardId]);

  if (!open) return null;

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Board Settings</h2>

          <button
            className="btn-ghost"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={
              tab === "members"
                ? "settings-tab active"
                : "settings-tab"
            }
            onClick={() => setTab("members")}
          >
            Members
          </button>

          <button
            className={
              tab === "teams"
                ? "settings-tab active"
                : "settings-tab"
            }
            onClick={() => setTab("teams")}
          >
            Teams
          </button>

          <button
            className={
              tab === "sprints"
                ? "settings-tab active"
                : "settings-tab"
            }
            onClick={() => setTab("sprints")}
          >
            Sprints
          </button>
        </div>

        {tab === "members" && (
          <MembersTab
            boardId={boardId}
            members={members}
            onRefresh={loadMembers}
          />
        )}

        {tab === "teams" && (
          <TeamsTab
            boardId={boardId}
            members={members}
          />
        )}

        {tab === "sprints" && (
          <SprintsTab
            boardId={boardId}
          />
        )}
      </div>
    </div>
  );
}