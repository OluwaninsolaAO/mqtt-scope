import React, { useState } from 'react';
import type { JsonValue } from '../lib/format';

function Leaf({ value }: { value: JsonValue }): React.JSX.Element {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-number">{String(value)}</span>;
  if (typeof value === 'boolean') return <span className="json-boolean">{String(value)}</span>;
  return <span className="json-null">{String(value)}</span>;
}

interface NodeProps {
  name?: string | number;
  value: JsonValue;
  depth: number;
  inArray?: boolean;
}

function Node({ name, value, depth, inArray = false }: NodeProps): React.JSX.Element {
  const isArray = Array.isArray(value);
  const isBranch = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < 2);

  const label = name === undefined ? null : (
    <>
      <span className="json-key">{inArray ? name : `"${name}"`}</span>
      <span className="json-punct">: </span>
    </>
  );

  if (!isBranch) {
    return (
      <div className="json-node">
        {label}
        <Leaf value={value} />
      </div>
    );
  }

  const entries: [string | number, JsonValue][] = isArray
    ? (value as JsonValue[]).map((item, index) => [index, item])
    : Object.entries(value as { [key: string]: JsonValue });
  const openBrace = isArray ? '[' : '{';
  const closeBrace = isArray ? ']' : '}';

  return (
    <div className="json-node">
      <button type="button" className="json-toggle" aria-expanded={open} onClick={() => setOpen((wasOpen) => !wasOpen)}>
        {open ? '▾' : '▸'}
      </button>
      {label}
      <span className="json-punct">{openBrace}</span>
      {!open && <span className="json-count"> {entries.length} {entries.length === 1 ? 'item' : 'items'} </span>}
      {!open && <span className="json-punct">{closeBrace}</span>}
      {open && (
        <>
          <div className="json-children">
            {entries.map(([key, item]) => (
              <Node key={key} name={key} value={item} depth={depth + 1} inArray={isArray} />
            ))}
          </div>
          <span className="json-punct">{closeBrace}</span>
        </>
      )}
    </div>
  );
}

export default function JsonTree({ data }: { data: JsonValue }): React.JSX.Element {
  return <Node value={data} depth={0} />;
}
