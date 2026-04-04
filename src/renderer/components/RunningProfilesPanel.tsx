import { useState, useEffect } from 'react';
import { IPC, Profile } from '../../shared/types';

interface RunningInfo {
  id: string;
  cdpPort?: number;
  isActive: boolean;
}

export function RunningProfilesPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [runningInfo, setRunningInfo] = useState<RunningInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [allProfiles, running] = await Promise.all([
        window.electronAPI.invoke(IPC.PROFILE_LIST),
        window.electronAPI.invoke(IPC.PROFILE_GET_RUNNING),
      ]) as [Profile[], RunningInfo[]];
      setProfiles(allProfiles);
      setRunningInfo(running);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const getRunningInfo = (profileId: string): RunningInfo | undefined => {
    return runningInfo.find(r => r.id === profileId);
  };

  const handleStopCdp = async (profileId: string) => {
    await window.electronAPI.invoke(IPC.CDP_STOP, profileId);
    loadData();
  };

  const handleStartCdp = async (profileId: string) => {
    await window.electronAPI.invoke(IPC.CDP_START, profileId);
    loadData();
  };

  const handleDelete = (profileId: string, profileName: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete "${profileName}"?\n\nThis action cannot be undone.`);
    if (confirmed) {
      window.electronAPI.invoke(IPC.PROFILE_DELETE, profileId).then(() => {
        setProfiles(list => list.filter(p => p.id !== profileId));
      });
    }
  };

  if (loading) {
    return <div className="settings-panel"><p>Loading...</p></div>;
  }

  return (
    <div className="settings-panel">
      <h3>All Profiles</h3>
      <p className="settings-description">
        Manage your profiles. Delete profiles from here.
      </p>
      {profiles.length === 0 ? (
        <p className="settings-empty">No profiles created yet.</p>
      ) : (
        <div className="running-profiles-list">
          {profiles.map(profile => {
            const info = getRunningInfo(profile.id);
            return (
              <div key={profile.id} className="running-profile-item">
                <div className="running-profile-info">
                  <span
                    className="running-profile-color"
                    style={{ backgroundColor: profile.color }}
                  />
                  <span className="running-profile-name">{profile.name}</span>
                  {info?.isActive && (
                    <span className="running-profile-badge">Active</span>
                  )}
                </div>
                <div className="running-profile-port">
                  {info?.cdpPort ? (
                    <>
                      <span className="port-label">Debug Port:</span>
                      <span className="port-number">localhost:{info.cdpPort}</span>
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
                  ) : info ? (
                    <>
                      <span className="no-port">CDP not enabled</span>
                      <button
                        className="start-btn"
                        onClick={() => handleStartCdp(profile.id)}
                      >
                        Start CDP
                      </button>
                    </>
                  ) : (
                    <span className="no-port">Not running</span>
                  )}
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(profile.id, profile.name)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}