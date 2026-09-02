import { useEffect, useRef, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import Board from "../components/Board.jsx";
import SprintBar from "../components/SprintBar.jsx";
import BoardFilters, { EMPTY_FILTERS } from "../components/BoardFilters.jsx";

export default function BoardPage() {
  const { boardId } = useParams();
  const { onGamificationEvent, user } = useOutletContext();

  const [board, setBoard] = useState(null);
  const [sprintFilter, setSprintFilter] = useState("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const autoSelected = useRef(false);

  useEffect(() => {
    setBoard(null);
    setSprintFilter("all");
    setFilters(EMPTY_FILTERS);
    autoSelected.current = false;
  }, [boardId]);

  function handleBoardLoaded(loaded) {
    setBoard(loaded);
    if (!autoSelected.current) {
      autoSelected.current = true;
      const active = (loaded.sprints || []).find((s) => s.is_active);
      if (active) setSprintFilter(active.id);
    }
  }

  if (!boardId) return null;

  return (
    <>
      {board && (
        <div className="board-page" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <SprintBar
            board={board}
            value={sprintFilter}
            onChange={setSprintFilter}
          />
          <BoardFilters board={board} value={filters} onChange={setFilters} />
        </div>
      )}
      <Board
        key={boardId}
        boardId={boardId}
        currentUserId={user?.id}
        onGamificationEvent={onGamificationEvent}
        sprintFilter={sprintFilter}
        filters={filters}
        onBoardLoaded={handleBoardLoaded}
      />
    </>
  );
}
