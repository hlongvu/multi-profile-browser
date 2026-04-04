import Store from 'electron-store';
import crypto from 'crypto';
import path from 'path';
import { Profile, Script } from '../shared/types';
import { app } from 'electron';

interface StoreSchema {
  profiles: Profile[];
  scripts: Script[];
}

interface AppSettings {
  storagePath?: string;
}

const appStore = new Store<AppSettings>({ name: 'settings' });

export class ProfileManager {
  private store: Store<StoreSchema>;

  constructor() {
    const storagePath = appStore.get('storagePath');
    const configDir = storagePath || app.getPath('userData');
    this.store = new Store<StoreSchema>({
      cwd: configDir,
      name: 'profiles',
      defaults: { profiles: [], scripts: [] },
    });
    this.migratePartitionPaths();
  }

  private migratePartitionPaths(): void {
    const profiles = this.list();
    const needsMigration = profiles.some(p => path.isAbsolute(p.partition));
    if (!needsMigration) return;
    const updated = profiles.map(p => ({
      ...p,
      partition: path.isAbsolute(p.partition) ? path.join('sessions', p.id) : p.partition,
    }));
    this.store.set('profiles', updated);
  }

  getStoragePath(): string {
    return appStore.get('storagePath') || app.getPath('userData');
  }

  setStoragePath(newPath: string): void {
    appStore.set('storagePath', newPath);
    this.store = new Store<StoreSchema>({
      cwd: newPath,
      name: 'profiles',
      defaults: { profiles: [], scripts: [] },
    });
  }

  list(): Profile[] {
    return this.store.get('profiles');
  }

  get(id: string): Profile | undefined {
    return this.list().find(p => p.id === id);
  }

  getSessionDir(id: string): string {
    return path.join('sessions', id);
  }

  resolvePartition(partition: string): string {
    return path.join(this.getStoragePath(), partition);
  }

  create(name: string, color: string): Profile {
    const id = crypto.randomUUID();
    const profile: Profile = {
      id,
      name,
      color,
      partition: this.getSessionDir(id),
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
