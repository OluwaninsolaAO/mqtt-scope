# Contributing to MQTT Scope

Thanks for taking a look. This is a small, focused tool: it subscribes to MQTT topics and
shows you what arrives. Changes that keep it small and focused get merged fastest.

## Getting set up

```bash
npm install
npm run dev
```

`npm run dev` starts two things: the bridge on port 8787 (through `tsx`, restarting when you
edit it) and Vite on <http://localhost:5180> with hot reload. Use the Vite URL while working
on the interface — it proxies `/bridge` to the bridge process.

To check what users will actually run:

```bash
npm start
```

That builds both halves and serves them from port 8787.

## A broker to test against

You need something publishing. The quickest throwaway:

```bash
docker run --rm -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
```

Then connect the app to `mqtt://127.0.0.1:1883` with no credentials, subscribe to `#`, and
publish to yourself from the Publish panel on the right.

Please do not develop against a production broker. Wildcard subscriptions on a busy fleet
pull a lot of traffic, and the Publish panel writes for real.

## Before you open a pull request

```bash
npm run typecheck
```

That builds all three TypeScript projects (browser, bridge, Vite config). CI runs the same
command plus a full build and a Docker image build, so a green local run usually means a
green pipeline.

Include a screenshot for anything that changes the interface. It is the fastest way to
review a layout change, and the reason most UI pull requests stall is that nobody can
picture the result.

## How the code is arranged

```
shared/protocol.ts     frame types shared by the page and the bridge
server/index.ts        WebSocket-to-MQTT bridge
src/App.tsx            screen state, filtering, export
src/types.ts           profiles, settings, messages, subscriptions
src/lib/useBridge.ts   bridge protocol, ring buffer, subscription bookkeeping
src/lib/storage.ts     saved connections in local storage
src/lib/format.ts      payload decoding, hex dump, time and size formatting
src/components/        Setup, MessageList, Inspector, JsonTree, Tools
```

Two things are worth knowing before you edit:

**The wire format lives in one file.** Anything sent between the browser and the bridge is
typed in `shared/protocol.ts`, and both sides import it. Adding a frame means adding a
variant to `ClientFrame` or `ServerFrame`; the compiler will then point at every place that
has to handle it. Do not hand-roll a message shape in one half only.

**Messages arrive faster than React can render.** `useBridge` collects incoming messages in
a ref and flushes them on a timer, and the stream column draws only the last few hundred
rows. If you touch that path, test against a broker publishing several hundred messages a
second before you decide it is fine.

## Style

Strict TypeScript, no `any`, no non-null assertions except where an index is provably in
range. Match the surrounding code rather than introducing a new pattern: the codebase has
no formatter config, so consistency comes from reading the neighbours.

Write comments only where the reason is not obvious from the code — the existing ones
explain *why* something is done that way, not what the line does.

Interface copy is part of the work. Name things the way a person using the tool would:
"Keep the password in this browser", not "Persist credential". Errors say what happened and
what to do about it.

## Security

This is a tool that holds broker credentials, so:

- Never commit a real host, username, password, or certificate. Saved connections belong in
  the browser's local storage, not in the repository.
- The bridge will connect to any broker it can route to, using whatever credentials the page
  sends it. If you add a way to reach the bridge from somewhere new, say so clearly in the
  pull request.
- Report anything exploitable privately to the maintainers rather than in a public issue.

## Reporting bugs

Include the broker and version (Mosquitto 2.0.18, EMQX 5, AWS IoT), the transport
(`mqtt`/`mqtts`/`ws`/`wss`), what you subscribed to, and what you expected instead. If the
bridge printed anything, include that too — it is the half that talks to the broker.
