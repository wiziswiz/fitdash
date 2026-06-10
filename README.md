# fitdash

> **Fitness intelligence + workout builder for Tonal + WHOOP — one CLI.**

fitdash **syncs** your Tonal & WHOOP data, **analyzes** it offline, and **builds custom workouts straight onto your Tonal**. It's the read → think → act loop for your training, in your terminal.

```
   ┌──────────┐      ┌────────────┐      ┌─────────────────┐
   │  sync    │ ───▶ │  analyze   │ ───▶ │  build workouts │
   │ (online) │      │ (offline)  │      │    (online)     │
   └──────────┘      └────────────┘      └─────────────────┘
   download data     today/week/...      workout create
```

---

## ✨ What's new in v2.0

fitdash used to be an offline viewer that depended on an external sync script. Now it's the whole pipeline:

- **`fitdash sync`** — logs in and downloads all your data itself. No external script.
- **`fitdash workout create`** — builds real custom workouts on your Tonal via the API.
- **`fitdash workout create --from-suggest`** — the *smart loop*: takes today's recommended focus and **builds that workout for you automatically**.
- **`fitdash workout list / delete / movements`** — manage workouts and search the exercise library.
- **Auto-correcting workout builder** — handles Tonal's rep-vs-duration rules so your workouts don't get rejected.
- **Safe by design** — credentials live in env/file only, never committed; the entire analyze side stays 100% offline.

---

## Two kinds of commands

| | Commands | Network? | Credentials? |
|---|---|---|---|
| 🔌 **Online** | `sync`, `workout …` | Yes — talks to Tonal | Yes |
| 📊 **Offline** | `today`, `week`, `strength`, `trend`, `suggest`, `readiness`, `digest`, `list` | No | No |

You only ever supply credentials for the online commands. The dashboard/analysis side reads the local files `sync` produced and never logs in.

---

## Quickstart

```bash
# 1. Install
npm install && npm link

# 2. Add credentials (one time)
mkdir -p ~/.config/fitdash
cat > ~/.config/fitdash/credentials <<'EOF'
TONAL_EMAIL=you@example.com
TONAL_PASSWORD=your-tonal-password
EOF
chmod 600 ~/.config/fitdash/credentials

# 3. Pull your data
fitdash sync

# 4. See where you stand
fitdash today
fitdash suggest

# 5. Build today's recommended workout onto your Tonal
fitdash workout create --from-suggest
```

That's the full loop: sync → see what to train → build it.

---

## Setup

```bash
npm install
npm link        # makes `fitdash` available globally
```

### Credentials (only for `sync` and `workout`)

Set env vars:
```bash
export TONAL_EMAIL="you@example.com"
export TONAL_PASSWORD="your-tonal-password"
```

…or create `~/.config/fitdash/credentials` (KEY=VALUE, then `chmod 600`):
```
TONAL_EMAIL=you@example.com
TONAL_PASSWORD=your-tonal-password
```

Nothing else is required. Your Tonal `user_id` and the exercise library are fetched automatically after login. Credentials are `.gitignore`d and never committed.

---

## 🔌 Online commands

### Sync your data
```bash
fitdash sync
```
Logs in and downloads workouts, strength scores, muscle readiness, strength distribution, and the exercise catalog → local JSON. Run it before the offline commands (or on a nightly cron). fitdash owns its own pipeline — no external sync script needed.

```
✓ Sync complete

  Workouts:        214
  Movement library:331 exercises
  Strength points: 180
  Muscle readiness: ✓
  Distribution:     ✓

  Latest: Upper Body Power on 2026-06-08 — 7,645 lbs
```

### Build & manage workouts
```bash
fitdash workout create my-workout.json          # create from a spec file
fitdash workout create my-workout.json --dry-run # preview the payload, send nothing
fitdash workout create --from-suggest           # build today's SUGGESTED focus automatically
fitdash workout create --from-suggest --rounds 4
fitdash workout list                            # your custom workouts
fitdash workout delete <id>                      # remove one
fitdash workout movements --search shrug         # search Tonal's exercise library
```

### Workout spec format

A friendly JSON spec — fitdash translates it into Tonal's flat set grid for you:

```json
{
  "title": "Abs + Obliques + Traps",
  "rounds": 4,
  "exercises": [
    { "name": "V-Up",          "reps": 8 },
    { "name": "Standing Lift", "reps": 15 },
    { "name": "Shoulder Shrug","reps": 12, "weightPercentage": 100 }
  ]
}
```

- **`rounds`** = circuit passes. 3 exercises × 4 rounds = 12 sets, laid out automatically (setGroup × round grid, `blockStart` handled).
- Use **`reps`** *or* **`duration`** (seconds) per exercise. fitdash auto-corrects to whatever the movement requires and warns you.
- **`weightPercentage`** defaults to 100 (Tonal scales the actual load from your strength score).

#### Reps vs. duration — handled automatically (no more HTTP 400)

Every Tonal exercise is either rep-counted or time-counted:
- **rep-based** (`countReps: true`) → needs reps. e.g. Shoulder Shrug, most crunches.
- **timed** (`countReps: false`) → needs duration in seconds. e.g. planks, marches, most off-machine ab moves.

Give the wrong measure and Tonal rejects the whole workout. fitdash detects the mismatch, converts it (~3s/rep), and prints a warning instead of failing:

```
  ⚠  "V-Up" is timed (Tonal can't count its reps); converted 8 reps → 24s.
  ⚠  "V-Up" is off-machine — Tonal won't track its weight (no cable tension).
```

Off-machine moves (Tonal can't weigh a dumbbell/bench exercise — it only reads its own cables) are flagged too.

#### ⚠️ "Accepted" ≠ instantly visible

A successful create returns HTTP 200 and shows on your Tonal **device** quickly, but the **phone app** caches — pull-to-refresh (or force-quit and reopen) and it'll appear. There's no separate publish step; the create call alone is enough.

---

## 📊 Offline commands

### Daily
```bash
fitdash today              # Today's workout + WHOOP strain & recovery
fitdash suggest            # What to train today (muscle readiness + recovery)
fitdash digest             # One-liner summary (for a morning digest)
fitdash digest --telegram  # Telegram MarkdownV2-safe
```

### Trends & history
```bash
fitdash week               # 7-day summary: volume, frequency, streak
fitdash week --days 14
fitdash strength           # Strength score progression (30d, ASCII sparkline)
fitdash strength --history 90
fitdash trend --metric strain --days 60
fitdash list --days 30 --source tonal
fitdash readiness          # Per-muscle readiness heatmap
```

---

## 🧠 The smart loop

This is the headline feature. `suggest` figures out what to train; `workout create --from-suggest` **builds it for you**:

```bash
$ fitdash suggest
💪 Today's Focus: Core & Mobility
   Ready: Abs (88%), Obliques (82%)  ⚠️ Avoid: Back (41%)

$ fitdash workout create --from-suggest --rounds 4
Focus from suggest: Core & Mobility
🏗️  Core & Mobility (auto)
   12 sets across 3 exercises
✓ Tonal accepted it (id=afa69c7b-…)
  ⚠  Pull-to-refresh the Tonal app and it'll appear.
```

Read → analyze → write, all in one command.

### How `suggest` works
Reads your last 2–3 sessions, maps every exercise to its muscle groups via the cached catalog, then recommends a focus:
- Groups muscles into **Push / Pull / Lower / Core**
- Avoids repeating a region trained in the last ~24h
- Prefers real **muscle readiness** data when present; falls back to a heuristic
- If WHOOP recovery < 33% → recommends rest

---

## Data files

`sync` writes these; the offline commands read them. Default location `~/clawd/health-data/` (override via env).

- `tonal/tonal_workouts_latest.json` — full workout history + strength scores
- `tonal/tonal_summary.json` — latest workout snapshot
- `tonal/tonal_movements_cache.json` — exercise → muscle-group catalog
- `tonal/tonal_muscle_readiness.json` — per-muscle readiness (0–100)
- `tonal/tonal_strength_distribution.json` — percentile among Tonal users
- `whoop/whoop_activity_latest.json`, `whoop/whoop_summary.json` — WHOOP (synced separately)

---

## Architecture

```
index.js                 # CLI command router (commander)
lib/
  auth.js                # credential resolution + Auth0 login  (online)
  tonal-api.js           # Tonal /v6 client: connect, CRUD, fetch  (online)
  sync.js                # writes API data → local JSON files  (online)
  workout-spec.js        # friendly spec → Tonal payload + rep/duration guard
  tonal.js               # offline readers + analysis
  whoop.js               # offline WHOOP readers
  insights.js            # streaks, trends, recommendations
  format.js              # sparklines, MarkdownV2, number/date formatting
  config.js              # data-file paths (env-overridable)
```

The online layer (`auth`, `tonal-api`, `sync`) is fully isolated from the offline layer — the analysis commands never import or trigger it.

---

## Tests

```bash
npx vitest run
```

**58 tests:** offline analysis & formatting (40) + workout-spec builder including the rep-vs-duration guard, circuit flattening, and suggest templating (18).

---

## Environment overrides

```bash
# Data file locations
FITDASH_TONAL_WORKOUTS=/path/to/workouts.json
FITDASH_TONAL_MOVEMENTS=/path/to/movements.json
FITDASH_WHOOP_SUMMARY=/path/to/summary.json

# Tonal API (defaults are the public app constants; rarely needed)
TONAL_API_BASE, TONAL_AUTH0_DOMAIN, TONAL_CLIENT_ID, TONAL_APP_VERSION
```

---

## Notes

- Tonal's `/v6` API is private/undocumented — use it only on **your own** account.
- Auth uses the Auth0 password grant; fitdash uses the returned `id_token` as Bearer (not `access_token`).
- Built on Node 18+ (native `fetch`). No runtime deps beyond `commander` + `chalk`.
