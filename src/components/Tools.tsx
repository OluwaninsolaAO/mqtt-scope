import React, { useState } from 'react';
import { toQos } from '../../shared/protocol';
import type { ConnectionState, Profile, PublishDraft, Qos, Settings, Subscription } from '../types';
import { isWildcard, topicSegments } from '../lib/format';

type SectionId = 'connection' | 'subs' | 'publish' | 'capture';

interface SectionProps {
  id: SectionId;
  title: string;
  count?: number;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}

function Section({ id, title, count, open, onToggle, children }: SectionProps): React.JSX.Element {
  return (
    <section className="tool-section">
      <button
        type="button"
        className="tool-head"
        aria-expanded={open}
        aria-controls={`sec-${id}`}
        onClick={() => onToggle(id)}
      >
        <span className="caret">▶</span>
        <span className="title">{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </button>
      {open && <div className="tool-body" id={`sec-${id}`}>{children}</div>}
    </section>
  );
}

function TopicName({ topic }: { topic: string }): React.JSX.Element {
  return (
    <>
      {topicSegments(topic).map((segment, index, all) => (
        <React.Fragment key={index}>
          <span className={isWildcard(segment) ? 'wild' : undefined}>{segment}</span>
          {index < all.length - 1 && '/'}
        </React.Fragment>
      ))}
    </>
  );
}

interface ToolsProps {
  open: boolean;
  profile: Profile;
  status: ConnectionState;
  statusDetail: string;
  subs: Subscription[];
  onSubscribe: (topic: string, qos: Qos) => void;
  onUnsubscribe: (topic: string) => void;
  onPublish: (draft: PublishDraft) => void;
  publishDraft: PublishDraft;
  onPublishDraft: (draft: PublishDraft) => void;
  onEditConnection: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onExport: () => void;
  onClear: () => void;
}

const BUFFER_SIZES = [200, 500, 1000, 2000, 5000, 10000];

export default function Tools({
  open, profile, status, statusDetail, subs, onSubscribe, onUnsubscribe,
  onPublish, onEditConnection, onReconnect, onDisconnect,
  settings, onSettings, onExport, onClear, publishDraft, onPublishDraft
}: ToolsProps): React.JSX.Element {
  const [sections, setSections] = useState<Record<SectionId, boolean>>({
    connection: true, subs: true, publish: false, capture: false
  });
  const [newTopic, setNewTopic] = useState('');
  const [newQos, setNewQos] = useState<Qos>(0);

  const toggle = (id: SectionId): void => setSections((prev) => ({ ...prev, [id]: !prev[id] }));
  const setDraft = (patch: Partial<PublishDraft>): void => onPublishDraft({ ...publishDraft, ...patch });

  const addSub = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!newTopic.trim()) return;
    onSubscribe(newTopic.trim(), newQos);
    setNewTopic('');
  };

  return (
    <aside className="col tools" data-open={open}>
      <div className="col-head">
        <span className="eyebrow">Controls</span>
      </div>
      <div className="col-body">
        <Section id="connection" title="Connection" open={sections.connection} onToggle={toggle}>
          <div className="field">
            <label htmlFor="tool-broker">Broker</label>
            <input id="tool-broker" className="input" readOnly value={`${profile.protocol}://${profile.host}:${profile.port}`} />
          </div>
          <div className="field">
            <label htmlFor="tool-client">Client ID</label>
            <input id="tool-client" className="input" readOnly value={profile.clientId} />
          </div>
          <p className="tool-note">{statusDetail || 'No events since connecting.'}</p>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoConnect}
              onChange={(event) => onSettings({ ...settings, autoConnect: event.target.checked })}
            />
            Reconnect when this page loads
          </label>
          <div className="row-actions">
            <button type="button" className="btn small" onClick={onEditConnection}>Edit credentials</button>
            <button type="button" className="btn small" onClick={onReconnect} disabled={status === 'connecting'}>
              Reconnect
            </button>
          </div>
          <button type="button" className="btn small ghost danger" onClick={onDisconnect}>Disconnect</button>
        </Section>

        <Section id="subs" title="Subscriptions" count={subs.length} open={sections.subs} onToggle={toggle}>
          <form className="field" onSubmit={addSub}>
            <label htmlFor="new-topic">Add a topic filter</label>
            <input
              id="new-topic"
              className="input"
              value={newTopic}
              placeholder="devices/+/status"
              onChange={(event) => setNewTopic(event.target.value)}
            />
            <div className="row-2">
              <select
                className="select"
                value={newQos}
                aria-label="QoS for new subscription"
                onChange={(event) => setNewQos(toQos(event.target.value))}
              >
                <option value={0}>QoS 0</option>
                <option value={1}>QoS 1</option>
                <option value={2}>QoS 2</option>
              </select>
              <button type="submit" className="btn small primary">Subscribe</button>
            </div>
          </form>

          <div className="sub-list">
            {subs.length === 0 && <p className="tool-note">Not subscribed to anything, so nothing will arrive.</p>}
            {subs.map((sub) => (
              <div className={`sub-item${sub.status === 'error' ? ' dead' : ''}`} key={sub.topic}>
                <span className="s-topic" title={sub.topic}><TopicName topic={sub.topic} /></span>
                <span className="s-count">{sub.status === 'pending' ? '…' : `${sub.count} · Q${sub.qos}`}</span>
                <button type="button" className="btn small ghost danger" onClick={() => onUnsubscribe(sub.topic)}>Drop</button>
                {sub.error && <span className="s-err">{sub.error}</span>}
              </div>
            ))}
          </div>
        </Section>

        <Section id="publish" title="Publish" open={sections.publish} onToggle={toggle}>
          <div className="field">
            <label htmlFor="pub-topic">Topic</label>
            <input
              id="pub-topic"
              className="input"
              value={publishDraft.topic}
              placeholder="devices/lamp-1/set"
              onChange={(event) => setDraft({ topic: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="pub-body">Payload</label>
            <textarea
              id="pub-body"
              className="textarea"
              value={publishDraft.payload}
              placeholder='{"state":"on"}'
              onChange={(event) => setDraft({ payload: event.target.value })}
            />
          </div>
          <div className="row-2">
            <select
              className="select"
              value={publishDraft.qos}
              aria-label="Publish QoS"
              onChange={(event) => setDraft({ qos: toQos(event.target.value) })}
            >
              <option value={0}>QoS 0</option>
              <option value={1}>QoS 1</option>
              <option value={2}>QoS 2</option>
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={publishDraft.retain}
                onChange={(event) => setDraft({ retain: event.target.checked })}
              />
              Retain
            </label>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={status !== 'online' || !publishDraft.topic.trim()}
            onClick={() => onPublish(publishDraft)}
          >
            Publish message
          </button>
          <p className="tool-note">Wildcards are not allowed in a publish topic.</p>
        </Section>

        <Section id="capture" title="Capture" open={sections.capture} onToggle={toggle}>
          <div className="field">
            <label htmlFor="buffer">Keep the last</label>
            <select
              id="buffer"
              className="select"
              value={settings.bufferSize}
              onChange={(event) => onSettings({ ...settings, bufferSize: Number(event.target.value) })}
            >
              {BUFFER_SIZES.map((size) => (
                <option key={size} value={size}>{size.toLocaleString()} messages</option>
              ))}
            </select>
            <span className="hint">Older messages fall off the top once the buffer is full.</span>
          </div>
          <div className="row-actions">
            <button type="button" className="btn small" onClick={onExport}>Export JSON</button>
            <button type="button" className="btn small ghost danger" onClick={onClear}>Clear stream</button>
          </div>
        </Section>
      </div>
    </aside>
  );
}
