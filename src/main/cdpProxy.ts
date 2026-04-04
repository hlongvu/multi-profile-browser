import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';

interface ProxyHandle {
  server: http.Server;
  wss: WebSocketServer;
  profileId: string;
  webContentsId: number;
  targetId: string;
  externalPort: number;
  close(): void;
}

const proxies = new Map<string, ProxyHandle>();

interface CdpTarget {
  id: string;
  type: string;
  webSocketDebuggerUrl: string;
  url: string;
  title: string;
}

// CDP protocol message shape (browser-level)
interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  sessionId?: string;
}

async function findTargetByWebContentsId(
  webContentsId: number,
  retries = 20,
  delay = 500,
): Promise<CdpTarget> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://localhost:9222/json');
      const targets: CdpTarget[] = await res.json();
      const target = targets.find(t =>
        t.webSocketDebuggerUrl.includes(webContentsId.toString(16)),
      );
      if (target) {
        console.log(`[CDP:${webContentsId}] Found target:`, target.url);
        return target;
      }
    } catch {
      // retry on fetch error
    }
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error(`No CDP target for webContentsId ${webContentsId} after ${retries} retries`);
}

async function refreshTarget(targetId: string): Promise<CdpTarget | undefined> {
  try {
    const res = await fetch('http://localhost:9222/json/list');
    const targets: CdpTarget[] = await res.json();
    return targets.find(t => t.id === targetId);
  } catch {
    return undefined;
  }
}

function pageWsPath(webSocketDebuggerUrl: string): string {
  const idx = webSocketDebuggerUrl.indexOf('/devtools/');
  return webSocketDebuggerUrl.substring(idx);
}

/**
 * Creates a browser-level WS connection that filters Target.* events and
 * responses so the agent only sees the tab belonging to this profile.
 */
function createFilteredBrowserProxy(
  client: WebSocket,
  upstreamUrl: string,
  profileId: string,
  ownTargetId: string,
): void {
  const upstream = new WebSocket(upstreamUrl);
  const pendingToUpstream: { msg: WebSocket.RawData; isBinary: boolean }[] = [];

  // Track which CDP message ids were for Target.getTargets / Target.setDiscoverTargets
  // so we can filter responses back to the agent
  const getTargetsIds = new Set<number>();

  client.on('message', (msg, isBinary) => {
    if (isBinary) {
      // Binary frames pass through unfiltered
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(msg, { binary: true });
      } else {
        pendingToUpstream.push({ msg, isBinary });
      }
      return;
    }

    let parsed: CdpMessage;
    try {
      parsed = JSON.parse(msg.toString());
    } catch {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(msg, { binary: false });
      } else {
        pendingToUpstream.push({ msg, isBinary });
      }
      return;
    }

    // Track calls whose results need target-filtering
    if (parsed.id !== undefined && parsed.method === 'Target.getTargets') {
      getTargetsIds.add(parsed.id);
    }

    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(msg, { binary: false });
    } else {
      pendingToUpstream.push({ msg, isBinary: false });
    }
  });

  upstream.on('open', () => {
    console.log(`[CDP:${profileId}] Browser upstream open, flushing ${pendingToUpstream.length} queued`);
    for (const { msg, isBinary } of pendingToUpstream) {
      upstream.send(msg, { binary: isBinary });
    }
    pendingToUpstream.length = 0;
  });

  upstream.on('message', (msg, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return;

    if (isBinary) {
      client.send(msg, { binary: true });
      return;
    }

    let parsed: CdpMessage;
    try {
      parsed = JSON.parse(msg.toString());
    } catch {
      client.send(msg, { binary: false });
      return;
    }

    // Filter Target.getTargets result to only expose own target
    if (parsed.id !== undefined && getTargetsIds.has(parsed.id)) {
      getTargetsIds.delete(parsed.id);
      if (parsed.result && Array.isArray((parsed.result as any).targetInfos)) {
        (parsed.result as any).targetInfos = (parsed.result as any).targetInfos.filter(
          (t: { targetId: string }) => t.targetId === ownTargetId,
        );
      }
      client.send(JSON.stringify(parsed), { binary: false });
      return;
    }

    // Filter Target.targetCreated / targetInfoChanged / targetDestroyed events
    // to only forward events for own target
    if (parsed.method) {
      if (
        parsed.method === 'Target.targetCreated' ||
        parsed.method === 'Target.targetInfoChanged' ||
        parsed.method === 'Target.targetDestroyed' ||
        parsed.method === 'Target.targetCrashed'
      ) {
        const params = parsed.params as any;
        const id = params?.targetInfo?.targetId ?? params?.targetId;
        if (id && id !== ownTargetId) {
          // Drop events for other profiles' tabs
          return;
        }
      }
    }

    client.send(JSON.stringify(parsed), { binary: false });
  });

  upstream.on('error', (err) => {
    console.error(`[CDP:${profileId}] Browser upstream error:`, err.message);
    client.terminate();
  });

  client.on('close', () => {
    pendingToUpstream.length = 0;
    upstream.terminate();
  });
  upstream.on('close', () => client.terminate());
}

export async function startCdpProxy(
  profileId: string,
  webContentsId: number,
  externalPort: number,
): Promise<void> {
  if (proxies.has(profileId)) return;

  const target = await findTargetByWebContentsId(webContentsId);

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  server.on('request', async (req, res) => {
    const url = req.url ?? '';

    if (url === '/json' || url === '/json/list') {
      const current = (await refreshTarget(target.id)) ?? target;
      const wsPath = pageWsPath(target.webSocketDebuggerUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{
        description: '',
        devtoolsFrontendUrl: `/devtools/inspector.html?ws=127.0.0.1:${externalPort}${wsPath}`,
        id: target.id,
        title: current.title,
        type: target.type ?? 'page',
        url: current.url,
        webSocketDebuggerUrl: `ws://127.0.0.1:${externalPort}${wsPath}`,
      }]));
      return;
    }

    if (url === '/json/version') {
      try {
        const versionRes = await fetch('http://localhost:9222/json/version');
        const version = await versionRes.json();
        const browserId = new URL(version.webSocketDebuggerUrl).pathname.split('/').pop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...version,
          webSocketDebuggerUrl: `ws://127.0.0.1:${externalPort}/devtools/browser/${browserId}`,
        }));
      } catch {
        res.writeHead(500);
        res.end('{"error":"Failed to fetch version"}');
      }
      return;
    }

    if (url === '/json/protocol') {
      try {
        const protocolRes = await fetch('http://localhost:9222/json/protocol');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(await protocolRes.text());
      } catch {
        res.writeHead(500);
        res.end('{"error":"Failed to fetch protocol"}');
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  wss.on('connection', (client, req) => {
    const urlPath = req.url ?? '';

    if (urlPath.startsWith('/devtools/browser/')) {
      // Browser-level WS: proxy with target filtering so agent only sees own tab
      const upstreamUrl = `ws://localhost:9222${urlPath}`;
      console.log(`[CDP:${profileId}] Browser WS connection → filtered proxy`);
      createFilteredBrowserProxy(client, upstreamUrl, profileId, target.id);
      return;
    }

    // Page-level WS: direct proxy to this profile's tab, no filtering needed
    const upstreamUrl = target.webSocketDebuggerUrl;
    console.log(`[CDP:${profileId}] Page WS connection:`, urlPath, '->', upstreamUrl);

    const upstream = new WebSocket(upstreamUrl);
    const pendingToUpstream: { msg: WebSocket.RawData; isBinary: boolean }[] = [];

    client.on('message', (msg, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(msg, { binary: isBinary });
      } else {
        pendingToUpstream.push({ msg, isBinary });
      }
    });

    upstream.on('open', () => {
      console.log(`[CDP:${profileId}] Page upstream open, flushing ${pendingToUpstream.length} queued`);
      for (const { msg, isBinary } of pendingToUpstream) {
        upstream.send(msg, { binary: isBinary });
      }
      pendingToUpstream.length = 0;
    });

    upstream.on('message', (msg, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg, { binary: isBinary });
      }
    });

    upstream.on('error', (err) => {
      console.error(`[CDP:${profileId}] Page upstream error:`, err.message);
      client.terminate();
    });

    client.on('close', () => {
      pendingToUpstream.length = 0;
      upstream.terminate();
    });
    upstream.on('close', () => client.terminate());
  });

  await new Promise<void>((resolve) => server.listen(externalPort, '127.0.0.1', resolve));
  console.log(`[CDP:${profileId}] Proxy listening on port ${externalPort}`);

  proxies.set(profileId, {
    server,
    wss,
    profileId,
    webContentsId,
    targetId: target.id,
    externalPort,
    close() {
      console.log(`[CDP:${profileId}] Stopping proxy on port ${externalPort}`);
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      server.close();
      proxies.delete(profileId);
    },
  });
}

export function stopCdpProxy(profileId: string): void {
  proxies.get(profileId)?.close();
}

export function getCdpProxyPort(profileId: string): number | undefined {
  return proxies.get(profileId)?.externalPort;
}
