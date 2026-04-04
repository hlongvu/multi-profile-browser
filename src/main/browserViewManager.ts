import { BrowserWindow, BrowserView, session } from 'electron';
import { Profile } from '../shared/types';
import { ProfileManager } from './profileManager';

export class BrowserViewManager {
  private views = new Map<string, BrowserView>();

  constructor(
    private win: BrowserWindow,
    private profiles: ProfileManager,
    private toolbarHeight: number,
    private sidebarWidth: number,
  ) {}

  private create(profile: Profile): BrowserView {
    const ses = session.fromPath(this.profiles.resolvePartition(profile.partition));

    if (profile.proxyConfig) {
      ses.setProxy({ proxyRules: profile.proxyConfig });
    }
    if (profile.userAgent) {
      ses.setUserAgent(profile.userAgent);
    }

    const view = new BrowserView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.webContents.on('new-window', (event, url, frameName, disposition) => {
      console.log('[BVM] new-window event:', url, frameName, disposition);
      event.preventDefault();
      if (disposition === 'new-window' || disposition === 'foreground-tab' || disposition === 'background-tab') {
        view.webContents.loadURL(url);
      }
    });

    view.webContents.on('will-navigate', (event, url) => {
      console.log('[BVM] will-navigate:', url);
    });

    view.webContents.on('page-title-updated', (_, title) => {
      this.win.webContents.send('browser:titleChanged', { profileId: profile.id, title });
    });
    view.webContents.on('page-favicon-updated', (_, favicons) => {
      this.win.webContents.send('browser:faviconChanged', { profileId: profile.id, favicon: favicons[0] });
    });
    view.webContents.on('did-start-loading', () => {
      this.win.webContents.send('browser:loadingChanged', { profileId: profile.id, loading: true });
    });
    view.webContents.on('did-stop-loading', () => {
      this.win.webContents.send('browser:loadingChanged', { profileId: profile.id, loading: false });
      const url = view.webContents.getURL();
      this.win.webContents.send('browser:urlChanged', { profileId: profile.id, url });
      this.profiles.update(profile.id, { homeUrl: url });
      view.webContents.executeJavaScript('Object.defineProperty(navigator, "webdriver", {get: () => false, configurable: true});').catch(() => {});
    });

    this.views.set(profile.id, view);
    return view;
  }

  activate(profileId: string): void {
    const profile = this.profiles.get(profileId);
    if (!profile) return;

    let view = this.views.get(profileId);
    if (!view) view = this.create(profile);

    const { width, height } = this.win.getBounds();
    const bounds = {
      x: this.sidebarWidth,
      y: this.toolbarHeight,
      width: width - this.sidebarWidth,
      height: height - this.toolbarHeight,
    };
    view.setBounds(bounds);
    this.win.setBrowserView(view);
    console.log('[BVM] Activated profile:', profileId, 'bounds:', bounds);

    if (view.webContents.getURL() === '' || view.webContents.getURL() === 'about:blank') {
      if (profile.homeUrl && profile.homeUrl !== 'about:blank') {
        view.webContents.loadURL(profile.homeUrl);
      }
    }
  }

  getOrCreateView(profileId: string): BrowserView | undefined {
    const profile = this.profiles.get(profileId);
    if (!profile) return undefined;
    let view = this.views.get(profileId);
    if (!view) {
      view = this.create(profile);
      this.win.setBrowserView(view);
      this.recalculateBounds();
      console.log('[BVM] Created view for navigate, bounds:', view.getBounds());
    }
    return view;
  }

  ensureView(profileId: string): BrowserView | undefined {
    const profile = this.profiles.get(profileId);
    if (!profile) return undefined;
    let view = this.views.get(profileId);
    if (!view) {
      view = this.create(profile);
      this.views.set(profileId, view);
      view.webContents.loadURL('about:blank');
      console.log('[BVM] Created hidden view for CDP, webContentsId:', view.webContents.id);
    }
    return view;
  }

  async ensureViewAndWait(profileId: string): Promise<{ view: BrowserView; cdpSessionId: number } | undefined> {
    const view = this.ensureView(profileId);
    if (!view) return undefined;
    const currentUrl = view.webContents.getURL();
    const targetUrl = (currentUrl && currentUrl !== 'about:blank') ? currentUrl : `data:text/html,${profileId}`;
    if (view.webContents.getURL() !== targetUrl) {
      await new Promise<void>((resolve) => {
        view.webContents.once('did-finish-load', () => resolve());
        view.webContents.loadURL(targetUrl);
      });
    }
    return { view, cdpSessionId: view.webContents.id };
  }

  recalculateBounds(): void {
    const view = this.win.getBrowserView();
    if (!view) return;
    const { width, height } = this.win.getBounds();
    view.setBounds({
      x: this.sidebarWidth,
      y: this.toolbarHeight,
      width: width - this.sidebarWidth,
      height: height - this.toolbarHeight,
    });
  }

  navigate(profileId: string, url: string): void {
    const view = this.getOrCreateView(profileId);
    if (!view) {
      console.log('[BVM] navigate: no view available for profile:', profileId);
      return;
    }
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    console.log('[BVM] Navigating to:', normalized);
    view.webContents.loadURL(normalized);
  }

  back(profileId: string): void {
    this.views.get(profileId)?.webContents.goBack();
  }

  forward(profileId: string): void {
    this.views.get(profileId)?.webContents.goForward();
  }

  reload(profileId: string): void {
    this.views.get(profileId)?.webContents.reload();
  }

  destroy(profileId: string): void {
    const view = this.views.get(profileId);
    if (!view) return;
    if (this.win.getBrowserView() === view) this.win.setBrowserView(null);
    view.webContents.removeAllListeners();
    this.views.delete(profileId);
  }

  getWebContentsId(profileId: string): number | undefined {
    return this.views.get(profileId)?.webContents.id;
  }

  openDevTools(profileId: string): void {
    const view = this.views.get(profileId);
    if (view) {
      view.webContents.openDevTools({ mode: 'detach' });
    }
  }

  getActiveProfileIds(): string[] {
    return Array.from(this.views.keys());
  }

  isActive(profileId: string): boolean {
    return this.views.has(profileId);
  }

  hideAll(): void {
    this.win.setBrowserView(null);
  }

  show(profileId: string): void {
    const view = this.views.get(profileId);
    if (view) {
      this.win.setBrowserView(view);
      this.recalculateBounds();
    }
  }
}
