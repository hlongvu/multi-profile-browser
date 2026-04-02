import { useState, useEffect } from 'react';
import { IPC } from '../../shared/types';

interface RunningProfile {
  id: string;
  name: string;
  color: string;
  cdpPort?: number;
  isActive: boolean;
}

export function RunningProfilesPanel() {
  const [runningProfiles, setRunningProfiles] = useState<RunningProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRunningProfiles();
    const interval = setInterval(loadRunningProfiles, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadRunningProfiles = async () => {
    try {
      const profiles = await window.electronAPI.invoke(IPC.PROFILE_GET_RUNNING) as RunningProfile[];
      setRunningProfiles(profiles);
    } catch (err) {
      console.error('Failed to load running profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStopCdp = async (profileId: string) => {
    await window.electronAPI.invoke(IPC.CDP_STOP, profileId);
    loadRunningProfiles();
  };

  const handleStartCdp = async (profileId: string) => {
    await window.electronAPI.invoke(IPC.CDP_START, profileId);
    loadRunningProfiles();
  };

  if (loading) {
    return <div className="settings-panel"><p>Loading...</p></div>;
  }

  return (
    <div className="settings-panel">
      <h3>Running Profiles</h3>
      <p className="settings-description">
        Profiles with active browser instances and remote debugging ports.
      </p>
      {runningProfiles.length === 0 ? (
        <p className="settings-empty">No running profiles.</p>
      ) : (
        <div className="running-profiles-list">
          {runningProfiles.map(profile => (
            <div key={profile.id} className="running-profile-item">
              <div className="running-profile-info">
                <span
                  className="running-profile-color"
                  style={{ backgroundColor: profile.color }}
                />
                <span className="running-profile-name">{profile.name}</span>
                {profile.isActive && (
                  <span className="running-profile-badge">Active</span>
                )}
              </div>
              <div className="running-profile-port">
                {profile.cdpPort ? (
                  <>
                    <span className="port-label">Debug Port:</span>
                    <span className="port-number">localhost:{profile.cdpPort}</span>
                    <a
                      href="chrome://inspect#devices"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="port-link"
                    >
                      Open DevTools
                    </a>
                    <button
                      className="stop-btn"
                      onClick={() => handleStopCdp(profile.id)}
                    >
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    <span className="no-port">CDP not enabled</span>
                    <button
                      className="start-btn"
                      onClick={() => handleStartCdp(profile.id)}
                    >
                      Start CDP
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}