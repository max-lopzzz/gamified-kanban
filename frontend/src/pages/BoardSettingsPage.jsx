import { useState } from "react";
import {
  useParams,
  useNavigate,
  useOutletContext,
  Link,
} from "react-router-dom";
import { api } from "../api";
import SettingsSection from "../components/settings/SettingsSection.jsx";
import MembersSection from "../components/settings/MembersSection.jsx";
import TeamsSection from "../components/settings/TeamsSection.jsx";
import SprintsSection from "../components/settings/SprintsSection.jsx";

const TABS = [
  { id: "members", label: "Members" },
  { id: "teams", label: "Teams" },
  { id: "sprints", label: "Sprints" },
  { id: "danger", label: "Danger zone" },
];

export default function BoardSettingsPage() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { boards, reloadBoards } = useOutletContext();
  const [tab, setTab] = useState("members");

  const board = (boards || []).find((b) => b.id === boardId);

  async function deleteBoard() {
    const typed = window.prompt(
      `Type the board name to permanently delete it${
        board ? ` ("${board.name}")` : ""
      }:`
    );
    if (!board || typed !== board.name) return;
    await api.deleteBoard(boardId);
    await reloadBoards();
    navigate("/");
  }

  return (
    <div className="board-page settings-page">
      <div className="settings-topbar">
        <Link className="btn-ghost" to={`/board/${boardId}`}>
          ← Back to board
        </Link>
        <h2>{board ? board.name : "Board"} · settings</h2>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"settings-nav-item" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === "members" && (
            <SettingsSection title="Members & invitations">
              <MembersSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "teams" && (
            <SettingsSection title="Teams">
              <TeamsSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "sprints" && (
            <SettingsSection title="Sprints">
              <SprintsSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "danger" && (
            <SettingsSection title="Danger zone">
              <p>Deleting a board removes all of its tasks, teams, and sprints.</p>
              <button className="btn-danger" type="button" onClick={deleteBoard}>
                Delete this board
              </button>
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  );
}
