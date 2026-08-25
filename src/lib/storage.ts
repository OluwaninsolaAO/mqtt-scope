import type { Profile, Settings, StoredState } from '../types';
import type { Transport } from '../../shared/protocol';
import { toQos } from '../../shared/protocol';

const KEY = 'mqtt-scope.v1';

export const DEFAULT_PROFILE: Profile = {
  id: '',
  name: 'Local broker',
  protocol: 'mqtt',
  host: '127.0.0.1',
  port: 1883,
  path: '/mqtt',
  clientId: '',
  username: '',
  password: '',
  keepalive: 60,
  clean: true,
  rejectUnauthorized: true,
  rememberPassword: true,
  topics: [{ topic: '#', qos: 0 }]
};

export const DEFAULT_SETTINGS: Settings = { bufferSize: 2000, autoScroll: true, autoConnect: true };

/**
 * Whether a saved connection can be dialled without asking the user anything.
 * A username with no stored password cannot: the broker would just refuse it.
 */
export function isConnectable(profile: Profile | undefined): profile is Profile {
  if (!profile) return false;
  if (!profile.host.trim()) return false;
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) return false;
  if (!profile.topics.length) return false;
  return !profile.username || Boolean(profile.password);
}

function blank(): StoredState {
  return { profiles: [], activeId: null, settings: { ...DEFAULT_SETTINGS } };
}

function hydrate(raw: unknown): Profile {
  const source = (raw ?? {}) as Partial<Profile>;
  const topics = Array.isArray(source.topics) && source.topics.length
    ? source.topics.map((entry) => ({ topic: String(entry.topic ?? ''), qos: toQos(entry.qos) })).filter((entry) => entry.topic)
    : [...DEFAULT_PROFILE.topics];
  return { ...DEFAULT_PROFILE, ...source, topics };
}

export function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles.map(hydrate) : [],
      activeId: parsed.activeId ?? null,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
    };
  } catch {
    return blank();
  }
}

export function saveState(state: StoredState): void {
  try {
    const profiles = state.profiles.map((profile) => ({
      ...profile,
      password: profile.rememberPassword ? profile.password : ''
    }));
    localStorage.setItem(KEY, JSON.stringify({ ...state, profiles }));
  } catch {
    /* storage full or blocked — the session keeps working in memory */
  }
}

export function newProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...DEFAULT_PROFILE,
    ...overrides,
    id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    clientId: overrides.clientId || `mqtt-scope-${Math.random().toString(16).slice(2, 8)}`
  };
}

const DEFAULT_PORTS: Record<Transport, number> = { mqtt: 1883, mqtts: 8883, ws: 8083, wss: 8084 };

export function defaultPortFor(protocol: Transport): number {
  return DEFAULT_PORTS[protocol] ?? 1883;
}
