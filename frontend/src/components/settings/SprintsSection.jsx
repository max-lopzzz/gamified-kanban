import { useEffect, useState } from "react";
import { api } from "../../api";

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
      setError("Start and end dates are required.");
      return;
    }

    if (endsAt < startsAt) {
      setError("The end date cannot be before the start date.");
      return;
    }

    try {
      await api.createSprint(
        boardId,
        name.trim(),
        startsAt,
        endsAt,
        goal.trim()
      );

      setName("");
      setStartsAt("");
      setEndsAt("");
      setGoal("");

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
    if (!window.confirm(`Finish "${sprint.name}"?`)) {
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
    <div>
      {error && <div className="error-message">{error}</div>}

      {sprints.length === 0 ? (
        <p>No sprints have been created yet.</p>
      ) : (
        <div className="sprint-list">
          {sprints.map((sprint) => (
            <div key={sprint.id} className="sprint-card">
              <div>
                <h4>{sprint.name}</h4>

                <p>
                  {sprint.starts_at || "No start date"}
                  {" → "}
                  {sprint.ends_at || "No end date"}
                </p>

                <strong>
                  {sprint.is_active ? "Active" : "Inactive"}
                </strong>
              </div>

              {isOwner && (
                <div className="sprint-actions">
                  {!sprint.is_active && (
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={() => setActive(sprint)}
                    >
                      Start
                    </button>
                  )}

                  {sprint.is_active && (
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => finishSprint(sprint)}
                    >
                      Finish
                    </button>
                  )}

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
          ))}
        </div>
      )}

      {isOwner && (
        <>
      <hr />

      <h3>Create sprint</h3>

      <form onSubmit={createSprint} className="settings-form">
        <input
          type="text"
          placeholder="Sprint name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label>Start date</label>

        <input
          type="date"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />

        <label>End date</label>

        <input
          type="date"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />

        <input
          type="text"
          placeholder="Sprint goal (optional)"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />

        <button className="btn-primary" type="submit">
          + Create sprint
        </button>
      </form>
        </>
      )}
    </div>
  );
}
