import { useEffect, useState } from "react";
import { api, hasToken, clearToken } from "./api";
import Login from "./components/Login.jsx";
import Hud from "./components/Hud.jsx";
import Board from "./components/Board.jsx";
import Leaderboard from "./components/Leaderboard.jsx";
import { LevelUpToast, AchievementToast } from "./components/Toasts.jsx";

export default function App() {
  const [authed, setAuthed] = useState(hasToken());
  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [activeBoardId, setActiveBoardId] = useState(null);
  const [newBoardName, setNewBoardName] = useState("");
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  async function loadUser() {
    const me = await api.me();
    setUser(me);
  }

  async function loadBoards() {
    const list = await api.boards();
    setBoards(list);
    if (list.length > 0 && !activeBoardId) setActiveBoardId(list[0].id);
  }

  useEffect(() => {
    if (authed) {
      loadUser();
      loadBoards();
    }
  }, [authed]);

  function handleSignOut() {
    clearToken();
    setAuthed(false);
    setUser(null);
    setBoards([]);
    setActiveBoardId(null);
  }

  async function handleCreateBoard(e) {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    const board = await api.createBoard(newBoardName.trim());
    setNewBoardName("");
    await loadBoards();
    setActiveBoardId(board.id);
  }

  function handleGamificationEvent(g) {
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

  function handleBoardDeleted(deletedBoardId) {
    const remaining = boards.filter(
      (board) => board.id !== deletedBoardId
    );

    setBoards(remaining);

    if (remaining.length > 0) {
      setActiveBoardId(remaining[0].id);
    } else {
      setActiveBoardId(null);
    }
  }

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
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
            value={activeBoardId || ""}
            onChange={(e) => setActiveBoardId(e.target.value)}
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
        </div>
      </div>

      {activeBoardId && user && (
        <Board
          boardId={activeBoardId}
          currentUserId={user.id}
          onGamificationEvent={handleGamificationEvent}
          onBoardDeleted={handleBoardDeleted}
        />
      )}

      <div className="board-page" style={{ paddingTop: 0 }}>
        <Leaderboard refreshKey={leaderboardKey} />
      </div>
    </>
  );
}
