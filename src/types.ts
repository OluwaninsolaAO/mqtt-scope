import type { BrokerConfig, ConnectionState, Qos, TopicSubscription, WireMessage } from '../shared/protocol';

/** A saved connection: everything the bridge needs, plus what the UI remembers. */
export interface Profile extends BrokerConfig {
  id: string;
  name: string;
  path: string;
  clientId: string;
  username: string;
  password: string;
  keepalive: number;
  clean: boolean;
  rejectUnauthorized: boolean;
  rememberPassword: boolean;
  topics: TopicSubscription[];
}

export interface Settings {
  bufferSize: number;
  autoScroll: boolean;
  /** Reconnect to the last used connection when the page loads. */
  autoConnect: boolean;
}

export interface StoredState {
  profiles: Profile[];
  activeId: string | null;
  settings: Settings;
}

/** A received message, numbered in arrival order so the UI has a stable key. */
export interface Message extends WireMessage {
  id: number;
}

export type SubscriptionState = 'pending' | 'active' | 'error';

export interface Subscription {
  topic: string;
  qos: Qos;
  status: SubscriptionState;
  error: string;
  count: number;
}

export interface PublishDraft {
  topic: string;
  payload: string;
  qos: Qos;
  retain: boolean;
}

export type { ConnectionState, Qos, TopicSubscription };
