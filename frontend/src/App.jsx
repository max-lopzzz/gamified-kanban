import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { hasToken } from "./api";
import Login from "./components/Login.jsx";
import AppShell from "./components/AppShell.jsx";
import BoardPage from "./pages/BoardPage.jsx";
import BoardSettingsPage from "./pages/BoardSettingsPage.jsx";
import AccountSettingsPage from "./pages/AccountSettingsPage.jsx";
import InviteAcceptPage from "./pages/InviteAcceptPage.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  const [authed, setAuthed] = useState(hasToken());

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }

  return (
    <Routes>
      <Route element={<AppShell onSignOut={() => setAuthed(false)} />}>
        <Route index element={<BoardPage />} />
        <Route path="board/:boardId" element={<BoardPage />} />
        <Route path="board/:boardId/settings" element={<BoardSettingsPage />} />
        <Route path="account/settings" element={<AccountSettingsPage />} />
      </Route>
      <Route path="invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
