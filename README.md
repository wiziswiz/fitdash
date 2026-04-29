# fitdash — Fitness Intelligence Dashboard CLI

Tonal + WHOOP data, surfaced beautifully. No network calls. Reads synced JSON files.

## Commands

```bash
fitdash today             # Today's Tonal workout + WHOOP strain/recovery
fitdash week              # Weekly summary (default 7 days)
fitdash week --days 14    # 2-week summary
fitdash strength          # Strength score progression (default 30 days)
fitdash strength --history 90  # 90-day strength history
fitdash trend             # Volume trend (default 30 days)
fitdash trend --metric strain --days 60
fitdash list              # Recent workouts (default 14 days, all sources)
fitdash list --days 30 --source tonal
fitdash list --source whoop
fitdash digest            # One-liner for morning digest
fitdash digest --telegram # Telegram MarkdownV2-safe output
```

## Data Sources

All data is READ ONLY. Synced nightly at 11pm.

| File | Contents |
|------|----------|
| `~/clawd/health-data/tonal/tonal_workouts_latest.json` | Full Tonal history |
| `~/clawd/health-data/tonal/tonal_summary.json` | Latest workout snapshot |
| `~/clawd/health-data/whoop/whoop_activity_latest.json` | WHOOP workouts |
| `~/clawd/health-data/whoop/whoop_summary.json` | Recovery/HRV summary |

## Environment Overrides (for tests)

```bash
FITDASH_TONAL_WORKOUTS=/path/to/test.json
FITDASH_TONAL_SUMMARY=/path/to/summary.json
FITDASH_WHOOP_ACTIVITY=/path/to/activity.json
FITDASH_WHOOP_SUMMARY=/path/to/summary.json
```

## Build

```bash
npm install && npm link
```

## Tests

```bash
npx vitest run
```
