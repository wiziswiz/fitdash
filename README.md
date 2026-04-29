# fitdash

Fitness intelligence dashboard CLI for Tonal + WHOOP. Reads synced local data — no network calls, no accounts needed at runtime.

## Commands

### Daily use
```bash
fitdash today              # Today's workout + WHOOP strain & recovery
fitdash suggest            # What to train today based on recent muscle groups hit
fitdash digest             # One-liner summary (for morning digest)
fitdash digest --telegram  # Telegram MarkdownV2-safe version
```

### Trends & history
```bash
fitdash week               # 7-day summary with volume, frequency, streak
fitdash week --days 14     # 2-week view
fitdash strength           # Strength score progression (30 days, ASCII sparkline)
fitdash strength --history 90
fitdash trend              # Volume trend bar chart (default 30 days)
fitdash trend --metric strain --days 60
fitdash list               # Recent workouts (last 14 days, all sources)
fitdash list --days 30 --source tonal
fitdash list --source whoop
```

## How `suggest` works

Reads your last 2–3 Tonal sessions, maps every exercise to its muscle groups using a cached Tonal movement catalog (331 exercises), then recommends what to hit today:

- Groups muscles into **Push / Pull / Lower / Core** regions
- Avoids repeating a region trained in the last ~24h
- If WHOOP recovery < 33% → recommends rest instead

Example output:
```
💪 Workout Suggestion

  Today's Focus: Legs / Lower Body
  Yesterday: Triceps, Abs, Shoulders → Upper body hit recently (Push, Core)
```

The digest line includes it automatically:
```
fitdash: last workout Apr 28, 7,645 lbs, recovery 47%, strength 699, streak 3d, today: Legs / Lower Body (yesterday: Triceps + Abs)
```

## Data sources

All files are READ ONLY — synced nightly at 11pm PST via `fitness-nightly-sync`.

| File | Contents |
|------|----------|
| `~/clawd/health-data/tonal/tonal_workouts_latest.json` | Full Tonal workout history |
| `~/clawd/health-data/tonal/tonal_summary.json` | Latest workout snapshot |
| `~/clawd/health-data/tonal/tonal_movements_cache.json` | Movement → muscle group catalog |
| `~/clawd/health-data/whoop/whoop_activity_latest.json` | WHOOP workouts & strain |
| `~/clawd/health-data/whoop/whoop_summary.json` | Recovery, HRV, sleep summary |

## Setup

```bash
npm install
npm link        # makes `fitdash` available globally
```

## Tests

```bash
npx vitest run
```

40 tests covering all commands, edge cases, and MarkdownV2 escaping.

## Environment overrides (for tests)

```bash
FITDASH_TONAL_WORKOUTS=/path/to/test.json
FITDASH_TONAL_SUMMARY=/path/to/summary.json
FITDASH_WHOOP_ACTIVITY=/path/to/activity.json
FITDASH_WHOOP_SUMMARY=/path/to/summary.json
```
