import { useEffect, useState } from "react";
import { api } from "../../api";

function sprintStatus(sprint) {
  const today = new Date().toISOString().slice(0, 10);
  if (sprint.is_active) return { label: "Active", tone: "active" };
  if (sprint.starts_at && today < sprint.starts_at)
    return { label: "Upcoming", tone: "upcoming" };
  if (sprint.ends_at && today > sprint.ends_at)
    return { label: "Ended", tone: "ended" };
  return { label: "Scheduled", tone: "upcoming" };
}

export default function SprintsSection({ boardId, isOwner = false }) {
  const [sprints, setSprints] = useState([]);
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState("");

  async function loadSprints() {
    try {
      setError("");
      setSprints(await api.sprints(boardId));
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
      setError("Start and end dates are required.");
      return;
    }
    if (endsAt < startsAt) {
      setError("The end date cannot be before the start date.");
      return;
    }

    try {
      await api.createSprint(boardId, name.trim(), startsAt, endsAt, goal.trim());
      setName("");
      setStartsAt("");
      setEndsAt("");
      setGoal("");
      await loadSprints();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteSprint(sprint) {
    if (
      !window.confirm(
        `Delete "${sprint.name}"?\n\nTasks in this sprint stay on the board but lose their sprint.`
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
    <div>
      {error && <div className="error-message">{error}</div>}

      <p className="settings-hint">
        A sprint is <strong>active automatically</strong> while today falls
        within its start and end dates.
      </p>

      {sprints.length === 0 ? (
        <p>No sprints have been created yet.</p>
      ) : (
        <div className="sprint-list">
          {sprints.map((sprint) => {
            const status = sprintStatus(sprint);
            return (
              <div key={sprint.id} className="sprint-card">
                <div>
                  <h4>{sprint.name}</h4>
                  <p>
                    {sprint.starts_at || "No start date"}
                    {" → "}
                    {sprint.ends_at || "No end date"}
                  </p>
                  {sprint.goal && <p className="sprint-goal">{sprint.goal}</p>}
                  <span className={`sprint-status sprint-status-${status.tone}`}>
                    {status.label}
                  </span>
                </div>

                {isOwner && (
                  <div className="sprint-actions">
                    <button
                      className="btn-danger"
                      type="button"
                      onClick={() => deleteSprint(sprint)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isOwner && (
        <>
          <hr />
          <h3>Create sprint</h3>
          <form onSubmit={createSprint} className="settings-form">
            <div>
              <label>Name</label>
              <input
                type="text"
                placeholder="Sprint 4"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label>Start date</label>
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <label>End date</label>
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <div>
              <label>Goal (optional)</label>
              <input
                type="text"
                placeholder="What this sprint is for"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </div>
            <button className="btn-primary" type="submit">
              + Create sprint
            </button>
          </form>
        </>
      )}
    </div>
  );
}
