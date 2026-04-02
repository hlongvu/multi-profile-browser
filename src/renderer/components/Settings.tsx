import { useState } from 'react';
import { RunningProfilesPanel } from './RunningProfilesPanel';

type SettingsTab = 'running' | 'general';

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('running');

  return (
    <div className="settings-container">
      <div className="settings-sidebar">
        <h2>Settings</h2>
        <nav className="settings-nav">
          <button
            className={`settings-nav-item ${activeTab === 'running' ? 'active' : ''}`}
            onClick={() => setActiveTab('running')}
          >
            Running Profiles
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
        </nav>
      </div>
      <div className="settings-content">
        {activeTab === 'running' && <RunningProfilesPanel />}
        {activeTab === 'general' && (
          <div className="settings-panel">
            <h3>General Settings</h3>
            <p className="settings-placeholder">General settings coming soon...</p>
          </div>
        )}
      </div>
    </div>
  );
}