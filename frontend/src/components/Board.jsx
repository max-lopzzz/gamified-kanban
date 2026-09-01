import { useEffect, useState } from "react";
import { DndContext } from "@dnd-kit/core";
import Column from "./Column.jsx";
import { api } from "../api";

const COLUMNS = [
  { status: "backlog", title: "Backlog" },
  { status: "todo", title: "To Do" },
  { status: "in_progress", title: "In Progress" },
  { status: "done", title: "Done" },
];

export default function Board({
  boardId,
  currentUserId,
  onGamificationEvent,
  onBoardDeleted,
}) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showManagement, setShowManagement] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteResult, setInviteResult] = useState("");

  const [teamName, setTeamName] = useState("");
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [teamMemberId, setTeamMemberId] = useState("");
  const [teamMembers, setTeamMembers] = useState({});

  const [sprintName, setSprintName] = useState("");
  const [sprintStart, setSprintStart] = useState("");
  const [sprintEnd, setSprintEnd] = useState("");
  const [sprintActive, setSprintActive] = useState(false);

  async function refresh() {
    try {
      setError("");

      const data = await api.board(boardId);

      setBoard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [boardId]);

  /*
   * Create task
   *
   * IMPORTANT:
   * Do NOT force assigneeId to currentUserId here.
   * The task form decides whether the task is assigned to
   * a person, a team, or nobody.
   */
  async function handleCreateTask(payload) {
    await api.createTask({
      boardId,
      ...payload,
    });

    await refresh();
  }

  async function handleUpdateTask(taskId, payload) {
    await api.updateTask(taskId, payload);
    await refresh();
  }

  async function handleDeleteTask(task) {
    const confirmed = window.confirm(
      `Delete "${task.title}"?\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await api.deleteTask(task.id);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteBoard() {
    const confirmation = window.prompt(
      `WARNING: This will permanently delete "${board.name}" and all of its tasks.\n\nType the board name to confirm deletion:`
    );

    if (confirmation !== board.name) {
      if (confirmation !== null) {
        window.alert(
          "Board name did not match. The board was not deleted."
        );
      }

      return;
    }

    try {
      await api.deleteBoard(board.id);
      onBoardDeleted(board.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();

    if (!inviteEmail.trim()) return;

    try {
      const result = await api.inviteToBoard(
        board.id,
        inviteEmail.trim()
      );

      setInviteResult(
        `Invitation created for ${result.email}. Share this token with them:\n${result.token}`
      );

      setInviteEmail("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateTeam(e) {
    e.preventDefault();

    if (!teamName.trim()) return;

    try {
      await api.createTeam(board.id, teamName.trim());

      setTeamName("");

      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadTeamMembers(teamId) {
    try {
      const members = await api.teamMembers(teamId);

      setTeamMembers((current) => ({
        ...current,
        [teamId]: members,
      }));

      setExpandedTeam(teamId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddTeamMember(teamId) {
    if (!teamMemberId) return;

    try {
      await api.addTeamMember(teamId, teamMemberId);

      setTeamMemberId("");

      await loadTeamMembers(teamId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveTeamMember(teamId, userId) {
    try {
      await api.removeTeamMember(teamId, userId);

      await loadTeamMembers(teamId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteTeam(team) {
    const confirmed = window.confirm(
      `Delete team "${team.name}"?\n\nThis will remove the team, but will not delete the people in it.`
    );

    if (!confirmed) return;

    try {
      await api.deleteTeam(team.id);

      if (expandedTeam === team.id) {
        setExpandedTeam(null);
      }

      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateSprint(e) {
    e.preventDefault();

    if (!sprintName.trim()) return;

    try {
      await api.createSprint({
        boardId: board.id,
        name: sprintName.trim(),
        startsAt: sprintStart
          ? new Date(sprintStart).toISOString()
          : null,
        endsAt: sprintEnd
          ? new Date(sprintEnd).toISOString()
          : null,
        isActive: sprintActive,
      });

      setSprintName("");
      setSprintStart("");
      setSprintEnd("");
      setSprintActive(false);

      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDragEnd(event) {
    const { active, over } = event;

    if (!over) return;

    const taskId = active.id;
    const newStatus = over.id;

    const task = board.tasks.find((t) => t.id === taskId);

    if (!task || task.status === newStatus) return;

    setBoard((b) => ({
      ...b,
      tasks: b.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus }
          : t
      ),
    }));

    try {
      const result = await api.moveTask(
        taskId,
        newStatus,
        0
      );

      if (result.gamification) {
        onGamificationEvent(result.gamification);
      }

      await refresh();
    } catch (err) {
      setError(err.message);
      await refresh();
    }
  }

  if (loading || !board) {
    return (
      <div className="board-page">
        Loading board...
      </div>
    );
  }

  const isOwner = board.owner_id === currentUserId;

  return (
    <div className="board-page">
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="board-header">
        <div>
          <h2 className="board-title">
            {board.name}
          </h2>

          <div className="board-subtitle">
            {board.members?.length || 0} members ·{" "}
            {board.teams?.length || 0} teams ·{" "}
            {board.sprints?.length || 0} sprints
          </div>
        </div>

        <div className="board-header-actions">
          <button
            className="btn-ghost"
            type="button"
            onClick={() =>
              setShowManagement((current) => !current)
            }
          >
            {showManagement
              ? "Hide board settings"
              : "Board settings"}
          </button>

          {isOwner && (
            <button
              className="btn-danger"
              type="button"
              onClick={handleDeleteBoard}
            >
              Delete board
            </button>
          )}
        </div>
      </div>

      {showManagement && (
        <div className="board-management">
          {/* INVITATIONS */}

          <section className="management-section">
            <h3>Invite people</h3>

            <p>
              Invite an existing user by email. The generated
              invitation token can be shared with them.
            </p>

            <form
              onSubmit={handleInvite}
              className="management-form"
            >
              <input
                type="email"
                placeholder="person@example.com"
                value={inviteEmail}
                onChange={(e) =>
                  setInviteEmail(e.target.value)
                }
              />

              <button
                className="btn-primary"
                type="submit"
                disabled={!isOwner}
              >
                Invite
              </button>
            </form>

            {inviteResult && (
              <div className="management-result">
                {inviteResult}
              </div>
            )}
          </section>

          {/* MEMBERS */}

          <section className="management-section">
            <h3>Board members</h3>

            <div className="member-list">
              {(board.members || []).map((member) => (
                <div
                  className="member-row"
                  key={member.id}
                >
                  <div>
                    <strong>
                      {member.display_name}
                    </strong>

                    <span>
                      {member.email}
                    </span>
                  </div>

                  <span className="member-role">
                    {member.role}
                  </span>
                </div>
              ))}

              {board.members?.length === 0 && (
                <p>No members yet.</p>
              )}
            </div>
          </section>

          {/* TEAMS */}

          <section className="management-section">
            <h3>Teams</h3>

            <form
              onSubmit={handleCreateTeam}
              className="management-form"
            >
              <input
                type="text"
                placeholder="Team name"
                value={teamName}
                onChange={(e) =>
                  setTeamName(e.target.value)
                }
              />

              <button
                className="btn-primary"
                type="submit"
              >
                + Create team
              </button>
            </form>

            <div className="team-list">
              {(board.teams || []).map((team) => (
                <div
                  className="team-card"
                  key={team.id}
                >
                  <div className="team-header">
                    <div>
                      <strong>{team.name}</strong>

                      <span>
                        {team.member_count || 0} members
                      </span>
                    </div>

                    <div>
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() =>
                          expandedTeam === team.id
                            ? setExpandedTeam(null)
                            : loadTeamMembers(team.id)
                        }
                      >
                        {expandedTeam === team.id
                          ? "Hide members"
                          : "Manage members"}
                      </button>

                      <button
                        className="btn-danger"
                        type="button"
                        onClick={() =>
                          handleDeleteTeam(team)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {expandedTeam === team.id && (
                    <div className="team-members">
                      <div className="management-form">
                        <select
                          value={teamMemberId}
                          onChange={(e) =>
                            setTeamMemberId(e.target.value)
                          }
                        >
                          <option value="">
                            Select a board member
                          </option>

                          {(board.members || []).map(
                            (member) => (
                              <option
                                key={member.id}
                                value={member.id}
                              >
                                {member.display_name}
                              </option>
                            )
                          )}
                        </select>

                        <button
                          className="btn-primary"
                          type="button"
                          onClick={() =>
                            handleAddTeamMember(team.id)
                          }
                        >
                          Add
                        </button>
                      </div>

                      {(teamMembers[team.id] || []).map(
                        (member) => (
                          <div
                            className="member-row"
                            key={member.id}
                          >
                            <span>
                              {member.display_name}
                            </span>

                            <button
                              className="btn-danger"
                              type="button"
                              onClick={() =>
                                handleRemoveTeamMember(
                                  team.id,
                                  member.id
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}

              {board.teams?.length === 0 && (
                <p>
                  No teams yet. Create one above.
                </p>
              )}
            </div>
          </section>

          {/* SPRINTS */}

          <section className="management-section">
            <h3>Sprints</h3>

            <form
              onSubmit={handleCreateSprint}
              className="management-form"
            >
              <input
                type="text"
                placeholder="Sprint name"
                value={sprintName}
                onChange={(e) =>
                  setSprintName(e.target.value)
                }
              />

              <label>
                Start
                <input
                  type="datetime-local"
                  value={sprintStart}
                  onChange={(e) =>
                    setSprintStart(e.target.value)
                  }
                />
              </label>

              <label>
                End
                <input
                  type="datetime-local"
                  value={sprintEnd}
                  onChange={(e) =>
                    setSprintEnd(e.target.value)
                  }
                />
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={sprintActive}
                  onChange={(e) =>
                    setSprintActive(e.target.checked)
                  }
                />

                Make active
              </label>

              <button
                className="btn-primary"
                type="submit"
              >
                + Create sprint
              </button>
            </form>

            <div className="sprint-list">
              {(board.sprints || []).map((sprint) => (
                <div
                  className="sprint-card"
                  key={sprint.id}
                >
                  <div>
                    <strong>{sprint.name}</strong>

                    <span>
                      {sprint.starts_at || "No start date"}
                      {" → "}
                      {sprint.ends_at || "No end date"}
                    </span>
                  </div>

                  {sprint.is_active ? (
                    <span className="sprint-active">
                      ACTIVE
                    </span>
                  ) : (
                    <span>Inactive</span>
                  )}
                </div>
              ))}

              {board.sprints?.length === 0 && (
                <p>
                  No sprints yet. Create one above.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      <DndContext onDragEnd={handleDragEnd}>
        <div className="columns">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              title={col.title}
              tasks={board.tasks.filter(
                (t) => t.status === col.status
              )}
              allTasks={board.tasks}
              board={board}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}