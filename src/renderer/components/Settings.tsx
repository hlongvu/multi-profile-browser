import { useState, useEffect } from 'react';
import { RunningProfilesPanel } from './RunningProfilesPanel';
import { IPC } from '../../shared/types';

type SettingsTab = 'general' | 'running';

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [storagePath, setStoragePath] = useState<string>('');

  useEffect(() => {
    window.electronAPI.invoke(IPC.SETTINGS_GET_STORAGE_PATH).then((path) => {
      setStoragePath(path as string);
    });
  }, []);

  const handleSelectFolder = async () => {
    const path = await window.electronAPI.invoke(IPC.SETTINGS_SELECT_STORAGE_PATH);
    if (path) {
      setStoragePath(path as string);
    }
  };

  return (
    <div className="settings-container">
      <div className="settings-sidebar">
        <h2>Settings</h2>
        <nav className="settings-nav">
          <button
            className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            className={`settings-nav-item ${activeTab === 'running' ? 'active' : ''}`}
            onClick={() => setActiveTab('running')}
          >
            Running Profiles
          </button>
        </nav>
      </div>
      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="settings-panel">
            <h3>General Settings</h3>
            <div className="settings-section">
              <label className="settings-label">Profile Storage Location</label>
              <p className="settings-description">
                Choose where profile data will be stored. Changes will take effect after restarting.
              </p>
              <div className="storage-path-row">
                <span className="storage-path-value">{storagePath || 'Default location'}</span>
                <button className="browse-btn" onClick={handleSelectFolder}>
                  Browse...
                </button>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'running' && <RunningProfilesPanel />}
      </div>
    </div>
  );
}