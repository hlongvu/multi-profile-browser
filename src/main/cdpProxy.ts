import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import { getCdpPort } from './index';

let cdpBaseUrl = 'http://localhost:9222';

const HEARTBEAT_INTERVAL_MS = 25000;
const HEARTBEAT_TIMEOUT_MS = 5000;

export function setCdpBaseUrl(url: string) {
  cdpBaseUrl = url;
}

function getCdpBaseUrl() {
  const port = getCdpPort();
  return `http://localhost:${port}`;
}

interface HeartbeatHandle {
  intervalId: NodeJS.Timeout;
  timeoutId: NodeJS.Timeout;
}

function setupHeartbeat(ws: WebSocket, label: string, onTimeout: () => void): HeartbeatHandle {
  let isAlive = true;

  const onPong = () => {
    isAlive = true;
  };

  ws.on('pong', onPong);
  ws.on('close', onPong);

  const intervalId = setInterval(() => {
    if (!isAlive) {
      console.warn(`[CDP] ${label} heartbeat failed, terminating`);
      onTimeout();
      return;
    }
    isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  const timeoutId = setTimeout(() => {
    console.warn(`[CDP] ${label} heartbeat timeout`);
    onTimeout();
  }, HEARTBEAT_TIMEOUT_MS);

  return { intervalId, timeoutId };
}

function clearHeartbeat(handle: HeartbeatHandle | undefined): void {
  if (!handle) return;
  clearInterval(handle.intervalId);
  clearTimeout(handle.timeoutId);
}

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
const pendingProxies = new Set<string>();

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
  const hexId = webContentsId.toString(16);
  const decimalId = webContentsId.toString(10);
  
  console.log(`[CDP:${webContentsId}] Looking for target (hex: ${hexId}, decimal: ${decimalId})`);
  
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${getCdpBaseUrl()}/json`);
      const targets: CdpTarget[] = await res.json();
      
      console.log(`[CDP:${webContentsId}] Retry ${i + 1}/${retries}: Available targets:`, 
        targets.map(t => ({ id: t.id, url: t.url, ws: t.webSocketDebuggerUrl })));
      
      const target = targets.find(t =>
        t.webSocketDebuggerUrl.includes(hexId) ||
        t.webSocketDebuggerUrl.includes(decimalId) ||
        t.id === hexId ||
        t.id === decimalId
      );
      
      if (target) {
        console.log(`[CDP:${webContentsId}] Found target:`, target.url, 'id:', target.id);
        return target;
      }
    } catch (err) {
      console.log(`[CDP:${webContentsId}] Retry ${i + 1}/${retries}: Fetch error`, err);
    }
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error(`No CDP target for webContentsId ${webContentsId} after ${retries} retries`);
}

async function refreshTarget(targetId: string): Promise<CdpTarget | undefined> {
  try {
    const res = await fetch(`${getCdpBaseUrl()}/json/list`);
    const targets: CdpTarget[] = await res.json();
    return targets.find(t => t.id === targetId);
  } catch {
    return undefined;
  }
}

async function findCurrentTargetByWebContentsId(webContentsId: number): Promise<CdpTarget | undefined> {
  const hexId = webContentsId.toString(16);
  const decimalId = webContentsId.toString(10);

  try {
    const res = await fetch(`${getCdpBaseUrl()}/json`);
    const targets: CdpTarget[] = await res.json();

    return targets.find(t =>
      t.webSocketDebuggerUrl.includes(hexId) ||
      t.webSocketDebuggerUrl.includes(decimalId) ||
      t.id === hexId ||
      t.id === decimalId
    );
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

  let clientHeartbeat: HeartbeatHandle | undefined;
  let upstreamHeartbeat: HeartbeatHandle | undefined;

  const cleanup = () => {
    clearHeartbeat(clientHeartbeat);
    clearHeartbeat(upstreamHeartbeat);
    pendingToUpstream.length = 0;
  };

  clientHeartbeat = setupHeartbeat(client, `client:${profileId}`, () => {
    console.log(`[CDP:${profileId}] Client heartbeat timeout, terminating`);
    cleanup();
    upstream.terminate();
    client.terminate();
  });

  upstreamHeartbeat = setupHeartbeat(upstream, `upstream:${profileId}`, () => {
    console.log(`[CDP:${profileId}] Upstream heartbeat timeout, terminating`);
    cleanup();
    upstream.terminate();
    client.terminate();
  });

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
    cleanup();
    client.terminate();
  });

  client.on('close', () => {
    cleanup();
    upstream.terminate();
  });
  upstream.on('close', () => {
    cleanup();
    client.terminate();
  });
}

export async function startCdpProxy(
  profileId: string,
  webContentsId: number,
  externalPort: number,
): Promise<void> {
  if (proxies.has(profileId)) return;
  if (pendingProxies.has(profileId)) return;
  pendingProxies.add(profileId);

  let target: CdpTarget;

  try {
    target = await findTargetByWebContentsId(webContentsId);
  } catch (err) {
    pendingProxies.delete(profileId);
    throw err;
  }

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
        const versionRes = await fetch(`${getCdpBaseUrl()}/json/version`);
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
        const protocolRes = await fetch(`${getCdpBaseUrl()}/json/protocol`);
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
      const port = getCdpPort();
      const upstreamUrl = `ws://localhost:${port}${urlPath}`;
      console.log(`[CDP:${profileId}] Browser WS connection → filtered proxy`);
      createFilteredBrowserProxy(client, upstreamUrl, profileId, target.id);
      return;
    }

    let currentUpstreamUrl = target.webSocketDebuggerUrl;
    let upstream: WebSocket | null = new WebSocket(currentUpstreamUrl);
    let pendingToUpstream: { msg: WebSocket.RawData; isBinary: boolean }[] = [];
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelayBase = 500;

    let clientHeartbeat: HeartbeatHandle | undefined;
    let upstreamHeartbeat: HeartbeatHandle | undefined;

    const clearUpstreamHeartbeat = () => {
      if (upstreamHeartbeat) {
        clearHeartbeat(upstreamHeartbeat);
        upstreamHeartbeat = undefined;
      }
    };

    const cleanup = () => {
      clearHeartbeat(clientHeartbeat);
      clearUpstreamHeartbeat();
      pendingToUpstream.length = 0;
    };

    clientHeartbeat = setupHeartbeat(client, `page-client:${profileId}`, () => {
      console.log(`[CDP:${profileId}] Page client heartbeat timeout, terminating`);
      cleanup();
      if (upstream) upstream.terminate();
      client.terminate();
    });

    const setupUpstream = (ws: WebSocket) => {
      clearUpstreamHeartbeat();
      upstreamHeartbeat = setupHeartbeat(ws, `page-upstream:${profileId}`, () => {
        console.log(`[CDP:${profileId}] Page upstream heartbeat timeout, terminating`);
        if (ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
          ws.terminate();
        }
      });

      ws.on('open', () => {
        reconnectAttempts = 0;
        console.log(`[CDP:${profileId}] Page upstream open, flushing ${pendingToUpstream.length} queued`);
        for (const { msg, isBinary } of pendingToUpstream) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(msg, { binary: isBinary });
          }
        }
        pendingToUpstream.length = 0;
      });

      ws.on('message', (msg, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg, { binary: isBinary });
        }
      });

      ws.on('error', (err) => {
        console.error(`[CDP:${profileId}] Page upstream error:`, err.message);
      });

      ws.on('close', () => {
        console.log(`[CDP:${profileId}] Page upstream closed`);
        clearUpstreamHeartbeat();

        if (client.readyState !== WebSocket.OPEN) return;
        if (reconnectAttempts >= maxReconnectAttempts) {
          console.log(`[CDP:${profileId}] Max reconnect attempts reached, terminating client`);
          cleanup();
          client.terminate();
          return;
        }

        reconnectAttempts++;
        const delay = reconnectDelayBase * Math.pow(2, reconnectAttempts - 1);

        console.log(`[CDP:${profileId}] Attempting reconnect ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms`);

        setTimeout(async () => {
          if (client.readyState !== WebSocket.OPEN) return;

          const newTarget = await findCurrentTargetByWebContentsId(webContentsId);
          if (!newTarget) {
            console.log(`[CDP:${profileId}] No target found for reconnection, retrying...`);
            return;
          }

          currentUpstreamUrl = newTarget.webSocketDebuggerUrl;
          console.log(`[CDP:${profileId}] Reconnecting to new target:`, currentUpstreamUrl);
          upstream = new WebSocket(currentUpstreamUrl);
          setupUpstream(upstream);
        }, delay);
      });
    };

    setupUpstream(upstream);

    client.on('message', (msg, isBinary) => {
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.send(msg, { binary: isBinary });
      } else {
        pendingToUpstream.push({ msg, isBinary });
      }
    });

    client.on('close', () => {
      console.log(`[CDP:${profileId}] Page client closed`);
      cleanup();
      if (upstream) upstream.terminate();
    });
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

  pendingProxies.delete(profileId);
}

export function stopCdpProxy(profileId: string): void {
  proxies.get(profileId)?.close();
}

export function getCdpProxyPort(profileId: string): number | undefined {
  return proxies.get(profileId)?.externalPort;
}

export function getActiveProxyCount(): number {
  return proxies.size;
}
