import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

interface ProxyHandle {
  server: http.Server;
  wss: WebSocketServer;
  profileId: string;
  webContentsId: number;
  targetUrl: string;
  close(): void;
}

const proxies = new Map<string, ProxyHandle>();

interface CdpTarget {
  id: string;
  webSocketDebuggerUrl: string;
  url: string;
  title: string;
}

async function findTargetUrl(profileId: string, retries = 20, delay = 500): Promise<CdpTarget> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://localhost:9222/json/list');
      const targets: CdpTarget[] = await res.json();
      const target = targets.find(t => t.url.includes(profileId));
      if (target) {
        console.log(`[CDP] Found target for ${profileId}:`, target.url);
        return target;
      }
    } catch (e) {
      // ignore fetch errors and retry
    }
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error(`No CDP target for profile ${profileId} after ${retries} retries`);
}

export async function startCdpProxy(
  profileId: string,
  externalPort: number,
): Promise<void> {
  if (proxies.has(profileId)) return;

  const target = await findTargetUrl(profileId);

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  server.on('request', async (req, res) => {
    if (req.url === '/json' || req.url === '/json/list') {
      let currentUrl = target.url;
      let currentTitle = target.title;
      try {
        const listRes = await fetch('http://localhost:9222/json/list');
        const targets: CdpTarget[] = await listRes.json();
        const updated = targets.find(t => t.id === target.id);
        if (updated) {
          currentUrl = updated.url;
          currentTitle = updated.title;
        }
      } catch (e) {
        // use cached values
      }
      const externalWsUrl = `ws://127.0.0.1:${externalPort}${target.webSocketDebuggerUrl.substring(target.webSocketDebuggerUrl.indexOf('/devtools'))}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{
        id: target.id,
        webSocketDebuggerUrl: externalWsUrl,
        url: currentUrl,
        title: currentTitle,
      }]));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  wss.on('connection', (client, req) => {
    const upstream = new WebSocket(target.webSocketDebuggerUrl);
    const forward = (src: WebSocket, dst: WebSocket) =>
      src.on('message', (msg, isBinary) => {
        if (dst.readyState === WebSocket.OPEN) dst.send(msg, { binary: isBinary });
      });
    forward(client, upstream);
    forward(upstream, client);
    client.on('close', () => upstream.terminate());
    upstream.on('close', () => client.terminate());
    upstream.on('error', () => client.terminate());
  });

  await new Promise<void>((resolve) => server.listen(externalPort, '127.0.0.1', resolve));

  proxies.set(profileId, {
    server,
    wss,
    profileId,
    webContentsId: 0,
    targetUrl: target.url,
    close() {
      wss.close();
      server.close();
      proxies.delete(profileId);
    },
  });
}

export function stopCdpProxy(profileId: string): void {
  proxies.get(profileId)?.close();
}
