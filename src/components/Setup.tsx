import React, { useMemo, useState } from 'react';
import type { Transport } from '../../shared/protocol';
import { toQos } from '../../shared/protocol';
import type { Profile, Qos } from '../types';
import { defaultPortFor } from '../lib/storage';
import { isWildcard, topicSegments } from '../lib/format';

const TRANSPORTS: { id: Transport; label: string; note: string }[] = [
  { id: 'mqtt', label: 'mqtt', note: 'Plain TCP' },
  { id: 'mqtts', label: 'mqtts', note: 'TLS over TCP' },
  { id: 'ws', label: 'ws', note: 'WebSocket' },
  { id: 'wss', label: 'wss', note: 'WebSocket over TLS' }
];

function TopicName({ topic }: { topic: string }): React.JSX.Element {
  return (
    <>
      {topicSegments(topic).map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="slash">/</span>}
          <span className={isWildcard(segment) ? 'wild' : undefined}>{segment}</span>
        </React.Fragment>
      ))}
    </>
  );
}

interface SetupProps {
  draft: Profile;
  onChange: (profile: Profile) => void;
  profiles: Profile[];
  onSelectProfile: (profile: Profile) => void;
  onDeleteProfile: (id: string) => void;
  onConnect: () => void;
  connecting: boolean;
  error: string;
}

export default function Setup({
  draft, onChange, profiles, onSelectProfile, onDeleteProfile, onConnect, connecting, error
}: SetupProps): React.JSX.Element {
  const [topicInput, setTopicInput] = useState('');
  const [topicQos, setTopicQos] = useState<Qos>(0);
  const set = (patch: Partial<Profile>): void => onChange({ ...draft, ...patch });

  const isWs = draft.protocol === 'ws' || draft.protocol === 'wss';
  const isTls = draft.protocol === 'mqtts' || draft.protocol === 'wss';

  const url = useMemo(() => {
    const host = draft.host.trim() || 'broker.host';
    const auth = draft.username ? `${draft.username}${draft.password ? ':••••' : ''}@` : '';
    return {
      scheme: draft.protocol,
      auth,
      host,
      port: draft.port || defaultPortFor(draft.protocol),
      path: isWs ? draft.path || '/mqtt' : ''
    };
  }, [draft, isWs]);

  const addTopic = (): void => {
    const topic = topicInput.trim();
    if (!topic) return;
    if (!draft.topics.some((entry) => entry.topic === topic)) {
      set({ topics: draft.topics.concat({ topic, qos: topicQos }) });
    }
    setTopicInput('');
  };

  const removeTopic = (topic: string): void => set({ topics: draft.topics.filter((entry) => entry.topic !== topic) });
  const setTopicQosAt = (topic: string, qos: Qos): void =>
    set({ topics: draft.topics.map((entry) => (entry.topic === topic ? { ...entry, qos } : entry)) });

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="wordmark">
          <b>MQTT Scope</b>
          <span>message inspector</span>
        </div>

        <h1>
          Point it at a broker.<br />
          Watch every message <em>land</em>.
        </h1>
        <p className="lede">
          Credentials stay in this browser. The bridge that runs alongside this page holds the real broker
          connection, so plain TCP brokers work without enabling a WebSocket listener.
        </p>

        <div className="urlbar">
          <span className="eyebrow">Target</span>
          <div className="url">
            <span className="u-scheme">{url.scheme}</span>
            <span className="u-muted">://</span>
            {url.auth && <span className="u-auth">{url.auth}</span>}
            <span className={draft.host ? 'u-host' : 'u-muted'}>{url.host}</span>
            <span className="u-muted">:</span>
            <span className="u-port">{url.port}</span>
            {url.path && <span className="u-path">{url.path}</span>}
          </div>
        </div>

        {profiles.length > 0 && (
          <div className="profiles">
            {profiles.map((profile) => (
              <span
                key={profile.id}
                className="profile-chip"
                role="button"
                tabIndex={0}
                onClick={() => onSelectProfile(profile)}
                onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelectProfile(profile)}
              >
                {profile.name || profile.host}
                <button
                  type="button"
                  className="x"
                  aria-label={`Delete saved connection ${profile.name || profile.host}`}
                  onClick={(event) => { event.stopPropagation(); onDeleteProfile(profile.id); }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConnect();
          }}
        >
          <div className="card">
            <h2>Broker</h2>
            <div className="grid">
              <div className="field">
                <label htmlFor="transport">Transport</label>
                <div className="seg" id="transport">
                  {TRANSPORTS.map((transport) => (
                    <button
                      key={transport.id}
                      type="button"
                      aria-pressed={draft.protocol === transport.id}
                      title={transport.note}
                      onClick={() => set({ protocol: transport.id, port: defaultPortFor(transport.id) })}
                    >
                      {transport.label}
                    </button>
                  ))}
                </div>
                <span className="hint">{TRANSPORTS.find((transport) => transport.id === draft.protocol)?.note}</span>
              </div>

              <div className={isWs ? 'grid transport' : 'grid host'}>
                <div className="field">
                  <label htmlFor="host">Host or IP</label>
                  <input
                    id="host"
                    className="input"
                    value={draft.host}
                    placeholder="10.0.0.42"
                    autoComplete="off"
                    onChange={(event) => set({ host: event.target.value })}
                  />
                </div>
                {isWs && (
                  <div className="field">
                    <label htmlFor="path">Path</label>
                    <input
                      id="path"
                      className="input"
                      value={draft.path}
                      placeholder="/mqtt"
                      onChange={(event) => set({ path: event.target.value })}
                    />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="port">Port</label>
                  <input
                    id="port"
                    className="input"
                    type="number"
                    min="1"
                    max="65535"
                    value={draft.port}
                    onChange={(event) => set({ port: Number(event.target.value) })}
                  />
                </div>
              </div>

              <div className="grid cols-2">
                <div className="field">
                  <label htmlFor="username">Username</label>
                  <input
                    id="username"
                    className="input"
                    value={draft.username}
                    placeholder="optional"
                    autoComplete="off"
                    onChange={(event) => set({ username: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    value={draft.password}
                    placeholder="optional"
                    autoComplete="new-password"
                    onChange={(event) => set({ password: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid cols-2">
                <div className="field">
                  <label htmlFor="clientId">Client ID</label>
                  <input
                    id="clientId"
                    className="input"
                    value={draft.clientId}
                    onChange={(event) => set({ clientId: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="name">Save this connection as</label>
                  <input
                    id="name"
                    className="input"
                    value={draft.name}
                    placeholder="Shop floor gateway"
                    onChange={(event) => set({ name: event.target.value })}
                  />
                </div>
              </div>

              <div className="grid cols-2">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={draft.rememberPassword}
                    onChange={(event) => set({ rememberPassword: event.target.checked })}
                  />
                  Keep the password in this browser
                </label>
                <label className="check">
                  <input type="checkbox" checked={draft.clean} onChange={(event) => set({ clean: event.target.checked })} />
                  Start a clean session
                </label>
                {isTls && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!draft.rejectUnauthorized}
                      onChange={(event) => set({ rejectUnauthorized: !event.target.checked })}
                    />
                    Accept self-signed certificates
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Topics to subscribe</h2>
            <div className="topic-editor">
              <div className="topic-add">
                <input
                  className="input"
                  value={topicInput}
                  placeholder="sensors/+/temperature"
                  aria-label="Topic filter"
                  onChange={(event) => setTopicInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    addTopic();
                  }}
                />
                <select
                  className="select"
                  value={topicQos}
                  aria-label="QoS"
                  onChange={(event) => setTopicQos(toQos(event.target.value))}
                >
                  <option value={0}>QoS 0</option>
                  <option value={1}>QoS 1</option>
                  <option value={2}>QoS 2</option>
                </select>
                <button type="button" className="btn" onClick={addTopic}>Add topic</button>
              </div>

              <div className="topic-rows">
                {draft.topics.length === 0 && (
                  <p className="tool-note">
                    No topics yet. Add at least one — <code>#</code> catches everything the broker will give you.
                  </p>
                )}
                {draft.topics.map((entry) => (
                  <div className="topic-row" key={entry.topic}>
                    <span className="t-name"><TopicName topic={entry.topic} /></span>
                    <select
                      className="select"
                      style={{ width: 92 }}
                      value={entry.qos}
                      aria-label={`QoS for ${entry.topic}`}
                      onChange={(event) => setTopicQosAt(entry.topic, toQos(event.target.value))}
                    >
                      <option value={0}>QoS 0</option>
                      <option value={1}>QoS 1</option>
                      <option value={2}>QoS 2</option>
                    </select>
                    <button type="button" className="btn small ghost danger" onClick={() => removeTopic(entry.topic)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <p className="tool-note">
                <code>+</code> matches one level, <code>#</code> matches the rest of the tree. You can add or drop
                topics later without reconnecting.
              </p>
            </div>
          </div>

          {error && <div className="banner">{error}</div>}

          <div className="setup-actions">
            <p className="note">
              Nothing is sent anywhere but your broker. Saved connections live in this browser's local storage.
            </p>
            <button type="submit" className="btn primary" disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect and watch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
