/**
 * tonal.js — Tonal data reader and analysis functions
 * READ ONLY — never modifies source files.
 */

import { readFileSync, statSync } from 'fs';
import { CONFIG } from './config.js';

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
