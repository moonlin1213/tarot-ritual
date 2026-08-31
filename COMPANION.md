# Optional companion integration

The original standalone app, provider settings, manual providers, DSH consent,
model selection, prompts, photo identification and `/api/chat` remain available.
Importing the companion adapter does not contact a server. Without an injected
configuration, the app follows its original standalone flow.

This is a host-neutral browser seam, not a built-in companion service. A separate
same-origin connector owns invitation acceptance, sessions, durable facts,
reading attempts and return delivery. It must inject the following script only
after an accepted invitation and authenticated session cookie:

```html
<script type="application/json" id="companion-config">
{"protocol":"cove-tarot-companion-v1","sessionId":"example-session","apiBase":"/companion/v1"}
</script>
```

`apiBase` must be exactly `/companion/v1`. Session, event and attempt identifiers
use ASCII letters, digits, `_` and `-`, between 1 and 128 characters. The browser
never follows a host-provided return URL or forwards requests to a configurable
companion origin. The connector must enforce origin, cookie and CSRF checks,
validate catalog facts and enforce idempotency server-side.

## Browser contract

`createCompanionAdapter(config, { fetchImpl = fetch } = {})` returns `null` for
absent configuration, otherwise an object with these methods:

| Method | Same-origin endpoint and behavior |
| --- | --- |
| `restore()` | `GET /sessions/:id`; returns the bare session after any permitted outbox replay and refresh |
| `commitDraw({question, spread_id, draws, event_id?})` | `POST /sessions/:id/draw`; creates an event ID when omitted |
| `reveal({positions, event_id?})` | `POST /sessions/:id/reveal`; requires a draw ACK |
| `read(body, {signal} = {})` | `POST /sessions/:id/reading`, or GET-only resume when `body.attempt_id` is present; returns the original `Response` |
| `returnToChat()` | Refreshes current revision, then `POST /sessions/:id/return` with `{revision}` |
| `stop()` | `POST /sessions/:id/stop` with `{}` |

All paths above are prefixed by `/companion/v1`. Requests use
`credentials: 'same-origin'` and `cache: 'no-store'`. POST requests carry JSON
and `X-Companion-CSRF`, obtained from the bootstrap response:

```json
{
  "csrf_token": "example-csrf",
  "session": {
    "id": "example-session",
    "conversation_id": "example-conversation",
    "revision": 2,
    "phase": "revealed",
    "question": "A synthetic question",
    "spread_id": "single",
    "draws": [{"position": 0, "card_id": "M00", "reversed": false, "revealed": true}],
    "reading": null
  }
}
```

Draw events carry `{event_id, question, spread_id, draws}`; draw facts contain
only `{position, card_id, reversed}` with zero-based catalog positions. Reveal
events carry `{event_id, positions}`. Each event receipt is
`{session_id, event_id, revision}`. A receipt for a different session or event is
not acknowledged locally.

Draw/reveal event bodies are written to a session-scoped local-storage outbox
before transmission. Operations are serialized within the page. Lost ACKs keep
their exact serialized body and event ID; reload replays the same event before
continuing. Storage failures or failed ACKs freeze the relevant controls. A
second page is not a second session: server-side idempotency and immutable draw
enforcement remain mandatory for concurrent tabs. Terminal sessions never replay
pending writes, and unresolved local outbox records are retained rather than
silently declared acknowledged.

The session phases are `accepted`, `drawn`, `revealed`, `returned`, `stopped`,
and `deleted`. The final three are read-only in the UI. New question/reset
controls cannot replace a committed draw. A stopped result may still be returned
when the connector permits it. Returning a running reading can fail with a
conflict; the UI offers waiting or stopping without claiming delivery succeeded.
Return receipts use `{event_id, session_id, revision, state}`, where state is
`pending`, `claimed`, `sent`, or `unknown`. Only `sent` is displayed as delivered.

## Readings and restoration

Managed reading POST bodies contain
`{action_id, providerId?, provider?, model, temperature?, maxTokens?}`.
The browser drops `messages`: the connector rebuilds the original engine
messages from canonical saved facts. No model preference is added. A custom
provider is forwarded ephemerally only, never in the outbox. The original
provider controls and their credential-storage rules are unchanged.

`chat()` accepts an optional `transport(body, {signal})`. Only managed tarot
readings use it. Photo identification continues through the original transport.
Both consume the original SSE events `{t:'delta', v:string}`, `{t:'error',
v:string}` and `{t:'done'}` with the existing callbacks and failure semantics.

A reading object is `{id, state, text}`. Supported states are `running`,
`succeeded`, `failed`, `unknown`, and `cancelled`. Refresh renders stored text
and status, restoring exact catalog cards, positions and orientations without
drawing again or requesting a new AI reading. Incomplete saved reveals finish
and synchronize without starting a reading. The whole-spread flip, card detail,
canvas navigation and spread title remain available.

Viewing a running attempt uses `GET /reading?attempt_id=...`, never a new POST.
An unknown attempt displays a charge warning; a deliberate reread requires
confirmation and creates a fresh action ID. Fresh action IDs are persisted
without provider data before a POST; an uncertain request is not automatically
retried or assigned a replacement ID. No configured provider still permits
draw/reveal, built-in card meanings and a truthful “no complete reading” result.

## Connector-owned engine probe

When `COVE_TAROT_COMPANION_TOKEN` is set for an engine process,
`GET /api/companion-health` requires an exact `Authorization: Bearer ...` token
and returns `{protocol:'cove-tarot-engine-v1', engine:'tarot', version:1}`.
The token must not appear in URLs or logs. Without the environment variable,
this route is disabled (404). The original public `/api/health` remains
unchanged. This probe identifies an engine instance owned by the connector; it
does not grant permission to stop an arbitrary process occupying a port.

The same-origin connector forwards `/api/dsh`, `/api/dsh/import`, `/api/models`
and `/api/chat` to its fixed engine. Invitation/session management and result
delivery belong to the connector, not to the engine's provider implementation.

## Verification

Run `npm test` and `npm run check` using the supported Node version. Companion
tests use synthetic sessions, credentials, local temporary directories and
local HTTP fixtures only; they neither import a real DSH account nor make paid
model calls.
