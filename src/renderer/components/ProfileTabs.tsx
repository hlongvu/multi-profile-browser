import { Profile } from '../../shared/types';

interface ProfileTabsProps {
  profiles: Profile[];
  activeId: string | null;
  titleMap: Record<string, string>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
}

export function ProfileTabs({ profiles, activeId, titleMap, onSelect, onAdd, onClose }: ProfileTabsProps) {
  return (
    <div className="profile-tabs">
      <div className="tabs-list">
        {profiles.map(profile => (
          <div
            key={profile.id}
            className={`tab ${profile.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(profile.id)}
            style={{ borderTop: `3px solid ${profile.color}` }}
          >
            <span className="tab-name">{profile.name}</span>
            <span className="tab-title">{titleMap[profile.id] || ''}</span>
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onClose(profile.id); }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="add-tab" onClick={onAdd}>+</button>
    </div>
  );
}
