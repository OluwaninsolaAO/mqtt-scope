/**
 * MQTT Scope bridge.
 *
 * A browser cannot open a raw TCP socket, so it can only reach brokers that
 * expose an MQTT-over-WebSocket listener. This process removes that limit:
 * the page talks JSON over a WebSocket to us, and we hold the real MQTT
 * connection using any transport the broker supports (tcp/tls/ws/wss).
 *
 * One browser socket == one broker connection. Credentials are never stored
 * here; they arrive with the connect frame and live only in memory.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import mqtt, { type IClientOptions, type IConnackPacket, type IPublishPacket, type ISubscriptionGrant, type MqttClient } from 'mqtt';
import type { BrokerConfig, ClientFrame, ConnectionState, ServerFrame, SubackResult, TopicSubscription } from '../shared/protocol.js';
import { toQos } from '../shared/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

/** Works whether this file runs from source (tsx) or from build/server (tsc). */
function findDist(): string {
  let dir = here;
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'dist');
    dir = path.dirname(dir);
  }
  return path.join(here, '..', 'dist');
}

const dist = findDist();
const app = express();
app.use(express.static(dist));
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => {
  const page = path.join(dist, 'index.html');
  if (!fs.existsSync(page)) {
    res.status(503).type('text/plain').send('The interface has not been built yet. Run: npm run build');
    return;
  }
  res.sendFile(page);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/bridge' });

const TRANSPORTS = new Set<BrokerConfig['protocol']>(['mqtt', 'mqtts', 'ws', 'wss']);

function normalisePath(value: string | undefined): string {
  const raw = String(value ?? '/mqtt').trim() || '/mqtt';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function buildUrl(config: BrokerConfig): string {
  const protocol = TRANSPORTS.has(config.protocol) ? config.protocol : 'mqtt';
  const host = String(config.host ?? '').trim();
  if (!host) throw new Error('Broker host is required');
  const port = Number(config.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Broker port must be between 1 and 65535');
  }
  const suffix = protocol.startsWith('ws') ? normalisePath(config.path) : '';
  const bare = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${protocol}://${bare}:${port}${suffix}`;
}

function serialiseProperties(properties: IPublishPacket['properties']): Record<string, unknown> | null {
  if (!properties) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null) continue;
    out[key] = Buffer.isBuffer(value) ? value.toString('utf8') : value;
  }
  return Object.keys(out).length ? out : null;
}

wss.on('connection', (socket: WebSocket) => {
  let client: MqttClient | null = null;
  let closing = false;

  const send = (frame: ServerFrame): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
  };
  const status = (state: Exclude<ConnectionState, 'idle'>, detail = ''): void => send({ t: 'status', state, detail });

  const teardown = (): void => {
    closing = true;
    if (client) {
      const dying = client;
      client = null;
      try { dying.end(true); } catch { /* already gone */ }
    }
  };

  function open(config: BrokerConfig): void {
    teardown();
    closing = false;

    let url: string;
    try {
      url = buildUrl(config);
    } catch (err) {
      status('error', err instanceof Error ? err.message : String(err));
      return;
    }

    status('connecting', url);
    const options: IClientOptions = {
      clientId: config.clientId || `mqtt-scope-${Math.random().toString(16).slice(2, 10)}`,
      clean: config.clean !== false,
      keepalive: Number(config.keepalive) > 0 ? Number(config.keepalive) : 60,
      reconnectPeriod: 4000,
      connectTimeout: 12000,
      protocolVersion: config.protocolVersion === 5 ? 5 : 4
    };
    if (config.username) options.username = config.username;
    if (config.password) options.password = config.password;
    if (config.protocol === 'mqtts' || config.protocol === 'wss') {
      options.rejectUnauthorized = config.rejectUnauthorized !== false;
    }

    let opened: MqttClient;
    try {
      opened = mqtt.connect(url, options);
    } catch (err) {
      status('error', err instanceof Error ? err.message : String(err));
      return;
    }
    client = opened;
    let lastError = '';

    opened.on('connect', (packet: IConnackPacket) => {
      lastError = '';
      status('online', `${url}${packet?.sessionPresent ? ' · session resumed' : ''}`);
    });
    opened.on('reconnect', () => status('connecting', 'Reconnecting'));
    // A close right after an error is the same event to a human: report the cause.
    opened.on('close', () => {
      if (closing) return;
      if (lastError) status('error', lastError);
      else status('offline', 'Connection closed');
    });
    opened.on('offline', () => {
      if (!closing || lastError) status(lastError ? 'error' : 'offline', lastError || 'Broker unreachable');
    });
    opened.on('error', (err: Error & { code?: number }) => {
      lastError = err?.message ?? String(err);
      status('error', lastError);
      // Bad credentials or a rejected client ID will never succeed on retry.
      if (err?.code === 2 || err?.code === 4 || err?.code === 5) {
        closing = true;
        try { opened.end(true); } catch { /* already gone */ }
        client = null;
      }
    });

    opened.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) => {
      send({
        t: 'message',
        topic,
        payload: payload.toString('base64'),
        size: payload.length,
        qos: toQos(packet.qos),
        retain: Boolean(packet.retain),
        dup: Boolean(packet.dup),
        packetId: packet.messageId ?? null,
        properties: serialiseProperties(packet.properties),
        ts: Date.now()
      });
    });
  }

  function subscribe(topics: TopicSubscription[]): void {
    if (!client) {
      status('error', 'Subscribe ignored: not connected');
      return;
    }
    const wanted = topics
      .map((entry) => ({ topic: String(entry.topic ?? '').trim(), qos: toQos(entry.qos) }))
      .filter((entry) => entry.topic.length > 0);
    if (!wanted.length) return;

    const map = Object.fromEntries(wanted.map((entry) => [entry.topic, { qos: entry.qos }]));
    client.subscribe(map, (err: Error | null, granted?: ISubscriptionGrant[]) => {
      if (err) {
        send({ t: 'suback', results: wanted.map((entry) => ({ topic: entry.topic, ok: false, error: err.message })) });
        return;
      }
      const results: SubackResult[] = (granted ?? []).map((grant) => {
        const code = Number(grant.qos);
        return code > 2
          ? { topic: grant.topic, ok: false, error: `Broker refused (code ${code})` }
          : { topic: grant.topic, ok: true, qos: toQos(code) };
      });
      send({ t: 'suback', results });
    });
  }

  function unsubscribe(topics: string[]): void {
    if (!client) return;
    const list = topics.map((topic) => String(topic)).filter(Boolean);
    if (list.length) client.unsubscribe(list);
  }

  function publish(frame: Extract<ClientFrame, { t: 'publish' }>): void {
    if (!client) {
      status('error', 'Publish ignored: not connected');
      return;
    }
    const topic = String(frame.topic ?? '').trim();
    if (!topic) {
      send({ t: 'error', message: 'Publish needs a topic' });
      return;
    }
    const body = Buffer.from(String(frame.payload ?? ''), frame.encoding === 'base64' ? 'base64' : 'utf8');
    client.publish(topic, body, { qos: toQos(frame.qos), retain: Boolean(frame.retain) }, (err) => {
      if (err) send({ t: 'error', message: `Publish failed: ${err.message}` });
      else send({ t: 'published', topic, size: body.length, ts: Date.now() });
    });
  }

  socket.on('message', (raw: RawData) => {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString()) as ClientFrame;
    } catch {
      send({ t: 'error', message: 'Bridge received a frame that was not JSON' });
      return;
    }

    switch (frame.t) {
      case 'connect': return open(frame.config);
      case 'subscribe': return subscribe(frame.topics ?? []);
      case 'unsubscribe': return unsubscribe(frame.topics ?? []);
      case 'publish': return publish(frame);
      case 'disconnect': return teardown();
      default:
        send({ t: 'error', message: `Unknown frame "${(frame as { t: string }).t}"` });
    }
  });

  socket.on('close', teardown);
  socket.on('error', teardown);
});

server.listen(PORT, HOST, () => {
  console.log(`MQTT Scope is on http://${HOST}:${PORT}`);
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.log('No build found yet — run `npm run build`, or use `npm run dev` for the live-reloading interface.');
  }
});
