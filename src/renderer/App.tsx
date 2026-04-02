import { useState, useEffect } from 'react';
import { Profile, IPC } from '../shared/types';
import { ProfileTabs } from './components/ProfileTabs';
import { AddressBar } from './components/AddressBar';
import { Settings } from './components/Settings';

declare global {
  interface Window {
    electronAPI: {
      invoke(channel: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, cb: (...args: unknown[]) => void): () => void;
    };
  }
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [urlMap, setUrlMap] = useState<Record<string, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    window.electronAPI.invoke(IPC.PROFILE_LIST).then(p => {
      const list = p as Profile[];
      setProfiles(list);
      if (list.length > 0) activate(list[0].id);
    });

    const offUrl = window.electronAPI.on('browser:urlChanged', (data: any) =>
      setUrlMap(m => ({ ...m, [data.profileId]: data.url })));
    const offLoading = window.electronAPI.on('browser:loadingChanged', (data: any) =>
      setLoadingMap(m => ({ ...m, [data.profileId]: data.loading })));
    const offTitle = window.electronAPI.on('browser:titleChanged', (data: any) =>
      setTitleMap(m => ({ ...m, [data.profileId]: data.title })));

    return () => { offUrl(); offLoading(); offTitle(); };
  }, []);

  const activate = (id: string) => {
    setActiveId(id);
    window.electronAPI.invoke(IPC.BROWSER_ACTIVATE, id);
  };

  const handleCreate = () => {
    const name = `Profile ${profiles.length + 1}`;
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD'];
    const color = colors[profiles.length % colors.length];
    window.electronAPI.invoke(IPC.PROFILE_CREATE, name, color).then((p: any) => {
      setProfiles(list => [...list, p]);
      activate(p.id);
    });
  };

  const handleDelete = (id: string) => {
    window.electronAPI.invoke(IPC.PROFILE_DELETE, id).then(() => {
      setProfiles(list => list.filter(p => p.id !== id));
      if (activeId === id) {
        const remaining = profiles.filter(p => p.id !== id);
        if (remaining.length > 0) activate(remaining[0].id);
      }
    });
  };

  if (showSettings) {
    return (
      <div className="settings-shell">
        <div className="settings-header">
          <button className="back-btn" onClick={() => {
            setShowSettings(false);
            window.electronAPI.invoke(IPC.SETTINGS_HIDE);
          }}>
            ← Back
          </button>
          <span className="settings-title">Settings</span>
        </div>
        <Settings />
      </div>
    );
  }

  return (
    <div className="shell">
      <ProfileTabs
        profiles={profiles}
        activeId={activeId}
        titleMap={titleMap}
        onSelect={activate}
        onAdd={handleCreate}
        onClose={handleDelete}
      />
      <div className="main-content">
        <div className="toolbar">
          <AddressBar
            url={urlMap[activeId ?? ''] ?? ''}
            loading={loadingMap[activeId ?? ''] ?? false}
            onNavigate={url => activeId && window.electronAPI.invoke(IPC.BROWSER_NAVIGATE, activeId, url)}
            onBack={() => activeId && window.electronAPI.invoke(IPC.BROWSER_BACK, activeId)}
            onForward={() => activeId && window.electronAPI.invoke(IPC.BROWSER_FORWARD, activeId)}
            onReload={() => activeId && window.electronAPI.invoke(IPC.BROWSER_RELOAD, activeId)}
          />
          <button className="settings-btn" onClick={() => {
            setShowSettings(true);
            window.electronAPI.invoke(IPC.SETTINGS_SHOW);
          }}>
            ⚙
          </button>
        </div>
        <div className="browser-content" />
      </div>
    </div>
  );
}
