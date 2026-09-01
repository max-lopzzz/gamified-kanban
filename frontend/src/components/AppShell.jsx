import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { api, clearToken } from "../api";
import Hud from "./Hud.jsx";
import Leaderboard from "./Leaderboard.jsx";
import { LevelUpToast, AchievementToast } from "./Toasts.jsx";

export default function AppShell({ onSignOut }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const boardId = pathname.match(/^\/board\/([^/]+)/)?.[1] ?? null;

  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  const loadUser = useCallback(async () => {
    setUser(await api.me());
  }, []);

  const loadBoards = useCallback(async () => {
    const list = await api.boards();
    setBoards(list);
    return list;
  }, []);

  useEffect(() => {
    loadUser();
    loadBoards();
  }, [loadUser, loadBoards]);

  useEffect(() => {
    if (!boardId && boards.length > 0) {
      navigate(`/board/${boards[0].id}`, { replace: true });
    }
  }, [boardId, boards, navigate]);

  function handleSignOut() {
    clearToken();
    onSignOut();
    navigate("/");
  }

  async function handleCreateBoard(e) {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    const board = await api.createBoard(newBoardName.trim());
    setNewBoardName("");
    await loadBoards();
    navigate(`/board/${board.id}`);
  }

  function onGamificationEvent(g) {
    loadUser();
    setLeaderboardKey((k) => k + 1);
    if (g.leveledUp) {
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2200);
    }
    if (g.unlockedAchievements?.length) {
      setAchievementQueue((q) => [...q, ...g.unlockedAchievements]);
      g.unlockedAchievements.forEach((ach) => {
        setTimeout(() => {
          setAchievementQueue((q) => q.filter((a) => a.id !== ach.id));
        }, 4000);
      });
    }
  }

  return (
    <>
      <Hud user={user} justLeveledUp={showLevelUp} onSignOut={handleSignOut} />
      {showLevelUp && user && <LevelUpToast level={user.level} />}
      {achievementQueue.map((ach) => (
        <AchievementToast key={ach.id} achievement={ach} />
      ))}

      <div className="board-page" style={{ paddingBottom: 0 }}>
        <div className="board-select-row">
          <select
            value={boardId || ""}
            onChange={(e) => navigate(`/board/${e.target.value}`)}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <form onSubmit={handleCreateBoard} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="New board name"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
            />
            <button className="btn-ghost" type="submit">
              + New board
            </button>
          </form>

          {boardId && (
            <Link className="btn-ghost" to={`/board/${boardId}/settings`}>
              Board settings
            </Link>
          )}

          <button
            id="theme-toggle"
            className="btn-ghost"
            type="button"
            onClick={() => {}}
            title="Toggle theme"
          >
            Theme
          </button>
        </div>
      </div>

      <Outlet
        context={{
          user,
          boards,
          activeBoardId: boardId,
          reloadBoards: loadBoards,
          onGamificationEvent,
        }}
      />

      <div className="board-page" style={{ paddingTop: 0 }}>
        <Leaderboard refreshKey={leaderboardKey} />
      </div>
    </>
  );
}
