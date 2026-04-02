import Store from 'electron-store';
import crypto from 'crypto';
import { Profile, Script } from '../shared/types';

interface StoreSchema {
  profiles: Profile[];
  scripts: Script[];
}

export class ProfileManager {
  private store = new Store<StoreSchema>({ defaults: { profiles: [], scripts: [] } });

  list(): Profile[] {
    return this.store.get('profiles');
  }

  get(id: string): Profile | undefined {
    return this.list().find(p => p.id === id);
  }

  create(name: string, color: string): Profile {
    const id = crypto.randomUUID();
    const profile: Profile = {
      id,
      name,
      color,
      partition: `persist:profile-${id}`,
      homeUrl: 'about:blank',
      createdAt: Date.now(),
    };
    this.store.set('profiles', [...this.list(), profile]);
    return profile;
  }

  update(id: string, patch: Partial<Profile>): Profile {
    const profiles = this.list().map(p => p.id === id ? { ...p, ...patch } : p);
    this.store.set('profiles', profiles);
    return profiles.find(p => p.id === id)!;
  }

  delete(id: string): void {
    this.store.set('profiles', this.list().filter(p => p.id !== id));
  }

  listScripts(): Script[] {
    return this.store.get('scripts');
  }

  saveScript(script: Omit<Script, 'id' | 'updatedAt'>): Script {
    const entry: Script = { ...script, id: crypto.randomUUID(), updatedAt: Date.now() };
    this.store.set('scripts', [...this.listScripts(), entry]);
    return entry;
  }

  deleteScript(id: string): void {
    this.store.set('scripts', this.listScripts().filter(s => s.id !== id));
  }
}
