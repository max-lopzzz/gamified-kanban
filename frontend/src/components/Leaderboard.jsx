import { useEffect, useState } from "react";
import { api } from "../api";

export default function Leaderboard({ refreshKey }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    api.leaderboard().then(setRows).catch(() => {});
  }, [refreshKey]);

  if (rows.length === 0) return null;

  return (
    <div className="side-panel">
      <h3 className="side-panel-title">Leaderboard</h3>
      {rows.map((r, i) => (
        <div className="leaderboard-row" key={r.id}>
          <span className="leaderboard-name">
            {i + 1}. {r.display_name} · Lv.{r.level}
          </span>
          <span className="leaderboard-xp">{r.xp} XP</span>
        </div>
      ))}
    </div>
  );
}
