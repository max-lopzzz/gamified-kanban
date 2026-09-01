export default function Hud({ user, justLeveledUp, onSignOut }) {
  /*
   * The user can be missing while loading, or because the session expired
   * before /users/me resolved. Returning null used to hide the only Sign out
   * button in the app, leaving an expired session permanently stuck.
   */
  if (!user) {
    return (
      <div className="hud">
        <span className="hud-brand">Questboard</span>
        <div className="hud-user">
          <button className="hud-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const { xp, level, xpForCurrentLevel, xpForNextLevel, currentStreak } = user;
  const span = Math.max(1, xpForNextLevel - xpForCurrentLevel);
  const progress = Math.min(1, Math.max(0, (xp - xpForCurrentLevel) / span));

  return (
    <div className="hud">
      <span className="hud-brand">Questboard</span>
      <span className="hud-level">Lv.{level}</span>
      <div className="hud-xp-track">
        <div
          className={"hud-xp-fill" + (justLeveledUp ? " leveling" : "")}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="hud-xp-label">
        {xp} / {xpForNextLevel} XP
      </span>
      <span className="hud-streak">🔥 {currentStreak}</span>
      <div className="hud-user">
        <span>{user.displayName}</span>
        <button className="hud-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
