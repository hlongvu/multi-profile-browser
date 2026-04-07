import http from 'http';
import { ProfileManager } from './profileManager';
import { BrowserViewManager } from './browserViewManager';
import { getCdpProxyPort, getActiveProxyCount } from './cdpProxy';
import { Profile } from '../shared/types';

const PORT = 8868;

interface ProfileWithStatus extends Profile {
  isRunning: boolean;
  cdpPort?: number;
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function startApiServer(profileManager: ProfileManager, viewManager: BrowserViewManager): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
    const pathname = url.pathname;

    if (pathname === '/health' && req.method === 'GET') {
      const activeIds = viewManager.getActiveProfileIds();
      jsonResponse(res, 200, {
        status: 'ok',
        activeProfiles: activeIds.length,
        activeProfileIds: activeIds,
        proxyCount: getActiveProxyCount(),
      });
      return;
    }

    if (pathname === '/list_profiles' && req.method === 'GET') {
      const profiles = profileManager.list();
      const activeIds = new Set(viewManager.getActiveProfileIds());
      const result: ProfileWithStatus[] = profiles.map(profile => {
        const isRunning = activeIds.has(profile.id);
        return {
          ...profile,
          isRunning,
          cdpPort: isRunning ? getCdpProxyPort(profile.id) : undefined,
        };
      });
      jsonResponse(res, 200, { profiles: result });
      return;
    }

    if (pathname === '/create_profile' && req.method === 'POST') {
      try {
        const body = await parseBody<{ name: string; color?: string }>(req);
        if (!body.name || typeof body.name !== 'string') {
          jsonResponse(res, 400, { error: 'name is required and must be a string' });
          return;
        }
        const color = body.color || '#6366f1';
        const profile = profileManager.create(body.name, color);
        jsonResponse(res, 201, { profile });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid request';
        jsonResponse(res, 400, { error: message });
      }
      return;
    }

    jsonResponse(res, 404, { error: 'Not found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[API] Server listening on http://localhost:${PORT}`);
  });

  return server;
}
