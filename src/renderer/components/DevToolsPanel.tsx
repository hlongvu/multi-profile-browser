import { Profile, IPC } from '../../shared/types';

interface DevToolsPanelProps {
  profiles: Profile[];
  activeId: string | null;
}

export function DevToolsPanel({ profiles }: DevToolsPanelProps) {
  const handleStartCdp = async (profileId: string) => {
    const port = await window.electronAPI.invoke(IPC.CDP_START, profileId) as number;
    return port;
  };

  const handleStopCdp = (profileId: string) => {
    window.electronAPI.invoke(IPC.CDP_STOP, profileId);
  };

  return (
    <div className="devtools-panel">
      <h3>DevTools Connection</h3>
      {profiles.map(profile => (
        <div key={profile.id} className="devtools-profile">
          <span style={{ color: profile.color }}>{profile.name}</span>
          {profile.cdpPort ? (
            <>
              <span className="cdp-port">localhost:{profile.cdpPort}</span>
              <a
                href={`chrome://inspect# devices`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open DevTools
              </a>
              <button onClick={() => handleStopCdp(profile.id)}>Stop</button>
            </>
          ) : (
            <button onClick={() => handleStartCdp(profile.id)}>Start CDP</button>
          )}
        </div>
      ))}
    </div>
  );
}
