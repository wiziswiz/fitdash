/**
 * tonal.js — Tonal data reader and analysis functions
 * READ ONLY — never modifies source files.
 */

import { readFileSync, statSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { CONFIG } from './config.js';

const MOVEMENTS_CACHE_PATH = join(homedir(), 'clawd', 'health-data', 'tonal', 'tonal_movements_cache.json');

// ─── MUSCLE READINESS (live from Tonal API via sync) ─────────────────────────

/**
 * Load muscle readiness data (0-100 per muscle group).
 * Source: /v6/users/{id}/muscle-readiness/current via tonal-sync.sh
 * Returns null if file not found or stale.
 */
export function loadMuscleReadiness() {
  try {
    const raw = readFileSync(CONFIG.tonal.muscleReadiness, 'utf8');
    const data = JSON.parse(raw);
    return data.readiness || null;
  } catch {
    return null;
  }
}

/**
 * Load strength distribution (percentile among Tonal users).
 * Returns { overallScore, percentile, distributionPoints } or null.
 */
export function loadStrengthDistribution() {
  try {
    const raw = readFileSync(CONFIG.tonal.strengthDistribution, 'utf8');
    const data = JSON.parse(raw);
    return data.distribution || null;
  } catch {
    return null;
  }
}

/**
 * Load current strength scores (by body region, from /strength-scores/current).
 * Returns array of { bodyRegionDisplay, score } or null.
 */
export function loadStrengthCurrent() {
  try {
    const raw = readFileSync(CONFIG.tonal.strengthCurrent, 'utf8');
    const data = JSON.parse(raw);
    return data.scores || null;
  } catch {
    return null;
  }
}

/**
 * Load external activities (WHOOP/Apple Watch synced to Tonal).
 * Returns array of activities or null.
 */
export function loadExternalActivities() {
  try {
    const raw = readFileSync(CONFIG.tonal.externalActivities, 'utf8');
    const data = JSON.parse(raw);
    return data.activities || null;
  } catch {
    return null;
  }
}

// Muscle name → readiness region mapping
const READINESS_TO_REGION = {
  Chest: 'Push', Shoulders: 'Push', Triceps: 'Push',
  Back: 'Pull', Biceps: 'Pull',
  Quads: 'Lower', Glutes: 'Lower', Hamstrings: 'Lower', Calves: 'Lower',
  Abs: 'Core', Obliques: 'Core',
};

/**
 * Suggest today's workout using REAL muscle readiness from Tonal API.
 * Falls back to heuristic-based suggestTodayFocus() if readiness unavailable.
 *
 * @param {Object|null} readiness - from loadMuscleReadiness()
 * @param {number|null} whoopRecovery - 0-100
 * @returns {{ suggestion, muscles, rationale, readinessUsed }}
 */
export function suggestFromReadiness(readiness, whoopRecovery = null) {
  if (!readiness) return null; // caller should fall back to heuristic

  // Recovery override
  if (whoopRecovery !== null && whoopRecovery < 33) {
    return {
      suggestion: 'Rest or Active Recovery',
      muscles: [],
      rationale: `WHOOP recovery ${whoopRecovery}% — body needs rest`,
      readinessUsed: true,
    };
  }

  // Sort muscles by readiness (highest = most recovered)
  const sorted = Object.entries(readiness)
    .map(([muscle, score]) => ({ muscle, score, region: READINESS_TO_REGION[muscle] || 'Other' }))
    .sort((a, b) => b.score - a.score);

  // Group by region, average readiness
  const regionScores = {};
  for (const { muscle, score, region } of sorted) {
    if (!regionScores[region]) regionScores[region] = { total: 0, count: 0, muscles: [] };
    regionScores[region].total += score;
    regionScores[region].count += 1;
    regionScores[region].muscles.push({ muscle, score });
  }

  const regionAvgs = Object.entries(regionScores)
    .filter(([r]) => r !== 'Other')
    .map(([region, { total, count, muscles }]) => ({
      region,
      avg: Math.round(total / count),
      muscles,
    }))
    .sort((a, b) => b.avg - a.avg);

  // Pick the most-recovered region
  const best = regionAvgs[0];
  const worst = regionAvgs[regionAvgs.length - 1];

  const regionNames = { Push: 'Chest & Shoulders', Pull: 'Back & Biceps', Lower: 'Legs / Lower Body', Core: 'Core & Mobility' };

  // If best region is very high and low recovery, suggest lighter
  if (whoopRecovery !== null && whoopRecovery < 50 && best.avg < 60) {
    return {
      suggestion: 'Light Core or Active Recovery',
      muscles: sorted.filter(m => m.score >= 80).map(m => m.muscle),
      rationale: `All regions fatigued (best: ${best.region} ${best.avg}%), WHOOP ${whoopRecovery}%`,
      readinessUsed: true,
    };
  }

  const topMuscles = best.muscles.filter(m => m.score >= 60).map(m => `${m.muscle} (${m.score}%)`);
  const avoidMuscles = worst.muscles.filter(m => m.score < 50).map(m => `${m.muscle} (${m.score}%)`);

  return {
    suggestion: regionNames[best.region] || best.region,
    muscles: topMuscles,
    avoid: avoidMuscles,
    rationale: `${best.region} most recovered (avg ${best.avg}%), avoid ${worst.region} (avg ${worst.avg}%)`,
    readinessUsed: true,
  };
}

// ─── MOVEMENT CATALOG ────────────────────────────────────────────────────────

/**
 * Load the movements catalog cache (built by tonal-sync.sh or on-demand).
 * Returns a map of { movementId -> { name, muscleGroups, bodyRegion } }
 */
export function loadMovementsCache() {
  try {
    if (!existsSync(MOVEMENTS_CACHE_PATH)) return {};
    const raw = readFileSync(MOVEMENTS_CACHE_PATH, 'utf8');
    const arr = JSON.parse(raw);
    const map = {};
    for (const m of arr) {
      map[m.id] = { name: m.name, muscleGroups: m.muscleGroups || [], bodyRegion: m.bodyRegion || '' };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Get muscle groups hit in a single workout.
 * Returns sorted array of primary muscle groups by frequency.
 * @param {Object} workout
 * @param {Object} movementsMap - from loadMovementsCache()
 * @returns {string[]} e.g. ["Back", "Biceps", "Shoulders"]
 */
export function getWorkoutMuscleGroups(workout, movementsMap) {
  const counts = {};
  for (const s of workout.workoutSetActivity || []) {
    const mv = movementsMap[s.movementId];
    if (!mv) continue;
    for (const mg of mv.muscleGroups) {
      counts[mg] = (counts[mg] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([mg]) => mg);
}

// Muscle group → body region mapping for recovery logic (heuristic fallback)
const MUSCLE_REGION = {
  Chest: 'Push', Shoulders: 'Push', Triceps: 'Push',
  Back: 'Pull', Biceps: 'Pull',
  Legs: 'Lower', Glutes: 'Lower', Hamstrings: 'Lower', Quads: 'Lower', Calves: 'Lower',
  Abs: 'Core', Obliques: 'Core',
};

/**
 * Suggest today's workout focus based on recent sessions.
 * Considers:
 *  - Muscle groups hit in last 2-3 workouts
 *  - Recovery heuristic: avoid repeating primary region same day
 *  - Optional WHOOP recovery score (low = lighter/rest)
 *
 * @param {Object} tonalData
 * @param {Object} movementsMap
 * @param {number|null} whoopRecovery - 0-100 score, or null
 * @returns {{ suggestion: string, yesterday: string[], rationale: string }}
 */
export function suggestTodayFocus(tonalData, movementsMap, whoopRecovery = null) {
  const workouts = tonalData?.workouts || [];
  if (workouts.length === 0) {
    return { suggestion: 'Full Body', yesterday: [], rationale: 'No recent workout data' };
  }

  // Gather last 3 workouts with dates
  const recent = workouts.slice(0, 3).map(w => ({
    date: new Date(w.beginTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
    muscles: getWorkoutMuscleGroups(w, movementsMap),
    volume: w.totalVolume || 0,
  }));

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  // What was hit yesterday?
  const yesterdayWorkouts = recent.filter(w => w.date === yesterdayStr || w.date === todayStr);
  const recentMuscles = yesterdayWorkouts.flatMap(w => w.muscles.slice(0, 3));
  const recentRegions = new Set(recentMuscles.map(m => MUSCLE_REGION[m]).filter(Boolean));

  const yesterdayTopMuscles = yesterdayWorkouts.flatMap(w => w.muscles.slice(0, 3));

  // Recovery override
  if (whoopRecovery !== null && whoopRecovery < 33) {
    return {
      suggestion: 'Rest or Active Recovery',
      yesterday: yesterdayTopMuscles,
      rationale: `WHOOP recovery ${whoopRecovery}% — body needs rest`,
    };
  }

  // Determine what to suggest
  const allRegions = ['Push', 'Pull', 'Lower', 'Core'];
  const fresh = allRegions.filter(r => !recentRegions.has(r));

  let suggestion, rationale;
  if (fresh.length === 0) {
    // Everything was hit recently — suggest rest or full body light
    suggestion = whoopRecovery && whoopRecovery >= 67 ? 'Full Body (light)' : 'Rest Day';
    rationale = 'All major groups hit in last 24h';
  } else if (fresh.includes('Lower')) {
    suggestion = 'Legs / Lower Body';
    rationale = `Upper body hit recently (${[...recentRegions].join(', ')})`;
  } else if (fresh.includes('Pull')) {
    suggestion = 'Back & Biceps';
    rationale = `Push muscles hit recently`;
  } else if (fresh.includes('Push')) {
    suggestion = 'Chest & Shoulders';
    rationale = `Pull muscles hit recently`;
  } else {
    suggestion = 'Core & Mobility';
    rationale = 'Primary groups covered — accessory day';
  }

  return { suggestion, yesterday: yesterdayTopMuscles.slice(0, 4), rationale };
}

/**
 * Load Tonal workouts JSON. Returns null if file not found.
 */
export function loadTonalWorkouts() {
  try {
    const raw = readFileSync(CONFIG.tonal.workouts, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`⚠  Tonal workouts file is corrupted (${CONFIG.tonal.workouts}). Re-run nightly sync.\n`);
    } else {
      process.stderr.write(`⚠  Tonal workouts file not found (${CONFIG.tonal.workouts}). Re-run nightly sync.\n`);
    }
    return null;
  }
}

/**
 * Load Tonal summary JSON. Returns null if file not found.
 */
export function loadTonalSummary() {
  try {
    const raw = readFileSync(CONFIG.tonal.summary, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`⚠  Tonal summary file is corrupted (${CONFIG.tonal.summary}). Re-run nightly sync.\n`);
    } else {
      process.stderr.write(`⚠  Tonal summary file not found (${CONFIG.tonal.summary}). Re-run nightly sync.\n`);
    }
    return null;
  }
}

/**
 * Check if the Tonal workouts file is stale (>24h old).
 * Returns { stale: bool, ageMs: number }
 */
export function checkTonalStaleness() {
  try {
    const stat = statSync(CONFIG.tonal.workouts);
    const ageMs = Date.now() - stat.mtimeMs;
    return { stale: ageMs > CONFIG.staleThresholdMs, ageMs };
  } catch {
    return { stale: true, ageMs: Infinity };
  }
}

/**
 * Get Tonal workouts for the last N days.
 * @param {Object} data - Full Tonal workouts data object
 * @param {number} days - Number of days to look back
 * @returns {Array} workouts sorted newest first
 */
export function getTonalWorkoutsForDays(data, days) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return data.workouts.filter(w => {
    const d = new Date(w.beginTime);
    return d >= cutoff;
  });
}

/**
 * Get today's Tonal workout(s).
 * @param {Object} data - Full Tonal workouts data object
 * @returns {Array} workouts from today
 */
export function getTodayTonalWorkouts(data) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }); // YYYY-MM-DD
  return data.workouts.filter(w => {
    const localDate = new Date(w.beginTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    return localDate === todayStr;
  });
}

/**
 * Get current strength scores from strength score history.
 * @param {Object} data - Full Tonal workouts data object
 * @returns {Object|null} { overall, upper, lower, core, activityTime }
 */
export function getCurrentStrengthScores(data) {
  if (!data || !Array.isArray(data.strengthScoreHistory) || data.strengthScoreHistory.length === 0) {
    return null;
  }
  // History is sorted newest first
  return data.strengthScoreHistory[0];
}

/**
 * Get strength score history for last N days.
 * @param {Object} data - Full Tonal workouts data object
 * @param {number} days
 * @returns {Array} strength score entries sorted newest first
 */
export function getStrengthScoreHistory(data, days) {
  if (!data || !Array.isArray(data.strengthScoreHistory)) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return data.strengthScoreHistory.filter(s => {
    return new Date(s.activityTime) >= cutoff;
  });
}

/**
 * Calculate weekly Tonal volume buckets for trend analysis.
 * @param {Object} data - Full Tonal workouts data
 * @param {number} days - Number of days to look back
 * @returns {Array} [{ weekStart, totalVolume, totalReps, workoutCount }]
 */
export function getTonalWeeklyBuckets(data, days) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const workouts = getTonalWorkoutsForDays(data, days);

  const buckets = {};
  for (const w of workouts) {
    const d = new Date(w.beginTime);
    // Get start of week (Monday)
    const dayOfWeek = d.getDay(); // 0=Sun
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(d);
    monday.setDate(monday.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    if (!buckets[key]) {
      buckets[key] = { weekStart: key, totalVolume: 0, totalReps: 0, workoutCount: 0 };
    }
    buckets[key].totalVolume += w.totalVolume || 0;
    buckets[key].totalReps += w.totalReps || 0;
    buckets[key].workoutCount += 1;
  }

  return Object.values(buckets).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Get workout title from contentCard or fallback.
 * @param {Object} workout
 * @returns {string}
 */
export function getWorkoutTitle(workout) {
  if (!workout) return 'Unknown';
  if (workout.contentCard && workout.contentCard.title) return workout.contentCard.title;
  if (workout.workoutType) return workout.workoutType;
  return 'Untitled';
}

/**
 * Format duration in seconds to human-readable string.
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

/**
 * Calculate total volume for a set of workouts.
 */
export function sumVolume(workouts) {
  return workouts.reduce((sum, w) => sum + (w.totalVolume || 0), 0);
}

/**
 * Calculate total reps for a set of workouts.
 */
export function sumReps(workouts) {
  return workouts.reduce((sum, w) => sum + (w.totalReps || 0), 0);
}
