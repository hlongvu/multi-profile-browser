import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

interface ProxyHandle {
  wss: WebSocketServer;
  close(): void;
}

const proxies = new Map<string, ProxyHandle>();

interface CdpTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

async function findTargetUrl(webContentsId: number): Promise<string> {
  const res = await fetch('http://localhost:9222/json/list');
  const targets: CdpTarget[] = await res.json();
  const target = targets.find(t => t.id.endsWith(`${webContentsId}`));
  if (!target) throw new Error(`No CDP target for webContents ${webContentsId}`);
  return target.webSocketDebuggerUrl;
}

export async function startCdpProxy(
  profileId: string,
  externalPort: number,
  webContentsId: number,
): Promise<void> {
  if (proxies.has(profileId)) return;

  const targetUrl = await findTargetUrl(webContentsId);

  const wss = new WebSocketServer({ port: externalPort });

  wss.on('connection', (client) => {
    const upstream = new WebSocket(targetUrl);
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

  proxies.set(profileId, {
    wss,
    close() { wss.close(); proxies.delete(profileId); },
  });
}

export function stopCdpProxy(profileId: string): void {
  proxies.get(profileId)?.close();
}
