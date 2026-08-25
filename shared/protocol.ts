/** Frames exchanged between the browser and the bridge. Shared by both sides. */

export type Qos = 0 | 1 | 2;
export type Transport = 'mqtt' | 'mqtts' | 'ws' | 'wss';
export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline' | 'error';

export interface BrokerConfig {
  protocol: Transport;
  host: string;
  port: number;
  path?: string;
  clientId?: string;
  username?: string;
  password?: string;
  rejectUnauthorized?: boolean;
  clean?: boolean;
  keepalive?: number;
  protocolVersion?: 4 | 5;
}

export interface TopicSubscription {
  topic: string;
  qos: Qos;
}

export type ClientFrame =
  | { t: 'connect'; config: BrokerConfig }
  | { t: 'subscribe'; topics: TopicSubscription[] }
  | { t: 'unsubscribe'; topics: string[] }
  | { t: 'publish'; topic: string; payload: string; encoding?: 'utf8' | 'base64'; qos: Qos; retain: boolean }
  | { t: 'disconnect' };

export interface SubackResult {
  topic: string;
  qos?: Qos;
  ok: boolean;
  error?: string;
}

/** One delivered PUBLISH. `payload` is base64 so binary survives the JSON hop. */
export interface WireMessage {
  t: 'message';
  topic: string;
  payload: string;
  size: number;
  qos: Qos;
  retain: boolean;
  dup: boolean;
  packetId: number | null;
  properties: Record<string, unknown> | null;
  ts: number;
}

export type ServerFrame =
  | { t: 'status'; state: Exclude<ConnectionState, 'idle'>; detail: string }
  | { t: 'suback'; results: SubackResult[] }
  | WireMessage
  | { t: 'published'; topic: string; size: number; ts: number }
  | { t: 'error'; message: string };

export function isQos(value: unknown): value is Qos {
  return value === 0 || value === 1 || value === 2;
}

export function toQos(value: unknown): Qos {
  return isQos(Number(value)) ? (Number(value) as Qos) : 0;
}
