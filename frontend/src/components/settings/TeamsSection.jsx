import { useEffect, useState } from "react";
import { api } from "../../api";

export default function TeamsSection({ boardId }) {
  const [teams, setTeams] = useState([]);
  const [teamMembers, setTeamMembers] = useState({});
  const [members, setMembers] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  async function loadTeams() {
    try {
      setError("");

      const [data, boardMembers] = await Promise.all([
        api.teams(boardId),
        api.boardMembers(boardId),
      ]);

      setTeams(data);
      setMembers(boardMembers);

      const memberData = {};

      for (const team of data) {
        memberData[team.id] = await api.teamMembers(team.id);
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
      await api.createTeam(boardId, name.trim(), description.trim());

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
      await api.removeTeamMember(teamId, userId);
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
    <div>
      {error && <div className="error-message">{error}</div>}

      {teams.length === 0 ? (
        <p>No teams have been created yet.</p>
      ) : (
        <div className="team-list">
          {teams.map((team) => {
            const currentMembers = teamMembers[team.id] || [];

            return (
              <div key={team.id} className="team-card">
                <div className="team-card-header">
                  <div>
                    <h4>{team.name}</h4>

                    {team.description && <p>{team.description}</p>}
                  </div>

                  <button
                    className="btn-danger"
                    type="button"
                    onClick={() => deleteTeam(team)}
                  >
                    Delete
                  </button>
                </div>

                <h5>Members</h5>

                {currentMembers.map((member) => (
                  <div key={member.id} className="team-member">
                    <span>{member.display_name}</span>

                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => removeMember(team.id, member.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <select
                  defaultValue=""
                  onChange={(e) => {
                    addMember(team.id, e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Add board member...</option>

                  {members
                    .filter(
                      (member) =>
                        !currentMembers.some((m) => m.id === member.id)
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
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

      <form onSubmit={createTeam} className="settings-form">
        <input
          type="text"
          placeholder="Team name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <button className="btn-primary" type="submit">
          + Create team
        </button>
      </form>
    </div>
  );
}
