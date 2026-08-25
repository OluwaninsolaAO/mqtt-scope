import React, { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { Message, Subscription } from '../types';
import { base64ToBytes, bytesToText, clockTime, duration, formatBytes, looksBinary } from '../lib/format';

const RENDER_CAP = 400;
const GAP_MS = 2000;

function previewOf(message: Message): { text: string; muted: boolean } {
  const bytes = base64ToBytes(message.payload);
  if (!bytes.length) return { text: '(empty payload)', muted: true };
  if (looksBinary(bytes)) return { text: `binary · ${formatBytes(bytes.length)}`, muted: true };
  const text = bytesToText(bytes).replace(/\s+/g, ' ').trim();
  return { text: text.length > 160 ? `${text.slice(0, 160)}…` : text, muted: false };
}

interface RowProps {
  message: Message;
  selected: boolean;
  fresh: boolean;
  onSelect: (message: Message) => void;
}

const MessageRow = memo(function MessageRow({ message, selected, fresh, onSelect }: RowProps): React.JSX.Element {
  const preview = previewOf(message);
  return (
    <li>
      <button
        type="button"
        className={`msg-row${fresh ? ' fresh' : ''}`}
        aria-current={selected}
        onClick={() => onSelect(message)}
      >
        <span className="msg-rail" />
        <span className="msg-main">
          <span className="msg-top">
            <span className="msg-topic" title={message.topic}><span>{message.topic}</span></span>
            <span className="msg-time">{clockTime(message.ts)}</span>
          </span>
          <span className="msg-preview" style={preview.muted ? { color: 'var(--faint)' } : undefined}>
            {preview.text}
          </span>
          <span className="msg-meta">
            <span className="tag qos">QoS {message.qos}</span>
            <span className="tag">{formatBytes(message.size)}</span>
            {message.retain && <span className="tag retain">retained</span>}
            {message.dup && <span className="tag dup">dup</span>}
          </span>
        </span>
      </button>
    </li>
  );
});

interface MessageListProps {
  messages: Message[];
  selectedId: number | undefined;
  onSelect: (message: Message) => void;
  query: string;
  onQuery: (value: string) => void;
  topicFilter: string;
  onTopicFilter: (value: string) => void;
  subs: Subscription[];
  paused: boolean;
  onTogglePause: () => void;
  held: number;
  onClear: () => void;
  autoScroll: boolean;
  onAutoScroll: (value: boolean) => void;
  total: number;
}

export default function MessageList({
  messages, selectedId, onSelect, query, onQuery, topicFilter, onTopicFilter,
  subs, paused, onTogglePause, held, onClear, autoScroll, onAutoScroll, total
}: MessageListProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const lastIdRef = useRef(0);

  const shown = messages.length > RENDER_CAP ? messages.slice(messages.length - RENDER_CAP) : messages;
  const newestId = messages.length ? messages[messages.length - 1]!.id : 0;

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return undefined;
    const onScroll = (): void => {
      stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || !autoScroll || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [newestId, autoScroll]);

  useEffect(() => {
    lastIdRef.current = newestId;
  }, [newestId]);

  const rows: React.JSX.Element[] = [];
  shown.forEach((message, index) => {
    const previous = index > 0 ? shown[index - 1] : undefined;
    if (previous) {
      const gap = message.ts - previous.ts;
      if (gap >= GAP_MS) {
        rows.push(
          <li className="gap-row" key={`gap-${message.id}`}>
            <span className="gap-rail" />
            <span className="gap-label">{duration(gap)} quiet</span>
          </li>
        );
      }
    }
    rows.push(
      <MessageRow
        key={message.id}
        message={message}
        selected={message.id === selectedId}
        fresh={message.id > lastIdRef.current}
        onSelect={onSelect}
      />
    );
  });

  return (
    <div className="col stream">
      <div className="col-head">
        <span className="eyebrow">Stream</span>
        <span className="spacer" />
        <button type="button" className="btn small ghost" onClick={onTogglePause}>
          {paused ? `Resume${held ? ` (${held} held)` : ''}` : 'Pause'}
        </button>
        <button type="button" className="btn small ghost danger" onClick={onClear}>Clear</button>
      </div>

      <div className="stream-filter">
        <input
          className="input"
          value={query}
          placeholder="Filter topic or payload text"
          aria-label="Filter messages"
          onChange={(event) => onQuery(event.target.value)}
        />
        <div className="row">
          <select
            className="select"
            style={{ fontSize: 12, padding: '6px 10px' }}
            value={topicFilter}
            aria-label="Limit to subscription"
            onChange={(event) => onTopicFilter(event.target.value)}
          >
            <option value="">All subscriptions</option>
            {subs.map((sub) => (
              <option key={sub.topic} value={sub.topic}>{sub.topic}</option>
            ))}
          </select>
          <label className="check" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={autoScroll} onChange={(event) => onAutoScroll(event.target.checked)} />
            Follow
          </label>
        </div>
      </div>

      <div className="col-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="empty">
            <strong>Nothing has arrived yet</strong>
            <p>
              Messages appear here the moment the broker forwards one. Check your topic filters on the right if the
              wait feels long.
            </p>
          </div>
        ) : (
          <ul className="msg-list">{rows}</ul>
        )}
      </div>

      <div className="stream-foot">
        <span>{messages.length.toLocaleString()} in view</span>
        {shown.length < messages.length && <span>· last {RENDER_CAP} drawn</span>}
        <span className="spacer" />
        <span>{total.toLocaleString()} received</span>
      </div>
    </div>
  );
}
