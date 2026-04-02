import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { IPC } from '../../shared/types';

interface ScriptEditorProps {
  profileId: string;
  profileIndex: number;
}

export function ScriptEditor({ profileId, profileIndex }: ScriptEditorProps) {
  const [code, setCode] = useState('// Write your automation script here\n');
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const offLog = window.electronAPI.on(IPC.SCRIPT_LOG, (data: any) =>
      setLogs(l => [...l, `[${data.level}] ${data.message}`]));
    const offDone = window.electronAPI.on(IPC.SCRIPT_DONE, (data: any) => {
      setRunning(false);
      if (!data.success) setLogs(l => [...l, `[error] ${data.error}`]);
    });
    return () => { offLog(); offDone(); };
  }, []);

  const run = () => {
    setLogs([]);
    setRunning(true);
    window.electronAPI.invoke(IPC.SCRIPT_RUN, profileId, profileIndex, code);
  };

  const stop = () => {
    window.electronAPI.invoke(IPC.SCRIPT_STOP, profileId);
  };

  return (
    <div className="script-panel">
      <Editor
        height="300px"
        language="javascript"
        value={code}
        onChange={v => setCode(v ?? '')}
        theme="vs-dark"
        options={{ minimap: { enabled: false }, fontSize: 13 }}
      />
      <div className="script-toolbar">
        <button onClick={run} disabled={running}>Run</button>
        <button onClick={stop} disabled={!running}>Stop</button>
      </div>
      <pre className="script-output">{logs.join('\n')}</pre>
    </div>
  );
}
