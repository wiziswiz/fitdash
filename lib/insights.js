/**
 * insights.js — Cross-source fitness insights (Tonal + WHOOP combined)
 */

import { getRecoveryRecommendation } from './whoop.js';

/**
 * Calculate workout streak — consecutive days with at least one workout.
 * @param {Array} tonalWorkouts - array of Tonal workout objects
 * @param {Array} whoopWorkouts - array of WHOOP workout objects
 * @returns {number} streak in days
 */
export function calculateStreak(tonalWorkouts, whoopWorkouts) {
  const allDates = new Set();

  for (const w of (tonalWorkouts || [])) {
    const d = new Date(w.beginTime).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    allDates.add(d);
  }
  for (const w of (whoopWorkouts || [])) {
    const d = new Date(w.start).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    allDates.add(d);
  }

  let streak = 0;
  const today = new Date();

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    if (allDates.has(dateStr)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Determine training recommendation based on recovery score and recent strain.
 * @param {number|null} recoveryScore
 * @param {number} recentAvgStrain - avg strain over last 3 workouts
 * @returns {string}
 */
export function getTrainingRecommendation(recoveryScore, recentAvgStrain) {
  const rec = getRecoveryRecommendation(recoveryScore);

  if (recoveryScore === null) {
    return 'recovery not yet scored — listen to your body';
  }

  if (recoveryScore >= 67) {
    if (recentAvgStrain > 12) return 'green recovery ✓ — consider deload (high recent strain)';
    return 'green recovery ✓ — good day to push';
  }

  if (recoveryScore >= 34) {
    return 'yellow recovery — moderate effort recommended';
  }

  return 'red recovery — rest or light activity only';
}

/**
 * Compare current week vs prior week metrics.
 * @param {Array} currentBuckets - this week's data
 * @param {Array} priorBuckets - prior week's data
 * @param {string} metric - 'totalVolume' | 'workoutCount' | 'totalStrain'
 * @returns {number|null} fractional change (0.1 = +10%), null if no prior data
 */
export function weekOverWeekChange(currentBuckets, priorBuckets, metric) {
  if (!priorBuckets || priorBuckets.length === 0) return null;
  if (!currentBuckets || currentBuckets.length === 0) return null;

  const current = currentBuckets[currentBuckets.length - 1]?.[metric] ?? 0;
  const prior = priorBuckets[priorBuckets.length - 1]?.[metric] ?? 0;

  if (prior === 0) return null;
  return (current - prior) / prior;
}

/**
 * Get the peak volume week from all Tonal data.
 * @param {Array} weeklyBuckets - all weekly Tonal buckets
 * @returns {Object|null} { weekStart, totalVolume }
 */
export function getPeakVolumeWeek(weeklyBuckets) {
  if (!weeklyBuckets || weeklyBuckets.length === 0) return null;
  return weeklyBuckets.reduce((max, b) => (!max || b.totalVolume > max.totalVolume) ? b : max, null);
}

/**
 * Calculate strength trend direction over a history of scores.
 * @param {Array} history - array of { overall, upper, lower, core, activityTime }
 * @param {string} key - 'overall' | 'upper' | 'lower' | 'core'
 * @returns {'up'|'down'|'flat'|'insufficient data'}
 */
export function strengthTrend(history, key) {
  if (!history || history.length < 2) return 'insufficient data';
  const sorted = [...history].sort((a, b) => new Date(a.activityTime) - new Date(b.activityTime));
  const recent = sorted.slice(-5); // last 5 data points
  // Filter out null/undefined values before computing trend
  const values = recent.map(s => s[key]).filter(v => v != null);
  if (values.length < 2) return 'insufficient data';
  const first = values[0];
  const last = values[values.length - 1];
  const diff = last - first;
  if (Math.abs(diff) < 5) return 'flat';
  return diff > 0 ? 'up' : 'down';
}
