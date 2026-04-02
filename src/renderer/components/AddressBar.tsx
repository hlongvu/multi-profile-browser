import { useState, useRef, useEffect } from 'react';

interface AddressBarProps {
  url: string;
  loading: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
}

export function AddressBar({ url, loading, onNavigate, onBack, onForward, onReload }: AddressBarProps) {
  const [input, setInput] = useState(url);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInput(url);
  }, [url]);

  useEffect(() => {
    const offFocus = window.electronAPI.on('ui:focusAddress', () => inputRef.current?.focus());
    return offFocus;
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNavigate(input);
  };

  return (
    <div className="address-bar">
      <button className="nav-btn" onClick={onBack} title="Back">←</button>
      <button className="nav-btn" onClick={onForward} title="Forward">→</button>
      <button className="nav-btn" onClick={onReload} title="Reload">
        {loading ? '◌' : '↻'}
      </button>
      <form className="url-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="url-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter URL..."
        />
      </form>
    </div>
  );
}
