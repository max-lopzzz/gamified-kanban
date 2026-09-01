export function LevelUpToast({ level }) {
  return <div className="levelup-toast">⭐ Level up! You're now level {level}</div>;
}

export function AchievementToast({ achievement }) {
  return (
    <div className="achievement-toast">
      <div className="achievement-toast-label">Achievement unlocked</div>
      <div className="achievement-toast-name">{achievement.name}</div>
      <div className="achievement-toast-desc">{achievement.description}</div>
    </div>
  );
}
