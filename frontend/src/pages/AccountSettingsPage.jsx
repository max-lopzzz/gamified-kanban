import { Link } from "react-router-dom";
import SettingsSection from "../components/settings/SettingsSection.jsx";
import DiscordIntegration from "../components/settings/DiscordIntegration.jsx";

export default function AccountSettingsPage() {
  return (
    <div className="board-page settings-page">
      <div className="settings-topbar">
        <Link className="btn-ghost" to="/">← Back</Link>
        <h2>Account settings</h2>
      </div>
      <div className="settings-content">
        <SettingsSection title="Discord">
          <DiscordIntegration />
        </SettingsSection>
      </div>
    </div>
  );
}
