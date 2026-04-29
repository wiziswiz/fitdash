/**
 * fitdash.test.js — Vitest tests for fitdash core functions
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

// ── Test fixture setup ──────────────────────────────────────────────────────

const TMP = join(tmpdir(), `fitdash-test-${Date.now()}`);
mkdirSync(TMP, { recursive: true });

// Minimal Tonal workouts fixture
const TONAL_WORKOUTS = {
  version: '3.0',
  exportedAt: new Date().toISOString(),
  workouts: [
    {
      id: 'w1',
      beginTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 3600000).toISOString(),
      totalDuration: 3600,
      activeDuration: 400,
      totalMovements: 6,
      totalSets: 18,
      totalReps: 150,
      totalVolume: 8000,
      workoutType: 'Linear',
      contentCard: null,
    },
    {
      id: 'w2',
      beginTime: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days ago
      endTime: new Date(Date.now() - 2 * 86400000 + 3000000).toISOString(),
      totalDuration: 3000,
      activeDuration: 350,
      totalMovements: 5,
      totalSets: 15,
      totalReps: 120,
      totalVolume: 6000,
      workoutType: 'Linear',
      contentCard: null,
    },
    {
      id: 'w3',
      beginTime: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days ago
      endTime: new Date(Date.now() - 10 * 86400000 + 3000000).toISOString(),
      totalDuration: 2800,
      activeDuration: 300,
      totalMovements: 4,
      totalSets: 12,
      totalReps: 90,
      totalVolume: 4000,
      workoutType: 'Linear',
      contentCard: { title: 'Upper Body Power' },
    },
  ],
  strengthScoreHistory: [
    { id: 's1', overall: 699, upper: 794, lower: 511, core: 791, activityTime: new Date().toISOString() },
    { id: 's2', overall: 680, upper: 770, lower: 500, core: 775, activityTime: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 's3', overall: 650, upper: 740, lower: 480, core: 755, activityTime: new Date(Date.now() - 14 * 86400000).toISOString() },
    { id: 's4', overall: 600, upper: 700, lower: 450, core: 720, activityTime: new Date(Date.now() - 30 * 86400000).toISOString() },
    { id: 's5', overall: 531, upper: 519, lower: 534, core: 540, activityTime: new Date(Date.now() - 90 * 86400000).toISOString() },
  ],
};

// Minimal WHOOP activity fixture
const WHOOP_ACTIVITY = {
  fetched_at: new Date().toISOString(),
  workout_count_7d: 3,
  workouts: [
    {
      id: 'wh1',
      start: new Date().toISOString(),
      end: new Date(Date.now() + 2800000).toISOString(),
      timezone_offset: '-07:00',
      sport_name: 'weightlifting',
      score_state: 'SCORED',
      score: { strain: 11.94, average_heart_rate: 113, max_heart_rate: 167, kilojoule: 1073.76 },
    },
    {
      id: 'wh2',
      start: new Date(Date.now() - 2 * 86400000).toISOString(),
      end: new Date(Date.now() - 2 * 86400000 + 780000).toISOString(),
      timezone_offset: '-07:00',
      sport_name: 'running',
      score_state: 'SCORED',
      score: { strain: 9.21, average_heart_rate: 154, max_heart_rate: 185, kilojoule: 763.16, distance_meter: 1767.38 },
    },
    {
      id: 'wh3',
      start: new Date(Date.now() - 10 * 86400000).toISOString(),
      end: new Date(Date.now() - 10 * 86400000 + 2400000).toISOString(),
      timezone_offset: '-07:00',
      sport_name: 'weightlifting',
      score_state: 'SCORED',
      score: { strain: 12.63, average_heart_rate: 118, max_heart_rate: 179, kilojoule: 1267.14 },
    },
  ],
};

// WHOOP summary with null recovery (common real-world case)
const WHOOP_SUMMARY_NULL_RECOVERY = {
  fetched_at: new Date().toISOString(),
  workout_count_7d: 9,
  recovery: {
    date: new Date().toLocaleDateString('en-CA'),
    recovery_score: null,
    hrv_rmssd_milli: null,
    resting_heart_rate: null,
  },
  workouts: WHOOP_ACTIVITY.workouts,
};

const WHOOP_SUMMARY_SCORED = {
  ...WHOOP_SUMMARY_NULL_RECOVERY,
  recovery: { date: '2026-04-28', recovery_score: 72, hrv_rmssd_milli: 48.5, resting_heart_rate: 54 },
};

// Write fixtures to tmp
const TONAL_WORKOUTS_PATH = join(TMP, 'tonal_workouts_latest.json');
const WHOOP_ACTIVITY_PATH = join(TMP, 'whoop_activity_latest.json');
const WHOOP_SUMMARY_PATH = join(TMP, 'whoop_summary.json');

writeFileSync(TONAL_WORKOUTS_PATH, JSON.stringify(TONAL_WORKOUTS));
writeFileSync(WHOOP_ACTIVITY_PATH, JSON.stringify(WHOOP_ACTIVITY));
writeFileSync(WHOOP_SUMMARY_PATH, JSON.stringify(WHOOP_SUMMARY_NULL_RECOVERY));

// Set env for config to pick up test fixtures
process.env.FITDASH_TONAL_WORKOUTS = TONAL_WORKOUTS_PATH;
process.env.FITDASH_WHOOP_ACTIVITY = WHOOP_ACTIVITY_PATH;
process.env.FITDASH_WHOOP_SUMMARY = WHOOP_SUMMARY_PATH;

// ── Import modules after env set ────────────────────────────────────────────

const {
  loadTonalWorkouts,
  getTodayTonalWorkouts,
  getTonalWorkoutsForDays,
  getStrengthScoreHistory,
  getTonalWeeklyBuckets,
  getCurrentStrengthScores,
  getWorkoutTitle,
  formatDuration,
  sumVolume,
  sumReps,
} = await import('../lib/tonal.js');

const {
  loadWhoopActivity,
  loadWhoopSummary,
  getTodayWhoopWorkouts,
  getWhoopWorkoutsForDays,
  getRecoveryInfo,
  formatWhoopWorkout,
  sumStrain,
  sumCalories,
  getRecoveryRecommendation,
} = await import('../lib/whoop.js');

const {
  calculateStreak,
  getTrainingRecommendation,
  weekOverWeekChange,
  getPeakVolumeWeek,
  strengthTrend,
} = await import('../lib/insights.js');

const {
  escapeMdV2,
  sparkline,
  commaNum,
  pct,
  formatChange,
  shortDate,
  formatAge,
  capitalize,
} = await import('../lib/format.js');

// ── Tests: tonal.js ─────────────────────────────────────────────────────────

describe('tonal.js', () => {
  it('loadTonalWorkouts returns object with workouts array', () => {
    const data = loadTonalWorkouts();
    expect(data).not.toBeNull();
    expect(Array.isArray(data.workouts)).toBe(true);
    expect(data.workouts.length).toBe(3);
  });

  it('getTodayTonalWorkouts returns only today workouts', () => {
    const data = loadTonalWorkouts();
    const today = getTodayTonalWorkouts(data);
    expect(Array.isArray(today)).toBe(true);
    expect(today.length).toBeGreaterThanOrEqual(1);
    expect(today[0].id).toBe('w1');
  });

  it('getTonalWorkoutsForDays respects day cutoff', () => {
    const data = loadTonalWorkouts();
    const last7 = getTonalWorkoutsForDays(data, 7);
    expect(last7.length).toBe(2); // w1 (today) + w2 (2 days ago), not w3 (10 days ago)
  });

  it('getTonalWorkoutsForDays returns all within 14 days', () => {
    const data = loadTonalWorkouts();
    const last14 = getTonalWorkoutsForDays(data, 14);
    expect(last14.length).toBe(3);
  });

  it('getCurrentStrengthScores returns latest scores', () => {
    const data = loadTonalWorkouts();
    const scores = getCurrentStrengthScores(data);
    expect(scores).not.toBeNull();
    expect(scores.overall).toBe(699);
    expect(scores.upper).toBe(794);
  });

  it('getStrengthScoreHistory filters by days', () => {
    const data = loadTonalWorkouts();
    const recent = getStrengthScoreHistory(data, 10);
    expect(recent.length).toBeLessThanOrEqual(data.strengthScoreHistory.length);
    expect(recent.length).toBeGreaterThanOrEqual(2); // s1 + s2
  });

  it('getTonalWeeklyBuckets groups workouts by week', () => {
    const data = loadTonalWorkouts();
    const buckets = getTonalWeeklyBuckets(data, 30);
    expect(Array.isArray(buckets)).toBe(true);
    expect(buckets.length).toBeGreaterThan(0);
    buckets.forEach(b => {
      expect(b).toHaveProperty('weekStart');
      expect(b).toHaveProperty('totalVolume');
      expect(b).toHaveProperty('workoutCount');
    });
  });

  it('getWorkoutTitle falls back gracefully', () => {
    expect(getWorkoutTitle({ contentCard: { title: 'Push Pull Legs' } })).toBe('Push Pull Legs');
    expect(getWorkoutTitle({ contentCard: null, workoutType: 'Linear' })).toBe('Linear');
    expect(getWorkoutTitle({ contentCard: null, workoutType: null })).toBe('Untitled');
    expect(getWorkoutTitle(null)).toBe('Unknown');
  });

  it('formatDuration handles edge cases', () => {
    expect(formatDuration(3600)).toBe('60m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(0)).toBe('N/A');
    expect(formatDuration(null)).toBe('N/A');
  });

  it('sumVolume and sumReps aggregate correctly', () => {
    const data = loadTonalWorkouts();
    const workouts = getTonalWorkoutsForDays(data, 7);
    expect(sumVolume(workouts)).toBe(14000); // w1 8000 + w2 6000
    expect(sumReps(workouts)).toBe(270);     // 150 + 120
  });
});

// ── Tests: whoop.js ─────────────────────────────────────────────────────────

describe('whoop.js', () => {
  it('loadWhoopActivity returns object with workouts', () => {
    const data = loadWhoopActivity();
    expect(data).not.toBeNull();
    expect(Array.isArray(data.workouts)).toBe(true);
  });

  it('getTodayWhoopWorkouts returns today workouts', () => {
    const data = loadWhoopActivity();
    const today = getTodayWhoopWorkouts(data);
    expect(Array.isArray(today)).toBe(true);
    expect(today.length).toBeGreaterThanOrEqual(1);
  });

  it('getWhoopWorkoutsForDays respects cutoff', () => {
    const data = loadWhoopActivity();
    const last7 = getWhoopWorkoutsForDays(data, 7);
    expect(last7.length).toBe(2); // wh1 (today) + wh2 (2 days ago)
  });

  it('getRecoveryInfo handles null recovery gracefully', () => {
    const summaryData = loadWhoopSummary();
    const rec = getRecoveryInfo(summaryData);
    expect(rec.score).toBeNull();
    expect(rec.hrv).toBeNull();
    expect(rec.rhr).toBeNull();
  });

  it('getRecoveryInfo handles scored recovery', () => {
    const rec = getRecoveryInfo(WHOOP_SUMMARY_SCORED);
    expect(rec.score).toBe(72);
    expect(rec.hrv).toBe(48.5);
    expect(rec.rhr).toBe(54);
  });

  it('getRecoveryInfo handles missing recovery field', () => {
    const rec = getRecoveryInfo({});
    expect(rec.score).toBeNull();
  });

  it('formatWhoopWorkout produces display object', () => {
    const w = WHOOP_ACTIVITY.workouts[1]; // running
    const fmt = formatWhoopWorkout(w);
    expect(fmt.sport).toBe('running');
    expect(typeof fmt.durationMin).toBe('number');
    expect(fmt.durationMin).toBeGreaterThan(0);
    expect(fmt.strain).toBe(9.2); // rounded to 1 decimal
    expect(fmt.distanceMiles).toBeGreaterThan(0);
  });

  it('getRecoveryRecommendation handles all score ranges', () => {
    expect(getRecoveryRecommendation(null)).toContain('not yet scored');
    expect(getRecoveryRecommendation(80)).toContain('green');
    expect(getRecoveryRecommendation(50)).toContain('yellow');
    expect(getRecoveryRecommendation(20)).toContain('red');
  });

  it('sumStrain aggregates WHOOP workouts', () => {
    const data = loadWhoopActivity();
    const workouts = data.workouts;
    const total = sumStrain(workouts);
    expect(total).toBeGreaterThan(0);
    expect(Math.round(total * 10) / 10).toBeCloseTo(11.94 + 9.21 + 12.63, 1);
  });

  it('sumCalories converts kJ to kcal', () => {
    const data = loadWhoopActivity();
    const cals = sumCalories(data.workouts);
    expect(cals).toBeGreaterThan(0);
  });
});

// ── Tests: insights.js ───────────────────────────────────────────────────────

describe('insights.js', () => {
  it('calculateStreak counts consecutive days with workouts', () => {
    const tonalData = loadTonalWorkouts();
    const whoopData = loadWhoopActivity();
    const streak = calculateStreak(tonalData.workouts, whoopData.workouts);
    expect(typeof streak).toBe('number');
    expect(streak).toBeGreaterThanOrEqual(0);
  });

  it('calculateStreak returns 0 for empty data', () => {
    const streak = calculateStreak([], []);
    expect(streak).toBe(0);
  });

  it('getTrainingRecommendation handles null recovery', () => {
    const rec = getTrainingRecommendation(null, 10);
    expect(rec).toContain('not yet scored');
  });

  it('getTrainingRecommendation green recovery', () => {
    const rec = getTrainingRecommendation(80, 8);
    expect(rec).toContain('green');
  });

  it('getTrainingRecommendation high recent strain warning', () => {
    const rec = getTrainingRecommendation(80, 15);
    expect(rec).toContain('deload');
  });

  it('strengthTrend detects upward movement', () => {
    const history = [
      { overall: 531, upper: 519, lower: 534, core: 540, activityTime: new Date(Date.now() - 30 * 86400000).toISOString() },
      { overall: 600, upper: 600, lower: 500, core: 600, activityTime: new Date(Date.now() - 20 * 86400000).toISOString() },
      { overall: 650, upper: 700, lower: 510, core: 720, activityTime: new Date(Date.now() - 10 * 86400000).toISOString() },
      { overall: 699, upper: 794, lower: 511, core: 791, activityTime: new Date().toISOString() },
    ];
    expect(strengthTrend(history, 'overall')).toBe('up');
  });

  it('strengthTrend returns insufficient data for < 2 entries', () => {
    expect(strengthTrend([], 'overall')).toBe('insufficient data');
    expect(strengthTrend([{ overall: 699, activityTime: new Date().toISOString() }], 'overall')).toBe('insufficient data');
  });

  it('getPeakVolumeWeek finds maximum', () => {
    const buckets = [
      { weekStart: '2026-04-13', totalVolume: 10000, workoutCount: 2 },
      { weekStart: '2026-04-20', totalVolume: 25000, workoutCount: 3 },
      { weekStart: '2026-04-27', totalVolume: 8000, workoutCount: 1 },
    ];
    const peak = getPeakVolumeWeek(buckets);
    expect(peak.weekStart).toBe('2026-04-20');
    expect(peak.totalVolume).toBe(25000);
  });

  it('weekOverWeekChange returns null when no prior data', () => {
    const change = weekOverWeekChange([{ totalVolume: 5000 }], [], 'totalVolume');
    expect(change).toBeNull();
  });

  it('weekOverWeekChange calculates correct percentage', () => {
    const current = [{ totalVolume: 6000 }];
    const prior = [{ totalVolume: 5000 }];
    const change = weekOverWeekChange(current, prior, 'totalVolume');
    expect(change).toBeCloseTo(0.2, 5); // +20%
  });
});

// ── Tests: format.js ─────────────────────────────────────────────────────────

describe('format.js', () => {
  it('escapeMdV2 escapes all special characters', () => {
    const input = 'fitdash: 1 workout (8,000 lbs). recovery 72%.';
    const result = escapeMdV2(input);
    // Verify key special chars are escaped with backslash
    expect(result).toContain('\\.');
    expect(result).toContain('\\(');
    expect(result).toContain('\\)');
    // Unescaped dot should not appear
    expect(result).not.toMatch(/[^\\]\.[^\\]/);
    // Parentheses should all be escaped
    const unescapedParens = result.match(/(?<!\\)[()]/g);
    expect(unescapedParens).toBeNull();
  });

  it('escapeMdV2 handles null/undefined gracefully', () => {
    expect(escapeMdV2(null)).toBe('');
    expect(escapeMdV2(undefined)).toBe('');
    expect(escapeMdV2(123)).toBe('123');
  });

  it('sparkline generates correct length', () => {
    const values = [1, 2, 3, 4, 5];
    const spark = sparkline(values);
    expect(spark.length).toBe(5); // each char is one sparkline block
  });

  it('sparkline handles flat values', () => {
    const spark = sparkline([5, 5, 5, 5]);
    expect(spark).toBe('▄▄▄▄');
  });

  it('sparkline handles empty input', () => {
    expect(sparkline([])).toBe('');
    expect(sparkline(null)).toBe('');
  });

  it('commaNum formats numbers correctly', () => {
    expect(commaNum(8000)).toBe('8,000');
    expect(commaNum(1000000)).toBe('1,000,000');
    expect(commaNum(null)).toBe('N/A');
  });

  it('pct formats percentages', () => {
    expect(pct(72.3)).toBe('72%');
    expect(pct(null)).toBe('N/A');
  });

  it('formatChange formats positive and negative changes', () => {
    expect(formatChange(0.15)).toBe('+15%');
    expect(formatChange(-0.20)).toBe('-20%');
    expect(formatChange(0)).toBe('+0%');
  });

  it('capitalize works correctly', () => {
    expect(capitalize('weightlifting')).toBe('Weightlifting');
    expect(capitalize('')).toBe('');
    expect(capitalize(null)).toBe('');
  });

  it('formatAge produces human-readable strings', () => {
    expect(formatAge(30 * 60 * 1000)).toBe('30m ago');
    expect(formatAge(2 * 3600 * 1000)).toBe('2h 0m ago');
    expect(formatAge(3 * 86400 * 1000)).toBe('3d ago');
  });
});
