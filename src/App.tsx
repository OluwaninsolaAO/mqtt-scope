import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Setup from './components/Setup';
import MessageList from './components/MessageList';
import Inspector from './components/Inspector';
import Tools from './components/Tools';
import { useBridge, topicMatches } from './lib/useBridge';
import { loadState, saveState, newProfile, defaultPortFor, isConnectable } from './lib/storage';
import { base64ToBytes, bytesToText, looksBinary } from './lib/format';
import type { ConnectionState, Message, Profile, PublishDraft, Settings, StoredState } from './types';

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  online: 'Live',
  offline: 'Offline',
  error: 'Error'
};

/** Decoded payloads, cached so filtering does not re-decode the whole buffer. */
const searchCache = new WeakMap<Message, string>();

function searchText(message: Message): string {
  const cached = searchCache.get(message);
  if (cached !== undefined) return cached;
  const bytes = base64ToBytes(message.payload);
  const text = looksBinary(bytes) ? '' : bytesToText(bytes).toLowerCase();
  searchCache.set(message, text);
  return text;
}

export default function App(): React.JSX.Element {
  const [store, setStore] = useState<StoredState>(() => loadState());
  const active = store.profiles.find((profile) => profile.id === store.activeId);
  const [draft, setDraft] = useState<Profile>(() => (active ? { ...active } : newProfile()));
  // A reload lands straight on the dashboard when the last connection can be dialled again.
  const [view, setView] = useState<'setup' | 'dash'>(() =>
    store.settings.autoConnect && isConnectable(active) ? 'dash' : 'setup'
  );
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Message | null>(null);
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [publishDraft, setPublishDraft] = useState<PublishDraft>({ topic: '', payload: '', qos: 0, retain: false });

  const bridge = useBridge(store.settings.bufferSize);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => saveState(store), [store]);

  // Only the first render can resume; later trips to the dashboard connect on their own.
  useEffect(() => {
    if (view === 'dash') bridge.connect(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback((text: string): void => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  const setSettings = useCallback((settings: Settings): void => {
    setStore((prev) => ({ ...prev, settings }));
  }, []);

  const handleConnect = useCallback((): void => {
    const host = draft.host.trim();
    if (!host) {
      setError('Enter the broker host or IP address.');
      return;
    }
    const port = Number(draft.port) || defaultPortFor(draft.protocol);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError('Port must be a number between 1 and 65535.');
      return;
    }
    if (!draft.topics.length) {
      setError('Add at least one topic to subscribe to.');
      return;
    }

    const profile: Profile = {
      ...draft,
      host,
      port,
      id: draft.id || newProfile().id,
      name: draft.name.trim() || host
    };
    setError('');
    setDraft(profile);
    setStore((prev) => {
      const exists = prev.profiles.some((entry) => entry.id === profile.id);
      return {
        ...prev,
        activeId: profile.id,
        settings: { ...prev.settings, autoConnect: true },
        profiles: exists
          ? prev.profiles.map((entry) => (entry.id === profile.id ? profile : entry))
          : prev.profiles.concat(profile)
      };
    });
    bridge.connect(profile);
    setView('dash');
  }, [draft, bridge]);

  // Disconnecting is a decision to stop, so the next load should not dial back in.
  const handleDisconnect = useCallback((): void => {
    bridge.disconnect();
    setStore((prev) => ({ ...prev, settings: { ...prev.settings, autoConnect: false } }));
    setView('setup');
  }, [bridge]);

  const handleCopy = useCallback((text: string, note: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => say(note),
      () => say('The browser blocked clipboard access')
    );
  }, [say]);

  const handleReuse = useCallback((message: Message, text: string): void => {
    setPublishDraft({ topic: message.topic, payload: text, qos: message.qos, retain: message.retain });
    setToolsOpen(true);
    say('Loaded into the publisher');
  }, [say]);

  const handlePublish = useCallback((payload: PublishDraft): void => {
    bridge.publish(payload);
    say(`Sent to ${payload.topic.trim()}`);
  }, [bridge, say]);

  const handleExport = useCallback((): void => {
    const rows = bridge.messages.map((message) => {
      const bytes = base64ToBytes(message.payload);
      const binary = looksBinary(bytes);
      return {
        topic: message.topic,
        time: new Date(message.ts).toISOString(),
        qos: message.qos,
        retain: message.retain,
        dup: message.dup,
        size: message.size,
        payload: binary ? null : bytesToText(bytes),
        payloadBase64: binary ? message.payload : undefined
      };
    });
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mqtt-scope-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    say(`Exported ${rows.length} messages`);
  }, [bridge.messages, say]);

  const filtered = useMemo<Message[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle && !topicFilter) return bridge.messages;
    return bridge.messages.filter((message) => {
      if (topicFilter && !topicMatches(topicFilter, message.topic)) return false;
      if (!needle) return true;
      return message.topic.toLowerCase().includes(needle) || searchText(message).includes(needle);
    });
  }, [bridge.messages, query, topicFilter]);

  // Keep the inspector on the newest message until the user picks one themselves.
  const followRef = useRef(true);
  useEffect(() => {
    const newest = filtered.length ? filtered[filtered.length - 1] : undefined;
    if (followRef.current && newest) setSelected(newest);
  }, [filtered]);

  const selectMessage = useCallback((message: Message): void => {
    followRef.current = false;
    setSelected(message);
  }, []);

  const clearStream = useCallback((): void => {
    bridge.clear();
    setSelected(null);
    followRef.current = true;
  }, [bridge]);

  if (view === 'setup') {
    return (
      <Setup
        draft={draft}
        onChange={setDraft}
        profiles={store.profiles}
        onSelectProfile={(profile) => { setDraft({ ...profile }); setError(''); }}
        onDeleteProfile={(id) =>
          setStore((prev) => ({
            ...prev,
            profiles: prev.profiles.filter((entry) => entry.id !== id),
            activeId: prev.activeId === id ? null : prev.activeId
          }))
        }
        onConnect={handleConnect}
        connecting={bridge.status === 'connecting'}
        error={error}
      />
    );
  }

  const statusClass = bridge.status === 'idle' ? 'offline' : bridge.status;

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark"><b>MQTT Scope</b></div>
        <span className={`status ${statusClass}`}>
          <span className="dot" />
          {STATUS_LABEL[bridge.status]}
        </span>
        <span className={`broker${bridge.status === 'error' ? ' err' : ''}`} title={bridge.statusDetail}>
          {bridge.status === 'error'
            ? bridge.statusDetail
            : `${draft.protocol}://${draft.host}:${draft.port}${draft.username ? ` · ${draft.username}` : ''}`}
        </span>
        <span className="spacer" />
        <div className="metrics">
          <div className="metric"><b>{bridge.rate.toFixed(1)}/s</b><span>Rate</span></div>
          <div className="metric"><b>{bridge.total.toLocaleString()}</b><span>Messages</span></div>
          <div className="metric"><b>{bridge.subs.length}</b><span>Topics</span></div>
        </div>
        <button type="button" className="btn small tools-toggle" onClick={() => setToolsOpen((wasOpen) => !wasOpen)}>
          {toolsOpen ? 'Hide controls' : 'Controls'}
        </button>
      </header>

      <div className="columns">
        <MessageList
          messages={filtered}
          selectedId={selected?.id}
          onSelect={selectMessage}
          query={query}
          onQuery={setQuery}
          topicFilter={topicFilter}
          onTopicFilter={setTopicFilter}
          subs={bridge.subs}
          paused={bridge.paused}
          held={bridge.held}
          onTogglePause={() => (bridge.paused ? bridge.resume() : bridge.pause())}
          onClear={clearStream}
          autoScroll={store.settings.autoScroll}
          onAutoScroll={(autoScroll) => setSettings({ ...store.settings, autoScroll })}
          total={bridge.total}
        />

        <Inspector message={selected} onCopy={handleCopy} onReuse={handleReuse} />

        <Tools
          open={toolsOpen}
          profile={draft}
          status={bridge.status}
          statusDetail={bridge.statusDetail}
          subs={bridge.subs}
          onSubscribe={bridge.subscribe}
          onUnsubscribe={bridge.unsubscribe}
          onPublish={handlePublish}
          publishDraft={publishDraft}
          onPublishDraft={setPublishDraft}
          onEditConnection={() => setView('setup')}
          onReconnect={() => bridge.connect(draft)}
          onDisconnect={handleDisconnect}
          settings={store.settings}
          onSettings={setSettings}
          onExport={handleExport}
          onClear={clearStream}
        />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
