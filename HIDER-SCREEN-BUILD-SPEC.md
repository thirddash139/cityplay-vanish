# CityPlay Vanish — Hider Screen Build Spec

**For:** Sid (Claude Code session)
**Model recommendation:** Sonnet 4.6 for all coding. Use Opus 4.6 only if you hit architecture confusion with the Supabase Realtime wiring.
**Branch:** `main` (Ashwin and Sid are co-developing in the same sessions for now)
**Live URL:** cityplay-vanish.vercel.app
**Repo:** github.com/thirddash139/cityplay-vanish

---

## Context

The current app is a single `index.html` file (~130KB) deployed as a PWA on Vercel. It has the full seeker experience (5 question types, neighbourhood selection, zone elimination math) but the hider screen is essentially empty — the hider taps "I'm Ready" and then has nothing to do. This spec redesigns the hider experience from the ground up.

**Do not break or restructure the existing seeker flow.** All changes are additive — a new hider game state that activates after the hider taps "I'm Ready."

---

## What We're Building

A new hider screen with four systems:

1. **Map-hero layout** — the hider watches seekers approach on a large tactical map
2. **Question answering** — incoming seeker questions appear on the hider's screen with Yes/No buttons
3. **Prize draft** — after answering, the hider picks 1 of 3 randomly dealt cards to keep
4. **Hand management** — stored cards live in a left drawer and are played via confirm popups

Plus the **Supabase Realtime backend** that connects the hider and seeker phones.

---

## 1. Hider Screen Layout

The hider screen has four vertical sections, top to bottom. The map dominates.

### 1A. Status Bar (top, fixed)

Three stats in a horizontal row, edge to edge:

| Left | Center | Right |
|------|--------|-------|
| **Hiding** (label, small, muted) | **Bonus** (label, small, muted) | **Seekers** (label, small, muted) |
| `42:07` (large, orange, ticking) | `+10:00` (large, white) | `0.8 mi` (large, blue) |

- **Hiding time** is the hero number. It ticks up every second from the moment the hider taps "I'm Ready." This is the hider's score — every minute hidden is a minute earned.
- **Bonus** shows total banked time from Time Add cards. Starts at `+0:00`. Increments by 5:00 each time a Time Add card is played.
- **Seekers** shows distance to nearest seeker. Updates on each interval ping (see section 5). Format: `0.8 mi — 2 min ago`. The "X min ago" suffix shows ping staleness so stale data is honest. When no ping has been received yet, show `Waiting for ping…` in muted text.

Visual: dark background (#0d0d12), 1px border-bottom separating from map. Orange accent (#f97316) for hiding time. Blue (#5ba8f5) for seeker distance. White/light (#e8e8ee) for bonus. Muted gray (#8a8a96) for labels. Monospace font throughout.

### 1B. Map (hero section, largest area)

The map is the centerpiece of the hider screen. It should take up the maximum available vertical space — at least 55-60% of the viewport height.

**What the map shows:**
- Dark-themed Mapbox (or current map implementation) showing the game zone boundary
- **Hider's own position** — orange dot with a soft orange glow/pulse ring around it
- **Seeker position(s)** — blue dot(s), updated on interval pings only (every 5 minutes, see section 5). When a ping arrives, the blue dot animates to its new position. Between pings, the dot stays static at its last known position.
- Street grid and neighbourhood context visible but subdued

**Overlay elements on the map:**

**Hand drawer button** — top-left corner of the map, floating above it:
- Rounded rectangle button, dark background (#1a1a22), 1px border (#3a3a44)
- Shows a cards icon + `Hand X/6` where X is current card count
- Tapping opens the left drawer (see section 4)
- Color: orange text (#fdba74) for the icon and count

**Active curse banner** — when a curse is active on the seekers, show a banner overlaying the bottom of the map:
- Dark semi-transparent background (#2a1505), 1px orange border, rounded corners
- Shows: flame icon + `[Curse name] is active on the seekers — [remaining time]`
- Auto-dismisses when the curse timer expires

### 1C. Question Area (below map)

This area has three possible states. Only one is visible at a time.

**State 1: Waiting for question**
- Muted text: `Waiting for next question…`
- Dark card background (#1a1a22), 1px border (#3a3a44), rounded corners

**State 2: Incoming question**
- Warm dark background (#241505), 1px orange border (#f97316), rounded corners
- Top line (small, orange, uppercase tracking): icon + `Incoming — [question type]`
  - Question types: Radar, Matching, Measuring, Thermometer, Tentacles
  - Icons: use appropriate icons per type (radar icon for Radar, etc.)
- Question text (medium, white): the actual question in quotes, e.g. `"Are you within ½ mile of me?"`
- Two answer buttons side by side:
  - **Yes** — dark green background (#13261a), green border (#2f7a4d), green text (#7be0a3)
  - **No** — dark red background (#261313), red border (#8a3636), red text (#f0a0a0)

**State 3: Veto option**
When a question arrives AND the hider has a Veto card in their hand, show a third button below Yes/No:
- **Veto this question** — dark purple/orange background, distinct from Yes/No
- Tapping Veto: the question disappears, the Veto card is consumed from the hand, the seeker is notified their question was vetoed (see section 3E for the full veto flow)

### 1D. Prize Area (bottom)

This area has two possible states.

**State 1: Empty (default)**
- Label (small, muted): `Prizes — answer a question to earn a card`
- Empty row, no pills visible

**State 2: Prize draft active (after answering a question)**
- Label changes to: `Prizes — pick 1 to keep in your hand`
- Three pill buttons appear in a horizontal row
- Each pill is randomly selected from the V1 card pool (see section 3A)
- Pills are styled as rounded capsules:
  - Orange border (#f97316) for curse cards (Freeze, Detour, Static, Veto)
  - Blue border (#5ba8f5) for Time Add
  - Icon + card name inside each pill
- **Tapping a pill opens the Keep Popup** (see section 3C)
- After keeping one card, the other two pills vanish, the label resets to State 1

---

## 2. Interaction Flows

### 2A. Core Game Loop (per round)

```
Seeker asks a question
  → Question appears on hider screen (State 2)
  → Hider taps Yes, No, or Veto

If Yes or No:
  → Answer sent to seeker via Supabase
  → Question area transitions to "Waiting…" (State 1)
  → Prize area shows 3 random cards (State 2)
  → Hider taps a prize pill → Keep Popup appears
  → Hider confirms → card added to hand, drawer flashes open briefly
  → Prize area resets to empty (State 1)
  → Wait for next question

If Veto:
  → Veto card consumed from hand
  → Seeker notified: "Your question was vetoed"
  → Seeker chooses: re-ask same question OR ask a different one
  → If re-ask: hider must answer Yes/No, then gets 2-of-3 prize draft instead of 1-of-3
  → If different question: normal flow, 1-of-3
```

### 2B. Full Hand (6/6) Draft

When the hider's hand is full (6 cards) and a prize draft triggers:

```
Prize area shows 3 cards as normal
  → Hider taps a prize pill → Keep Popup appears
  → Keep Popup shows an additional line: "Your hand is full — choose a card to discard"
  → Below the "Keep this card" button, show the 6 current hand cards as small pills
  → Hider taps one to discard → discarded card is removed, new card takes its slot
  → Drawer flashes open to show the updated hand
```

### 2C. Playing a Card from Hand

```
Hider opens drawer (taps Hand button on map)
  → Drawer slides in from left, showing 6 slots (filled + empty)
  → Hider taps a filled card pill
  → Play Popup appears (see section 3D)
  → Hider taps "Apply curse" / "Bank the time" to confirm, or X to cancel
  → If confirmed: card removed from hand, effect applied, drawer updates
  → Drawer stays open so hider sees the updated hand
```

---

## 3. Card System

### 3A. V1 Card Pool (5 cards)

| Card | Category | Icon | Effect | Duration |
|------|----------|------|--------|----------|
| **Freeze** | Movement | snowflake | Seekers must stand completely still. Their map stays live but they cannot move. | 3 minutes |
| **Detour** | Movement | arrow-ramp-right | The hider points a direction. Seekers must walk ¼ mile that way before resuming the hunt. | Until completed |
| **Time Add** | Score | clock-plus | Bank +5 minutes onto the hider's final hiding score. Plays instantly, no effect on seekers. | Instant |
| **Static** | Jam | wifi-off | The next question's answer is delayed — the seeker submits a question, but the answer arrives 3 minutes late. The hider answers immediately on their end; the delay is app-enforced on the seeker's side. | Next question only |
| **Veto** | Counter | shield-x | Reject an incoming question. The seeker can re-ask the same question, but the hider then drafts 2-of-3 instead of 1-of-3. Or the seeker can ask a different question (normal 1-of-3 draft). | Immediate |

### 3B. Prize Draft Rules

- After every answered question, 3 cards are randomly drawn from the pool and shown as prizes
- Duplicates are allowed in the same draw (you could see 2 Freezes and 1 Time Add)
- The hider picks exactly 1 card to keep. The other 2 vanish.
- **Veto escalation:** if the hider vetoed the question and the seeker re-asked, the hider picks 2 of 3 instead of 1 of 3. Show a banner: `Veto bonus — pick 2 cards this round`
- Cards are added to the hand (left drawer)
- Hand maximum: 6 cards. If full, hider must discard one to make room (see flow 2B)

### 3C. Keep Popup (for prize draft)

Triggered when the hider taps a prize pill in the bottom area.

```
┌─────────────────────────────┐
│  [Card Name]            [X] │
│                             │
│  [Full card description     │
│   from the table above,     │
│   2-3 lines max]            │
│                             │
│  ┌─────────────────────┐    │
│  │   Keep this card     │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

- Card name in orange (or blue for Time Add), 15px, weight 500
- X button top-right to cancel (returns to prize selection, can pick a different one)
- Description in light gray, 12px, line-height 1.5
- "Keep this card" button: full width, orange background (#f97316), dark text (#1a0e05), rounded, 13px weight 500
- Modal overlays the full phone screen with a dark semi-transparent backdrop

### 3D. Play Popup (for hand cards)

Triggered when the hider taps a card in the left drawer.

```
┌─────────────────────────────┐
│  [Card Name]            [X] │
│                             │
│  [Full card description]    │
│                             │
│  ┌─────────────────────┐    │
│  │   Apply curse        │    │
│  └─────────────────────┘    │
└─────────────────────────────┘
```

- Same layout as Keep Popup
- Confirm button text changes by card:
  - Freeze → "Apply curse"
  - Detour → "Apply curse"
  - Static → "Apply curse"
  - Time Add → "Bank the time"
  - Veto → this card is never "played" from the drawer manually. It auto-activates when a question arrives and the hider taps "Veto this question" in the question area. So Veto should show in the drawer as a card but tapping it shows an info popup: "Veto activates automatically when a question arrives. Look for the Veto button below the Yes/No options." with only an X to close, no play button.
- X button to cancel, returns to drawer

### 3E. Veto Flow (detailed)

```
1. Seeker submits a question
2. Question appears on hider screen with Yes / No / Veto buttons
   (Veto button only visible if hider has a Veto card in hand)
3. Hider taps "Veto this question"
4. Veto card is consumed from hand immediately
5. Question area shows: "Question vetoed. Waiting for seeker's response…"
6. Seeker's screen shows: "Your question was vetoed by the hider."
   Two buttons: "Ask the same question" / "Ask a different question"
7a. If seeker taps "Ask the same question":
    → Same question reappears on hider screen with Yes / No only (no veto option)
    → Hider answers
    → Prize draft shows 3 cards but hider picks 2 instead of 1
    → Banner above prizes: "Veto bonus — pick 2 cards this round"
7b. If seeker taps "Ask a different question":
    → Seeker returns to question selection screen
    → When they submit a new question, normal flow (1-of-3 draft)
```

---

## 4. Left Hand Drawer

### Layout

The drawer slides in from the left edge of the map area. It overlays the map (does not push it).

- Width: ~155px
- Full height of the map section
- Background: dark (#101016), 1px right border (#3a3a44)
- Top: header row with label "Hand — tap to play" (muted, small) and X close button
- Below: 6 vertical slots

### Slot States

**Filled slot:**
- Rounded pill (border-radius: 999px)
- 1px border: orange for curse cards, blue for Time Add
- Text color: orange (#fdba74) for curses, blue (#9cc8f7) for Time Add
- Content: icon + card name
- Tappable → opens Play Popup (section 3D)

**Empty slot:**
- Rounded pill outline (border-radius: 999px)
- 1px dashed border (#3a3a44)
- Text: "empty" in muted gray (#55555f)
- Not tappable

### Behavior

- Drawer is **closed by default**
- Opens when:
  - Hider taps the Hand button on the map
  - A new card is kept from the prize draft (auto-opens briefly to show the new card arriving, auto-closes after 2 seconds)
- Closes when:
  - Hider taps X in the drawer
  - Hider taps the Hand button again (toggle)
  - Hider taps outside the drawer on the map

---

## 5. Supabase Realtime Backend

### Why

Currently the hider generates a code and shares a link, but there is no actual data flowing between phones. The seeker can't send questions to the hider's phone, and the hider can't send answers back. This section adds the minimum backend to make the game playable across two devices.

### Supabase Project Setup

Create a new Supabase project (free tier). You need:

1. A `games` table
2. A `game_events` table
3. Supabase Realtime subscriptions on `game_events`

### Database Schema

```sql
-- Active games
CREATE TABLE games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,              -- 6-char join code (e.g. K3JM7P)
  status TEXT DEFAULT 'waiting',          -- waiting | active | ended
  hider_id TEXT NOT NULL,                 -- random device ID generated client-side
  seeker_id TEXT,                         -- set when seeker joins
  neighbourhood TEXT,                     -- e.g. "River North"
  zone_geojson JSONB,                     -- the game boundary polygon
  hider_lat DOUBLE PRECISION,
  hider_lng DOUBLE PRECISION,
  seeker_lat DOUBLE PRECISION,
  seeker_lng DOUBLE PRECISION,
  seeker_pinged_at TIMESTAMPTZ,           -- last seeker ping timestamp
  started_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- All game events flow through here (questions, answers, curses, pings)
CREATE TABLE game_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,               -- see event types below
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast event queries
CREATE INDEX idx_game_events_game_id ON game_events(game_id);
CREATE INDEX idx_games_code ON games(code);
```

### Event Types

All game communication flows through `game_events` as typed events:

| event_type | payload | sent by |
|------------|---------|---------|
| `question` | `{ "type": "radar", "text": "Are you within ½ mile of me?", "params": {...} }` | seeker |
| `answer` | `{ "answer": "yes" }` or `{ "answer": "no" }` | hider |
| `veto` | `{}` | hider |
| `veto_response` | `{ "action": "re-ask" }` or `{ "action": "different" }` | seeker |
| `curse_played` | `{ "card": "Freeze", "duration_seconds": 180 }` | hider |
| `curse_expired` | `{ "card": "Freeze" }` | system (client-side timer) |
| `seeker_ping` | `{ "lat": 41.89, "lng": -87.63 }` | seeker |
| `hider_ping` | `{ "lat": 41.91, "lng": -87.64 }` | hider |
| `static_delay` | `{ "delay_seconds": 180, "answer": "yes" }` | hider (when Static is active) |
| `game_end` | `{ "reason": "found" }` or `{ "reason": "timeout" }` | either |

### Realtime Subscriptions

Both phones subscribe to the `game_events` table filtered by their `game_id`:

```javascript
const channel = supabase
  .channel(`game-${gameId}`)
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'game_events',
      filter: `game_id=eq.${gameId}`
    },
    (payload) => handleGameEvent(payload.new)
  )
  .subscribe();
```

Each phone's `handleGameEvent` processes only the event types relevant to its role:

**Hider listens for:** `question`, `veto_response`, `seeker_ping`
**Seeker listens for:** `answer`, `veto`, `curse_played`, `curse_expired`, `static_delay`, `hider_ping`

### Seeker Ping Interval

The seeker's phone writes a `seeker_ping` event every 5 minutes:

```javascript
setInterval(async () => {
  const pos = await getCurrentPosition();
  await supabase.from('game_events').insert({
    game_id: gameId,
    event_type: 'seeker_ping',
    payload: { lat: pos.coords.latitude, lng: pos.coords.longitude }
  });
}, 5 * 60 * 1000); // every 5 minutes
```

The hider's phone receives this via the Realtime subscription and updates the blue dot on the map + the "Seekers X mi — Y min ago" display.

**Endgame acceleration rule (implement if time allows, otherwise defer):** when a seeker ping puts the seeker within 0.25 miles of the hider, switch pings to every 2 minutes. The seeker phone checks the distance against the hider's position (from `hider_ping` events) and adjusts its interval.

### Supabase Client Setup

Add the Supabase JS client via CDN since this is a single HTML file:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script>
  const supabase = window.supabase.createClient(
    'YOUR_SUPABASE_URL',
    'YOUR_SUPABASE_ANON_KEY'
  );
</script>
```

### Row Level Security

Enable RLS on both tables. Policies:

```sql
-- games: anyone can read/insert (anonymous players), update only your own game
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create games" ON games FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read games" ON games FOR SELECT USING (true);
CREATE POLICY "Players can update their game" ON games FOR UPDATE USING (true);

-- game_events: anyone can insert events and read events for their game
ALTER TABLE game_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert events" ON game_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read events" ON game_events FOR SELECT USING (true);
```

Note: These are permissive policies suitable for V1 with trusted players (you and your friends). For a public launch, tighten these with device ID checks.

### Environment Variables

Store the Supabase URL and anon key. Since this is a static single-file app, they'll be in the HTML directly (the anon key is safe to expose — RLS protects the data). For future versions, consider moving to environment variables in Vercel.

---

## 6. Static Curse Implementation

Static deserves its own section because it has a unique flow:

```
1. Hider plays Static from hand
2. Seeker is NOT notified that Static is active (this is the point — it's a surprise)
3. Seeker submits their next question
4. Question arrives on hider's phone normally
5. Hider answers normally (Yes/No)
6. Instead of sending an `answer` event, the hider's phone sends a `static_delay` event
   with the answer embedded and a 3-minute delay
7. Seeker's phone receives `static_delay`, starts a 3-minute countdown
8. Seeker sees: "Answer incoming… 2:47" (countdown timer)
9. When timer expires, the answer is revealed and zone updates normally
10. Static is consumed — next question flows normally
```

The key insight: Static does NOT delay the question from reaching the hider. It delays the answer from reaching the seeker. The hider answers on their own time; the seeker waits. This is important because delaying the question would stall the hider's prize draft too.

---

## 7. Visual Design Tokens

The existing app uses a dark tactical aesthetic. Preserve it exactly. These are the exact colors used throughout the hider screen:

### Backgrounds
| Token | Hex | Usage |
|-------|-----|-------|
| Screen bg | `#0d0d12` | Phone body |
| Map bg | `#15151c` | Map section |
| Card bg | `#1a1a22` | Question cards, drawer, pills |
| Warm card bg | `#241505` | Incoming question, active curse |
| Curse active bg | `#2a1505` | Active curse banner |
| Drawer bg | `#101016` | Left drawer panel |
| Modal backdrop | `rgba(5,5,8,0.78)` | Popup overlay |

### Borders
| Token | Hex | Usage |
|-------|-----|-------|
| Default border | `#26262e` | Status bar, section dividers |
| Card border | `#3a3a44` | Waiting state cards, drawer |
| Orange border | `#f97316` | Active questions, curse cards, confirm buttons |
| Blue border | `#5ba8f5` | Time Add cards, seeker elements |
| Green border | `#2f7a4d` | Yes button |
| Red border | `#8a3636` | No button |
| Dashed empty | `#3a3a44` | Empty drawer slots |

### Text
| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#e8e8ee` | Question text, bonus number |
| Muted | `#8a8a96` | Labels, "Waiting…" text |
| Orange | `#f97316` | Hiding time, section accents |
| Orange light | `#fdba74` | Card names, curse text |
| Blue | `#5ba8f5` | Seeker distance, seeker dot |
| Blue light | `#9cc8f7` | Time Add card text |
| Green | `#7be0a3` | Yes button, success confirmations |
| Red | `#f0a0a0` | No button |
| Empty slot | `#55555f` | "empty" text in drawer |

### Typography
- Font: monospace (inherit from existing app, likely system mono)
- Status bar labels: 11px, muted, letter-spacing 1px, uppercase
- Status bar numbers: 20px, weight 500
- Hiding time: 20px (hero size), orange
- Question type label: 11px, orange, uppercase tracking
- Question text: 13px, white
- Button text: 13px
- Card names in pills: 12px
- Card descriptions in popups: 12px, line-height 1.5
- Popup card name: 15px, weight 500

### Spacing & Corners
- Section padding: 10-14px horizontal
- Card border-radius: 10px
- Pill border-radius: 999px (full round)
- Popup border-radius: 14px
- Button border-radius: 8px
- Gap between pills: 6px
- Gap between answer buttons: 8px

---

## 8. Game State Management

Since this is a single HTML file, manage game state in a single JavaScript object:

```javascript
const gameState = {
  role: 'hider',             // 'hider' or 'seeker'
  gameId: null,              // UUID from Supabase
  code: null,                // 6-char join code
  status: 'waiting',         // waiting | active | ended

  // Hider-specific
  hidingStartedAt: null,     // timestamp
  hand: [],                  // array of card names, max 6
  bonusSeconds: 0,           // total banked time
  activeCurse: null,         // { card: 'Freeze', expiresAt: timestamp } or null
  staticActive: false,       // is Static queued for next question

  // Seeker tracking
  seekerLat: null,
  seekerLng: null,
  seekerPingedAt: null,      // timestamp of last ping

  // Current question state
  currentQuestion: null,     // { type, text, params } or null
  prizeCards: [],             // 3 cards shown after answering
  prizePicks: 1,             // normally 1, becomes 2 after veto re-ask
  awaitingVetoResponse: false
};
```

### Timer

The hiding timer runs client-side:

```javascript
setInterval(() => {
  if (gameState.status === 'active' && gameState.hidingStartedAt) {
    const elapsed = Math.floor((Date.now() - gameState.hidingStartedAt) / 1000);
    updateTimerDisplay(elapsed);
  }
}, 1000);
```

---

## 9. Build Order

Do these in sequence. Each step should be testable before moving to the next.

### Step 1: Supabase setup
- Create Supabase project
- Run the SQL schema (games + game_events tables, RLS policies, indexes)
- Add Supabase JS client to index.html via CDN
- Test: can you insert and read a row from the browser console?

### Step 2: Game creation and joining via Supabase
- When hider taps "I'm Ready," create a row in `games` table, get back the UUID and code
- When seeker enters the code, look up the game and set seeker_id
- Both phones subscribe to `game_events` for that game_id
- Test: two browser tabs, one creates a game, one joins. Both are subscribed.

### Step 3: Hider screen layout
- After "I'm Ready," transition to the new hider screen layout
- Render: status bar (with live ticking timer), hero map, empty question area ("Waiting…"), empty prize area
- Hand drawer button on map (shows 0/6)
- Drawer opens/closes on tap, shows 6 empty slots
- Test: the screen looks right, timer ticks, drawer toggles

### Step 4: Question flow (seeker → hider → seeker)
- Seeker submits a question → inserts `question` event into `game_events`
- Hider's phone receives it via Realtime → renders the incoming question UI
- Hider taps Yes/No → inserts `answer` event
- Seeker's phone receives the answer → processes zone update as it currently does
- Test: two tabs, seeker sends a question, hider sees it and answers, seeker gets the answer

### Step 5: Prize draft
- After hider answers, show 3 random cards from the pool as pills in the prize area
- Tapping a pill opens the Keep Popup
- Confirming adds the card to gameState.hand and re-renders the drawer
- Drawer auto-opens for 2 seconds to show the new card
- Test: answer a question, pick a card, see it in the drawer

### Step 6: Playing cards from hand
- Tap a card in the drawer → Play Popup with description + confirm/cancel
- Confirm on Freeze/Detour/Static: insert `curse_played` event, remove from hand, show active curse banner with countdown
- Confirm on Time Add: add 300 to bonusSeconds, update bonus display, remove from hand
- Veto: info-only popup (played from question area, not drawer)
- Test: play a Freeze, see the banner count down, see seeker receive the curse notification

### Step 7: Veto flow
- When question arrives and hand contains Veto, show third "Veto this question" button
- Tapping it: consume Veto from hand, insert `veto` event, show "Waiting for seeker's response…"
- Seeker receives veto notification with two buttons
- Seeker's choice flows back as `veto_response` event
- If re-ask: same question reappears, hider answers, prizePicks set to 2
- Test: full veto flow across two tabs, including the 2-of-3 draft

### Step 8: Seeker pings
- Seeker phone writes `seeker_ping` every 5 minutes
- Hider phone receives ping, updates seeker dot on map and distance display
- Show "X min ago" staleness indicator
- Test: change the interval to 10 seconds for testing, confirm dot moves

### Step 9: Static curse
- When Static is played, set staticActive flag
- Next question answered normally by hider, but sends `static_delay` event instead of `answer`
- Seeker shows countdown, then reveals answer
- Test: play Static, answer a question, confirm seeker waits 3 minutes

### Step 10: Full hand discard flow
- When hand is 6/6 and prize draft triggers, Keep Popup adds a discard selection
- Hider picks a card to discard before the new card takes its slot
- Test: fill hand to 6, answer a question, confirm discard flow works

---

## 10. What NOT to Change

- Do not restructure the file from a single index.html into multiple files or a build system
- Do not change the seeker's existing question UI, zone math, or neighbourhood selection
- Do not change the existing map styling, boundary rendering, or zone elimination visuals
- Do not change the join code generation or sharing mechanism (just wire it to Supabase instead of being local-only)
- Do not add user accounts, authentication, or profiles
- Do not add sound effects or haptic feedback (defer to V2)
- Preserve the existing dark color scheme and monospace typography throughout

---

## 11. Commit Strategy

After each step above, commit with a descriptive message:

```
git add .
git commit -m "step 1: supabase schema and client setup"
git push origin main
```

Suggested commit messages:
- `step 1: supabase schema and client setup`
- `step 2: game creation and join flow via supabase`
- `step 3: hider screen layout with status bar and hero map`
- `step 4: question flow between seeker and hider via realtime`
- `step 5: prize draft system with keep popup`
- `step 6: card play from hand drawer with confirm popup`
- `step 7: veto flow with re-ask escalation`
- `step 8: seeker interval pings every 5 minutes`
- `step 9: static curse with delayed answer delivery`
- `step 10: full hand discard flow`

---

*This spec was written by Ashwin and Claude. Last updated: June 2026.*
