/*
 * XP required to *reach* a given level (cumulative, from level 1 = 0 XP).
 * Steep on purpose — a single large task should not vault you past level ~4.
 *   L2 ≈ 100,  L3 ≈ 566,  L5 ≈ 3200,  L10 ≈ 24k,  L20 ≈ 157k
 */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 2.5));
}

export function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}
