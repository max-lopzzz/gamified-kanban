import { useEffect, useRef, useState } from "react";
import { api } from "../../api";

export default function DiscordIntegration() {
  const [linked, setLinked] = useState(null); // null = loading
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  async function refresh() {
    try {
      const { linked } = await api.discordStatus();
      setLinked(linked);
      if (linked) { setCode(null); setExpiresAt(null); }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  // countdown ticker
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // poll status while a code is live
  useEffect(() => {
    if (!code) return;
    pollRef.current = setInterval(refresh, 5000);
    return () => clearInterval(pollRef.current);
  }, [code]);

  // expire the code locally
  useEffect(() => {
    if (expiresAt && now >= Date.parse(expiresAt)) { setCode(null); setExpiresAt(null); }
  }, [now, expiresAt]);

  async function connect() {
    setError("");
    try {
      const res = await api.discordLinkCode();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) { setError(e.message); }
  }

  async function disconnect() {
    setError("");
    try { await api.discordUnlink(); await refresh(); }
    catch (e) { setError(e.message); }
  }

  if (linked === null) return <p>Loading…</p>;

  if (linked) {
    return (
      <div className="discord-integration">
        <p>Connected to Discord.</p>
        <button className="btn-danger" type="button" onClick={disconnect}>Disconnect</button>
        {error && <p className="settings-error">{error}</p>}
      </div>
    );
  }

  const secondsLeft = expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : 0;
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="discord-integration">
      {!code ? (
        <>
          <p>Link your Discord account so the Questboard bot can answer for you.</p>
          <button className="btn-primary" type="button" onClick={connect}>Connect Discord</button>
        </>
      ) : (
        <>
          <p>In your Discord server, run:</p>
          <p><code className="discord-link-cmd">/questboard link {code}</code></p>
          <p className="settings-note">Expires in {mmss}. Waiting for you to run it…</p>
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
