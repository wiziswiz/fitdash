/**
 * config.js — Data file paths and constants for fitdash
 * All paths resolve from environment overrides (for tests) or defaults.
 */

import { homedir } from 'os';
import { join } from 'path';

const HOME = homedir();
const HEALTH_BASE = join(HOME, 'clawd', 'health-data');

export const CONFIG = {
  tonal: {
    workouts: process.env.FITDASH_TONAL_WORKOUTS || join(HEALTH_BASE, 'tonal', 'tonal_workouts_latest.json'),
    summary: process.env.FITDASH_TONAL_SUMMARY || join(HEALTH_BASE, 'tonal', 'tonal_summary.json'),
    muscleReadiness: process.env.FITDASH_TONAL_READINESS || join(HEALTH_BASE, 'tonal', 'tonal_muscle_readiness.json'),
    strengthCurrent: process.env.FITDASH_TONAL_STRENGTH || join(HEALTH_BASE, 'tonal', 'tonal_strength_current.json'),
    strengthDistribution: process.env.FITDASH_TONAL_DISTRIBUTION || join(HEALTH_BASE, 'tonal', 'tonal_strength_distribution.json'),
    externalActivities: process.env.FITDASH_TONAL_EXTERNAL || join(HEALTH_BASE, 'tonal', 'tonal_external_activities.json'),
  },
  whoop: {
    activity: process.env.FITDASH_WHOOP_ACTIVITY || join(HEALTH_BASE, 'whoop', 'whoop_activity_latest.json'),
    summary: process.env.FITDASH_WHOOP_SUMMARY || join(HEALTH_BASE, 'whoop', 'whoop_summary.json'),
  },
  staleThresholdMs: 24 * 60 * 60 * 1000, // 24 hours
};
