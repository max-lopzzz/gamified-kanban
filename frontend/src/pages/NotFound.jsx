import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="board-page">
      <h2>Not found</h2>
      <p>
        That page doesn’t exist. <Link to="/">Back to your boards</Link>
      </p>
    </div>
  );
}
