export async function dispatch(cmdInput, ctx, { byName }) {
  const cmd = byName.get(cmdInput.name);
  if (!cmd) return { ok: false };
  try {
    await cmd.execute(ctx);
    return { ok: true };
  } catch (err) {
    console.error(`[bot] command ${cmdInput.name} failed:`, err);
    return { ok: false };
  }
}
