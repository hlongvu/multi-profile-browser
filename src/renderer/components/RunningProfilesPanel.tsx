import { useState, useEffect, useRef } from 'react';
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
  const [renameProfile, setRenameProfile] = useState<Profile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (renameProfile && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renameProfile]);

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

  const openRenameDialog = (profile: Profile) => {
    setRenameProfile(profile);
    setRenameValue(profile.name);
  };

  const closeRenameDialog = () => {
    setRenameProfile(null);
    setRenameValue('');
  };

  const handleRenameSubmit = () => {
    if (renameProfile && renameValue.trim() && renameValue.trim() !== renameProfile.name) {
      window.electronAPI.invoke(IPC.PROFILE_UPDATE, renameProfile.id, { name: renameValue.trim() }).then(() => {
        setProfiles(list => list.map(p => p.id === renameProfile.id ? { ...p, name: renameValue.trim() } : p));
        closeRenameDialog();
      });
    } else {
      closeRenameDialog();
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      closeRenameDialog();
    }
  };

  if (loading) {
    return <div className="settings-panel"><p>Loading...</p></div>;
  }

  return (
    <>
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
                      className="rename-btn"
                      onClick={() => openRenameDialog(profile)}
                    >
                      Rename
                    </button>
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

      {renameProfile && (
        <div className="modal-overlay" onClick={closeRenameDialog}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Rename Profile</h3>
            </div>
            <div className="modal-body">
              <input
                ref={inputRef}
                type="text"
                className="modal-input"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                placeholder="Profile name"
              />
            </div>
            <div className="modal-footer">
              <button className="modal-btn cancel" onClick={closeRenameDialog}>
                Cancel
              </button>
              <button className="modal-btn confirm" onClick={handleRenameSubmit}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}