import React, { useMemo, useState } from 'react';
import JsonTree from './JsonTree';
import type { Message } from '../types';
import {
  base64ToBytes, bytesToText, clockTime, formatBytes, fullTime,
  hexDump, isWildcard, looksBinary, parseJson, topicSegments, type ParsedJson
} from '../lib/format';

const LEVEL_CLASS = ['lvl0', 'lvl1', 'lvl2', 'lvl3'];
type Tab = 'auto' | 'json' | 'text' | 'hex' | 'props';

interface Decoded {
  bytes: Uint8Array;
  binary: boolean;
  text: string;
  json: ParsedJson;
}

interface InspectorProps {
  message: Message | null;
  onCopy: (text: string, note: string) => void;
  onReuse: (message: Message, text: string) => void;
}

export default function Inspector({ message, onCopy, onReuse }: InspectorProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('auto');

  const decoded = useMemo<Decoded | null>(() => {
    if (!message) return null;
    const bytes = base64ToBytes(message.payload);
    const binary = looksBinary(bytes);
    const text = binary ? '' : bytesToText(bytes);
    return { bytes, binary, text, json: binary ? { ok: false } : parseJson(text) };
  }, [message]);

  if (!message || !decoded) {
    return (
      <div className="col inspect">
        <div className="empty">
          <strong>Pick a message</strong>
          <p>Select anything in the stream to see its payload, its flags, and the exact packet the broker delivered.</p>
        </div>
      </div>
    );
  }

  const view: Exclude<Tab, 'auto'> = tab === 'auto'
    ? (decoded.json.ok ? 'json' : decoded.binary ? 'hex' : 'text')
    : tab;
  const dump = view === 'hex' ? hexDump(decoded.bytes) : null;

  return (
    <div className="col inspect">
      <div className="inspector">
        <div className="insp-head">
          <span className="eyebrow">Message #{message.id}</span>
          <h2 className="insp-topic">
            {topicSegments(message.topic).map((segment, index, all) => (
              <React.Fragment key={index}>
                <span className={`seg-name ${isWildcard(segment) ? 'wild' : LEVEL_CLASS[index % LEVEL_CLASS.length] ?? ''}`}>
                  {segment}
                </span>
                {index < all.length - 1 && <span className="slash">/</span>}
              </React.Fragment>
            ))}
          </h2>
        </div>

        <div className="insp-facts">
          <div className="fact"><span>Arrived</span><b>{clockTime(message.ts)}</b></div>
          <div className="fact"><span>Timestamp</span><b>{fullTime(message.ts)}</b></div>
          <div className="fact"><span>QoS</span><b>{message.qos}</b></div>
          <div className="fact"><span>Retained</span><b className={message.retain ? 'on' : 'off'}>{message.retain ? 'yes' : 'no'}</b></div>
          <div className="fact"><span>Duplicate</span><b className={message.dup ? 'on' : 'off'}>{message.dup ? 'yes' : 'no'}</b></div>
          <div className="fact"><span>Size</span><b>{formatBytes(message.size)}</b></div>
          <div className="fact"><span>Packet ID</span><b>{message.packetId ?? '—'}</b></div>
          <div className="fact"><span>Payload</span><b>{decoded.binary ? 'binary' : decoded.json.ok ? 'JSON' : 'text'}</b></div>
        </div>

        <div className="tabs" role="tablist">
          {decoded.json.ok && (
            <button type="button" role="tab" aria-selected={view === 'json'} onClick={() => setTab('json')}>JSON</button>
          )}
          <button type="button" role="tab" aria-selected={view === 'text'} onClick={() => setTab('text')}>Text</button>
          <button type="button" role="tab" aria-selected={view === 'hex'} onClick={() => setTab('hex')}>Hex</button>
          {message.properties && (
            <button type="button" role="tab" aria-selected={view === 'props'} onClick={() => setTab('props')}>Properties</button>
          )}
          <span className="spacer" />
          <button type="button" className="btn small ghost" onClick={() => onCopy(message.topic, 'Topic copied')}>
            Copy topic
          </button>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => onCopy(decoded.text, 'Payload copied')}
            disabled={decoded.binary}
          >
            Copy payload
          </button>
          <button type="button" className="btn small ghost" onClick={() => onReuse(message, decoded.text)}>
            Send to publisher
          </button>
        </div>

        <div className="insp-body">
          {view === 'json' && decoded.json.ok && <JsonTree data={decoded.json.value} />}
          {view === 'text' && (
            decoded.binary
              ? <p className="tool-note">This payload contains bytes that are not printable text. Switch to Hex to read it.</p>
              : <pre className="payload">{decoded.text || '(empty payload)'}</pre>
          )}
          {view === 'hex' && dump && (
            <div className="hex">
              {dump.rows.map((row) => (
                <div className="hex-row" key={row.offset}>
                  <span className="off">{row.offset}</span>
                  <span className="bytes">{row.hex}</span>
                  <span className="ascii">{row.ascii}</span>
                </div>
              ))}
              {dump.truncated && <p className="tool-note">Showing the first 8 KB.</p>}
            </div>
          )}
          {view === 'props' && message.properties && (
            <table className="props">
              <tbody>
                {Object.entries(message.properties).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
