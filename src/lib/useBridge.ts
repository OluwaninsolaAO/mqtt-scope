import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrokerConfig, ClientFrame, ConnectionState, Qos, ServerFrame } from '../../shared/protocol';
import { toQos } from '../../shared/protocol';
import type { Message, Profile, PublishDraft, Subscription } from '../types';

const FLUSH_MS = 90;
const RETRY_MS = 2500;

function bridgeUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/bridge`;
}

/** MQTT filter matching, including the `+` single-level and `#` multi-level wildcards. */
export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  const pattern = filter.split('/');
  const parts = topic.split('/');
  for (let i = 0; i < pattern.length; i += 1) {
    const segment = pattern[i];
    if (segment === '#') return i === pattern.length - 1;
    if (i >= parts.length) return false;
    if (segment !== '+' && segment !== parts[i]) return false;
  }
  return pattern.length === parts.length;
}

export interface Bridge {
  status: ConnectionState;
  statusDetail: string;
  messages: Message[];
  subs: Subscription[];
  paused: boolean;
  held: number;
  total: number;
  rate: number;
  connect: (profile: Profile) => void;
  disconnect: () => void;
  subscribe: (topic: string, qos?: Qos) => void;
  unsubscribe: (topic: string) => void;
  publish: (draft: PublishDraft) => void;
  clear: () => void;
  pause: () => void;
  resume: () => void;
}

export function useBridge(bufferSize: number): Bridge {
  const [status, setStatus] = useState<ConnectionState>('idle');
  const [statusDetail, setStatusDetail] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(0);
  const [total, setTotal] = useState(0);
  const [rate, setRate] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Message[]>([]);
  const heldRef = useRef<Message[]>([]);
  const pausedRef = useRef(false);
  const bufferRef = useRef(bufferSize);
  const seqRef = useRef(0);
  const stampsRef = useRef<number[]>([]);
  const configRef = useRef<BrokerConfig | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  pausedRef.current = paused;
  bufferRef.current = bufferSize;

  const push = useCallback((frame: ClientFrame): boolean => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(frame));
      return true;
    }
    return false;
  }, []);

  const handle = useCallback((frame: ServerFrame): void => {
    switch (frame.t) {
      case 'status': {
        setStatus(frame.state);
        setStatusDetail(frame.detail || '');
        if (frame.state === 'online') {
          setSubs((prev) => {
            if (prev.length) push({ t: 'subscribe', topics: prev.map((sub) => ({ topic: sub.topic, qos: sub.qos })) });
            return prev.map((sub) => ({ ...sub, status: 'pending', error: '' }));
          });
        }
        break;
      }
      case 'suback': {
        setSubs((prev) =>
          prev.map((sub) => {
            const hit = frame.results.find((result) => result.topic === sub.topic);
            if (!hit) return sub;
            return {
              ...sub,
              status: hit.ok ? 'active' : 'error',
              error: hit.error ?? '',
              qos: hit.ok ? hit.qos ?? sub.qos : sub.qos
            };
          })
        );
        break;
      }
      case 'message': {
        seqRef.current += 1;
        const message: Message = { ...frame, id: seqRef.current };
        stampsRef.current.push(message.ts);
        setTotal((n) => n + 1);
        setSubs((prev) => {
          let touched = false;
          const next = prev.map((sub) => {
            if (!topicMatches(sub.topic, message.topic)) return sub;
            touched = true;
            return { ...sub, count: sub.count + 1 };
          });
          return touched ? next : prev;
        });
        if (pausedRef.current) {
          heldRef.current.push(message);
          if (heldRef.current.length > bufferRef.current) heldRef.current.shift();
          setHeld(heldRef.current.length);
        } else {
          pendingRef.current.push(message);
        }
        break;
      }
      case 'published':
        setStatusDetail(`Published to ${frame.topic}`);
        break;
      case 'error':
        setStatusDetail(frame.message);
        break;
    }
  }, [push]);

  const ensureSocket = useCallback((onOpen?: () => void): void => {
    const existing = socketRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      onOpen?.();
      return;
    }
    if (existing) try { existing.close(); } catch { /* noop */ }

    const socket = new WebSocket(bridgeUrl());
    socketRef.current = socket;

    socket.onopen = () => onOpen?.();
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setStatus((prev) => (prev === 'idle' ? prev : 'offline'));
      setStatusDetail('Bridge connection lost — retrying');
      const config = configRef.current;
      if (config) {
        clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => {
          ensureSocket(() => push({ t: 'connect', config }));
        }, RETRY_MS);
      }
    };
    socket.onerror = () => {
      setStatus('error');
      setStatusDetail('Cannot reach the bridge. Is `npm run dev` (or `npm start`) still running?');
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      handle(frame);
    };
  }, [handle, push]);

  // Batch list updates: a chatty broker can outrun React by an order of magnitude.
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingRef.current.length) {
        const batch = pendingRef.current;
        pendingRef.current = [];
        setMessages((prev) => {
          const next = prev.concat(batch);
          const cap = bufferRef.current;
          return next.length > cap ? next.slice(next.length - cap) : next;
        });
      }
      const cutoff = Date.now() - 5000;
      stampsRef.current = stampsRef.current.filter((stamp) => stamp > cutoff);
      setRate(stampsRef.current.length / 5);
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    clearTimeout(retryRef.current);
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) try { socket.close(); } catch { /* noop */ }
  }, []);

  const connect = useCallback((profile: Profile): void => {
    const config: BrokerConfig = {
      protocol: profile.protocol,
      host: profile.host,
      port: Number(profile.port),
      path: profile.path,
      clientId: profile.clientId,
      username: profile.username,
      password: profile.password,
      rejectUnauthorized: profile.rejectUnauthorized,
      clean: profile.clean,
      keepalive: Number(profile.keepalive)
    };
    configRef.current = config;
    setStatus('connecting');
    setStatusDetail('Opening bridge');
    setSubs(
      profile.topics
        .filter((entry) => entry.topic)
        .map((entry) => ({ topic: entry.topic, qos: toQos(entry.qos), status: 'pending', error: '', count: 0 }))
    );
    ensureSocket(() => push({ t: 'connect', config }));
  }, [ensureSocket, push]);

  const disconnect = useCallback((): void => {
    clearTimeout(retryRef.current);
    configRef.current = null;
    push({ t: 'disconnect' });
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) try { socket.close(); } catch { /* noop */ }
    setStatus('idle');
    setStatusDetail('');
    setSubs([]);
  }, [push]);

  const subscribe = useCallback((topic: string, qos: Qos = 0): void => {
    const clean = topic.trim();
    if (!clean) return;
    setSubs((prev) => {
      if (prev.some((sub) => sub.topic === clean)) return prev;
      return prev.concat({ topic: clean, qos, status: 'pending', error: '', count: 0 });
    });
    push({ t: 'subscribe', topics: [{ topic: clean, qos }] });
  }, [push]);

  const unsubscribe = useCallback((topic: string): void => {
    setSubs((prev) => prev.filter((sub) => sub.topic !== topic));
    push({ t: 'unsubscribe', topics: [topic] });
  }, [push]);

  const publish = useCallback((draft: PublishDraft): void => {
    push({ t: 'publish', topic: draft.topic.trim(), payload: draft.payload, qos: draft.qos, retain: draft.retain });
  }, [push]);

  const clear = useCallback((): void => {
    pendingRef.current = [];
    heldRef.current = [];
    setMessages([]);
    setHeld(0);
  }, []);

  const pause = useCallback((): void => setPaused(true), []);

  // Resuming replays what arrived while paused, so nothing is silently lost.
  const resume = useCallback((): void => {
    pendingRef.current = pendingRef.current.concat(heldRef.current);
    heldRef.current = [];
    setHeld(0);
    setPaused(false);
  }, []);

  return useMemo(
    () => ({
      status, statusDetail, messages, subs, paused, held, total, rate,
      connect, disconnect, subscribe, unsubscribe, publish, clear, pause, resume
    }),
    [status, statusDetail, messages, subs, paused, held, total, rate,
     connect, disconnect, subscribe, unsubscribe, publish, clear, pause, resume]
  );
}
