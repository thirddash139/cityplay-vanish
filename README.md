# CityPlay — Vanish (PWA)

A real-world hide-and-seek game for Chicago neighbourhoods. Installs as an app on iPhone or Android, works offline once loaded.

## What's in this folder

```
cityplay/
├── index.html          ← The app
├── manifest.json       ← PWA manifest (name, icons, display mode)
├── service-worker.js   ← Offline support (caches map tiles + app shell)
├── icon.svg            ← Source icon
├── icon-192.png        ← PWA icon
├── icon-512.png        ← PWA icon (large)
├── icon-maskable.png   ← Android adaptive icon
├── apple-touch-icon.png← iOS home-screen icon
└── README.md           ← This file
```

Total size: about 200KB. Loads in ~1 second on 4G.

## Deploy to Cloudflare Pages (free, ~3 minutes)

### Option A — Drag and drop (easiest)

1. Go to https://dash.cloudflare.com → **Workers & Pages** → **Create**
2. Choose **Pages** → **Upload assets**
3. Project name: `cityplay-vanish` (or anything you like)
4. Drag the entire `cityplay` folder onto the upload zone
5. Click **Deploy site**
6. Cloudflare gives you a URL like `https://cityplay-vanish.pages.dev` — that's your app

### Option B — CLI deploy

```bash
npm install -g wrangler
cd cityplay
wrangler pages deploy . --project-name=cityplay-vanish
```

### Custom domain (optional)
In the Cloudflare dashboard, go to your project → **Custom domains** → add `vanish.yourdomain.com`. SSL is automatic.

## Installing on a phone

**iPhone:**
1. Open the URL in Safari
2. Tap the Share button (square with arrow)
3. Scroll down → "Add to Home Screen"
4. The app icon appears on the home screen — tap to launch full-screen

**Android:**
1. Open the URL in Chrome
2. Tap the menu (⋮) → "Install app" or "Add to Home Screen"
3. App icon installed — tap to launch full-screen

Once installed, the app:
- Opens full-screen like a native app
- Works offline (everything is cached on first load)
- Updates automatically next time it's opened with internet
- Has its own icon on the home screen

## How the game works

**The hider** taps "I'm the Hider", gets a 6-character code (e.g. `K3JM7P`), and shares the code or shareable link with the seekers. The hider's GPS is tracked so the app knows where they actually are.

**The seekers** can either tap "I'm the Seeker" and start independently, or tap "Join with code" / open the shared link to join a hider's game. They pick neighbourhoods to define the hunt zone, then start asking intel questions.

**The 5 question types:**
- **Radar** — "Are you within X miles of me?" (carves a circle)
- **Matching** — "Is your nearest [park/library/etc] the same as mine?" (Voronoi cell)
- **Measuring** — "Closer or further from [Willis Tower etc]?" (perpendicular bisector)
- **Thermometer** — Pin Point A and Point B on map, "Hotter or colder?" (perp bisector of the two pins)
- **Tentacles** — "Of all [type] within 1 mile of me, which is closest to you?" (locks Voronoi cell)

Each answered question shrinks the active zone. The seeker walks/drives toward whatever portion of the zone hasn't been eliminated.

---

## ⚠️ What's NOT yet implemented

**Real-time location sync between phones.** Currently the hider can generate a code and share the link, but the seeker won't actually see the hider's live position on their map — that requires a backend.

To finish this, we need a small server that holds active games in memory and relays locations between phones. The simplest path is **Firebase Realtime Database** (free tier handles thousands of games). About a 30-line addition to the app and a 5-minute Firebase setup. Let me know when you want to wire that up.

For now, the app works perfectly for solo testing or for in-person games where you can verbally agree on rules.

## Updating the app

Edit any file → redeploy (drag-and-drop again, or `wrangler pages deploy .`). Users get the new version automatically next time they open the app with internet.
