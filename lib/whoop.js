/**
 * whoop.js — WHOOP data reader and analysis functions
 * READ ONLY — never modifies source files.
 */

import { readFileSync, statSync } from 'fs';
import { CONFIG } from './config.js';

/**
 * Load WHOOP activity JSON. Returns null if file not found.
 */
export function loadWhoopActivity() {
  try {
    const raw = readFileSync(CONFIG.whoop.activity, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`⚠  WHOOP activity file is corrupted (${CONFIG.whoop.activity}). Re-run nightly sync.\n`);
    } else {
      process.stderr.write(`⚠  WHOOP activity file not found (${CONFIG.whoop.activity}). Re-run nightly sync.\n`);
    }
    return null;
  }
}

/**
 * Load WHOOP summary JSON. Returns null if file not found.
 */
export function loadWhoopSummary() {
  try {
    const raw = readFileSync(CONFIG.whoop.summary, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      process.stderr.write(`⚠  WHOOP summary file is corrupted (${CONFIG.whoop.summary}). Re-run nightly sync.\n`);
    } else {
      process.stderr.write(`⚠  WHOOP summary file not found (${CONFIG.whoop.summary}). Re-run nightly sync.\n`);
    }
    return null;
  }
}

/**
 * Check if WHOOP activity file is stale.
 */
export function checkWhoopStaleness() {
  try {
    const stat = statSync(CONFIG.whoop.activity);
    const ageMs = Date.now() - stat.mtimeMs;
    return { stale: ageMs > CONFIG.staleThresholdMs, ageMs };
  } catch {
    return { stale: true, ageMs: Infinity };
  }
}

/**
 * Get WHOOP workouts for the last N days.
 */
export function getWhoopWorkoutsForDays(data, days) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return data.workouts.filter(w => {
    const d = new Date(w.start);
    return d >= cutoff;
  });
}

/**
 * Get today's WHOOP workouts.
 */
export function getTodayWhoopWorkouts(data) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  return data.workouts.filter(w => {
    // Adjust for timezone_offset
    const localDate = new Date(w.start).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    return localDate === todayStr;
  });
}

/**
 * Get recovery info from WHOOP summary. Gracefully handles null recovery.
 * @returns {Object} { score: number|null, hrv: number|null, rhr: number|null, date: string|null }
 */
export function getRecoveryInfo(summaryData) {
  if (!summaryData || !summaryData.recovery) {
    return { score: null, hrv: null, rhr: null, date: null };
  }
  const r = summaryData.recovery;
  return {
    score: r.recovery_score ?? null,
    hrv: r.hrv_rmssd_milli ?? null,
    rhr: r.resting_heart_rate ?? null,
    date: r.date ?? null,
  };
}

/**
 * Format a WHOOP workout into a display object.
 * @param {Object} workout - WHOOP workout record
 * @returns {Object} display-ready object
 */
export function formatWhoopWorkout(workout) {
  if (!workout) return null;
  const score = workout.score || {};
  const startDate = new Date(workout.start);
  const endDate = new Date(workout.end);
  const durationMs = endDate - startDate;
  // Guard: end may be null for in-progress workouts
  const durationMin = (isNaN(durationMs) || durationMs < 0) ? 0 : Math.round(durationMs / 60000);

  return {
    date: startDate.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),
    sport: workout.sport_name || 'unknown',
    durationMin,
    strain: score.strain != null ? Math.round(score.strain * 10) / 10 : null,
    avgHr: score.average_heart_rate ?? null,
    maxHr: score.max_heart_rate ?? null,
    calories: score.kilojoule != null ? Math.round(score.kilojoule / 4.184) : null, // kJ to kcal
    distanceMiles: score.distance_meter != null ? Math.round(score.distance_meter / 1609.34 * 100) / 100 : null,
    scoreState: workout.score_state || 'UNKNOWN',
  };
}

/**
 * Calculate total strain for a set of WHOOP workouts.
 */
export function sumStrain(workouts) {
  return workouts.reduce((sum, w) => {
    const strain = w.score?.strain ?? 0;
    return sum + strain;
  }, 0);
}

/**
 * Calculate total calories for a set of WHOOP workouts.
 */
export function sumCalories(workouts) {
  return workouts.reduce((sum, w) => {
    const kj = w.score?.kilojoule ?? 0;
    return sum + Math.round(kj / 4.184);
  }, 0);
}

/**
 * Get recovery recommendation based on score.
 * Handles null gracefully.
 * @param {number|null} score
 * @returns {string}
 */
export function getRecoveryRecommendation(score) {
  if (score === null || score === undefined) return 'recovery not yet scored';
  if (score >= 67) return 'green — train hard';
  if (score >= 34) return 'yellow — moderate effort';
  return 'red — rest or light activity';
}

/**
 * Get WHOOP weekly buckets for trend analysis.
 */
export function getWhoopWeeklyBuckets(data, days) {
  if (!data || !Array.isArray(data.workouts)) return [];
  const workouts = getWhoopWorkoutsForDays(data, days);

  const buckets = {};
  for (const w of workouts) {
    const d = new Date(w.start);
    const dayOfWeek = d.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(d);
    monday.setDate(monday.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);

    if (!buckets[key]) {
      buckets[key] = { weekStart: key, totalStrain: 0, workoutCount: 0, totalCalories: 0 };
    }
    buckets[key].totalStrain += w.score?.strain ?? 0;
    buckets[key].workoutCount += 1;
    buckets[key].totalCalories += Math.round((w.score?.kilojoule ?? 0) / 4.184);
  }

  return Object.values(buckets).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
