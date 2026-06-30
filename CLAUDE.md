# CLAUDE.md — CityPlay Vanish

This file is read automatically at the start of every Claude Code session. It encodes the architecture, the hard-won gotchas, the conventions, and the working discipline for this project. **Read it fully before making any change.** Most bugs in this project come from re-discovering something already documented here.

---

## What this is

CityPlay Vanish is a mobile-first PWA hide-and-seek game for Chicago neighbourhoods, inspired by Jet Lag: The Game. One player hides; one or more seek. Seekers ask questions (Radar, Matching, Measuring, Thermo, Tentacles) that eliminate zones on a map until they corner the hider. The hider answers, banks time, and plays curse cards to slow seekers down.

It is built and field-tested by Ashwin (product) and Sid (collaborator, GitHub: thirddash139), played in real Chicago neighbourhoods on phones.

---

## Architecture (read this before touching anything)

- **Single file.** The entire app is one `index.html` (~3000+ lines): HTML, CSS, and vanilla JS in one file. **No build step, no framework, no bundler.** Do not introduce React, npm packages, or a build pipeline. Edits are made directly to `index.html`.
- **Maps:** Leaflet (loaded via CDN). The hider and seeker each have their own map instance.
- **Backend:** Supabase (Postgres + Realtime). The game is **event-sourced** — game actions are rows inserted into a `game_events` table, and both clients react to those events via Supabase Realtime (`postgres_changes`).
- **Legacy:** Some Firebase calls remain (`window._fbSet`, `window._fbListen`, `fbUnsubscribe`) from the original seeker build. These are being phased out in favour of Supabase but still exist in places. Don't assume Firebase is the source of truth — Supabase is.
- **Hosting:** Vercel, auto-deploys from `main`. After a push, wait ~60s then hard-refresh (Cmd+Shift+R / pull-to-refresh on mobile) to see changes.
- **Repo:** github.com/thirddash139/cityplay-vanish (Sid owns the repo; Ashwin is a collaborator).

### Supabase schema

Two tables:

- **`games`**: `id`, `code` (the join code), `seeker_id`, `hider_id` (these store **deviceId**, see below), `neighbourhood` (a JSON-stringified array of selected neighbourhood IDs), `status` (`waiting` / `active` / `ended`), `started_at`.
- **`game_events`**: `id`, `game_id`, `event_type`, `payload` (JSONB), `created_at`. This is the event log. Event types include: `question`, `answer`, `static_delay`, `veto`, `veto_response`, `seeker_ping`, `curse_played`, `curse_expired`, `detour_complete`, `lie_reversal`.

Supabase credentials live at the top of `index.html`. The client is initialized as **`sbClient`** (see gotcha below). Realtime is enabled on both tables via `ALTER PUBLICATION supabase_realtime ADD TABLE game_events, games;` (already run — a "already member" error on re-run is harmless).

---

## CRITICAL GOTCHAS (these have each cost multiple sessions — do not rediscover them)

### 1. The Supabase client is `sbClient`, NOT `supabase`
The Supabase CDN script occupies the global `window.supabase` as its own namespace. Naming our client `const supabase = window.supabase.createClient(...)` **overwrites that namespace** and causes `supabase.from is not a function` / "Failed to create game". The client is therefore named **`sbClient`** everywhere. Never rename it back to `supabase`. All DB calls are `sbClient.from(...)`, `sbClient.channel(...)`.

### 2. Supabase Realtime delivers JSONB `payload` as a STRING, not an object
When a `postgres_changes` event arrives, `payload` may be a JSON string rather than a parsed object. **Always** parse defensively at the top of `handleGameEvent`:
```js
const evtData = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : (evt.payload || {});
```
Then read `evtData.answer`, `evtData.lat`, etc. — never `evt.payload.answer` directly. Forgetting this silently breaks zone updates (the event arrives but the data is unreadable).

### 3. Z-index: there is ONE flat stacking context, and Leaflet lives in it
`#h-map-wrap` is `position:relative` with no explicit `z-index`, so it does **not** create its own stacking context. Every absolutely-positioned child therefore competes directly in the hider screen's stack — including Leaflet's own layers. Leaflet's control/top layer sits at **z-index 1000**. Anything that must appear above the map must beat that.

The established layer scale (respect it; don't invent new values):
- Leaflet tiles / overlay panes: ~200–400
- Leaflet controls (`.leaflet-top`): **1000**
- Hider drawer (`#h-drawer`): **1050** (above Leaflet, below hand button)
- Hand button (`#h-hand-btn`): **1100**
- Curse banner (`#h-curse-banner`): **1150**
- Popups/toasts/backdrops (`#keep-popup-backdrop`, `#play-popup-backdrop`): **5000** (the screen layer `.screen` is z-index 4000 — popups must beat it or they open invisibly behind it)
- Seeker curse overlay: **6000**
- Detour direction picker: **7000**

**If a tappable element "does nothing" or a popup "doesn't appear," suspect z-index first** — it's almost always opening correctly but rendering behind something. Confirm by adding a `console.log` in the handler before assuming the click is lost. (A genuinely lost tap on a button over the map is usually a missing `touch-action: manipulation`, the iOS-swallows-the-touch case — that's a different fix from z-index.)

> **Structural note:** the right permanent fix for this whole family is to give `#h-map-wrap` its own stacking context and document a fixed layer scale, so new layers stop colliding with Leaflet. Until that refactor lands, follow the scale above.

### 4. Realtime is unreliable on mobile — the catch-up poll is the standard fix
Supabase Realtime events get **dropped** when a phone backgrounds the tab or briefly loses connectivity (the Red Line kills GPS and connectivity entirely). The proven pattern is a **catch-up poll**: while waiting on an expected event, poll `game_events` every ~4s, replay any rows whose `id` is not already in `processedEventIds`, and dedupe so nothing is processed twice. This already exists for the seeker waiting on an `answer`. **When delivery of any event type proves unreliable, extend the catch-up poll to cover it rather than inventing a new mechanism.** Realtime alone is never sufficient on mobile; it always needs the polling safety net.

### 5. Players are identified by `deviceId`, and role is derived from it
Each device generates a persistent `deviceId` (localStorage `cvDeviceId`). The `games` table stores this in `seeker_id` / `hider_id`. **A returning player's role is determined by matching their deviceId against these columns** — this is how rejoin-by-link knows whether you were the seeker or hider. Don't default returning players to "hider"; check deviceId against `seeker_id`/`hider_id` first.

### 6. `event_type: 'static_delay'` is a wire identifier — do NOT rename it
The "Static" card was renamed to "Delay" in all UI and variables, BUT the Supabase event type string stayed `static_delay` to avoid invalidating in-flight events. Leave wire-protocol strings alone even when their UI label changes.

### 7. `myPos` must be `null` until the first GPS fix — never a seed coordinate (**fixed**)
`myPos` was initialized to `{lat:41.8900,lng:-87.6500}` (near the Kennedy Expressway). Because `watchPosition` can take 5–15s to fire (especially on CTA), any question asked before the first fix embedded the seed coordinate as `sLat`/`sLng` in the event payload, corrupting every zone elimination for that question permanently.

**The fix (applied):** `myPos` is now initialized to `null`. All question-sending functions (`doRadar`, `doMatch`, `doMeasure`, `doTentacles`) check `gpsLocked` first and toast `'Waiting for GPS fix…'` if not yet locked. All display functions that read `myPos` (`updateMatchInfo`, `updateTentPlaces`) bail with a "Waiting for GPS…" message. The hider's Lie truth computation in `showHiderIncomingQuestion` is also guarded. The `initMap` marker placement uses `myPos?` (not `myPos.lat?`, which was always truthy even with the seed). **Do not re-introduce a non-null seed value for `myPos`.**

---

## State management

- **`resetGameState()`** is the single source of truth for clearing per-game state. It clears all intervals/timers, unsubscribes channels, zeroes all gameplay state (pendingQuestion, curses, hand, eliminations, log), and resets UI overlays. **It is called at the START of every game entry point** (`launchGame`, `launchAsHiderFromSetup`, `loadGameAndShowHider`, `rejoinAsSeeker`, `rejoinAsHider`). **Always reuse it — never write ad-hoc teardown logic.** If a new piece of state needs clearing, add it to `resetGameState`, not to individual exit functions.
- **`restoreGameState()`** restores prior game state on rejoin. Rejoin must replay accumulated `game_events` to rebuild eliminations, the intel log, and resume the timer from `started_at` — rejoin should be **non-destructive** (it has regressed on this before; restoring the session without restoring progress is a bug).
- **Session persistence:** `persistSession()` writes `{gameCode, gameId, role}` to localStorage (`cvSession`) during an active game; `clearSession()` removes it. On page load, the app checks `cvSession` and offers a "Rejoin / Start fresh" prompt. New games call `clearSession()` first so a stale session can't bleed in.

---

## Conventions

- **Git identity:** commits MUST be authored as `ashwiniyer.1691@gmail.com` / "Ashwin Raman" (Vercel deploy requirement). 
- **Branching:** during active co-development, commit directly to `main`. Vercel auto-deploys from main.
- **Commit messages:** descriptive, telling the story (e.g. `fix bug 6: raise keep/play popup backdrop z-index above screen layer`). Reference bug numbers when fixing tracked bugs.
- **Auth:** pushes to Sid's repo use Ashwin's PAT embedded in the remote URL.
- **Testing:** test in **two browser windows** (Chrome + Incognito) for separate deviceIds — one seeker, one hider. But remember: **many bugs only reproduce on mobile/in the field** (Realtime drops, GPS, touch). Laptop-passing ≠ field-passing. Flag which bugs need field validation.

---

## Working discipline (follow this loop for every change)

1. **Read before you change.** Read the relevant existing functions (`handleGameEvent`, the specific card/answer/curse code, `resetGameState`) BEFORE editing. State bugs here are subtle; guessing causes regressions.
2. **Diagnose before fixing.** For "it does nothing" bugs, add a `console.log` to confirm whether the handler fires at all *before* changing code. (This caught the z-index-vs-lost-tap distinction more than once.)
3. **One thing at a time.** Fix one bug, summarize what changed, then move to the next. For multi-part builds, summarize after each part before continuing.
4. **Reuse, don't duplicate.** Use `resetGameState`, `restoreGameState`, the catch-up-poll pattern, the existing z-index scale. Duplicated teardown logic is itself a bug source.
5. **Test the full cycle after state changes.** After touching the answer flow, run ask → answer → acknowledge → ask-again. After touching teardown, start a fresh game and confirm no stale state.
6. **Clean up debug traces** before considering a fix done (leftover `console.log`s in `keepCard()` and `toggleHiderDrawer()` are known cruft to remove).

---

## Known open issues (as of last field test)

- **Question doesn't reach the hider without manual Sync** — Realtime not surfacing `question` events to the hider automatically. Fix: extend the catch-up poll (gotcha #4) to cover `question` events for the hider.
- **Rejoin wipes progress** — intel log, map eliminations, and timer reset on rejoin (timer stuck at 0:00). Fix: replay `game_events` and resume timer from `started_at`.
- **Default GPS "Kennedy" location** — see gotcha #7.
- **Lie 5-min reversal notification** — unconfirmed whether the seeker "you were lied to" notification fires; needs a full 5-min field test.
- **Seeker map clarity** — needs clearer contrast between in-play and eliminated zones.
- **Tentacles ASK button** — not working; other four question types work.

---

## Game design rules (so changes don't break intended behaviour)

- **Seeker visibility** is interval pings (every 5 min), NOT live tracking — scarce info is the design.
- **Curses don't stack.** While any curse is active on the seeker (Freeze, Detour, Delay-pending, Lie-pending), the hider's other curse cards are disabled.
- **Delay** (formerly Static) delays the *answer reaching the seeker* by 3 min, not the question reaching the hider. It's a surprise — excluded from the seeker curse overlay.
- **Detour:** hider picks a cardinal direction; seeker must walk 0.3 mi that way (unlock at ≥0.27 mi net displacement in the dominant axis, GPS-jitter buffer). Pings every 30s while active.
- **Lie:** once per game, in the hider's hand by default, never drafted. App computes the truthful answer and forces it (wrong answer greyed out); Lie flips it so the hider submits the false answer. Auto-reverses after 5 min with a notification to the seeker. Not available for Tentacles.
- **Exactly the intended number of options** — don't add answer choices the game design doesn't call for.

---

## Deeper reference

For the full original build spec (UI layout, colour tokens, card system rules, the 10-step build order, full schema with RLS), see **`HIDER-SCREEN-BUILD-SPEC.md`** in the repo root.
