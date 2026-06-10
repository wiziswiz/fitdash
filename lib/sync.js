/**
 * sync.js — Writes fetched Tonal data to the local JSON files that the offline
 * read/analyze commands consume. This makes fitdash self-contained: it now owns
 * its own fetch pipeline instead of depending on an external sync script.
 *
 * Output files & schema match lib/config.js + lib/tonal.js expectations exactly.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CONFIG } from './config.js';
import { connect, fetchAll } from './tonal-api.js';

function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj));
}

/**
 * Run a full sync: login, fetch everything, write all local JSON files.
 * @returns {Promise<Object>} summary of what was written.
 */
export async function runSync(creds = null) {
  const { token, userId, userInfo } = await connect(creds);
  const data = await fetchAll(token, userId);
  const now = new Date().toISOString();

  // ── tonal_workouts_latest.json (schema v3.0, read by loadTonalWorkouts) ──
  writeJson(CONFIG.tonal.workouts, {
    version: '3.0',
    exportedAt: now,
    user: userInfo,
    workouts: data.workouts,
    strengthScoreHistory: data.strengthHistory,
  });

  // ── tonal_summary.json (read by loadTonalSummary) ──
  const latest = data.workouts[0] || {};
  const sh = data.strengthHistory[0] || {};
  writeJson(CONFIG.tonal.summary, {
    syncedAt: now,
    totalWorkouts: data.workouts.length,
    latestWorkout: {
      date: (latest.beginTime || '').slice(0, 10),
      title: latest.workoutTitle || 'untitled',
      volume: latest.totalVolume || 0,
      reps: latest.totalReps || 0,
      duration: latest.duration || 0,
    },
    strengthScore: {
      overall: sh.overall ?? null,
      upper: sh.upper ?? null,
      lower: sh.lower ?? null,
      core: sh.core ?? null,
    },
  });

  // ── movement catalog cache (read by loadMovementsCache) ──
  // Slim each entry to the fields the analyzer uses + countReps/onMachine for builds.
  if (Array.isArray(data.movements) && data.movements.length) {
    const slim = data.movements.map((m) => ({
      id: m.id,
      name: m.name,
      muscleGroups: m.muscleGroups || [],
      bodyRegion: m.bodyRegion || '',
      onMachine: m.onMachine ?? null,
      countReps: m.countReps ?? null,
    }));
    writeJson(CONFIG.tonal.movements || CONFIG.tonal.workouts.replace(/[^/]+$/, 'tonal_movements_cache.json'), slim);
  }

  // ── optional datasets (graceful if API returned null) ──
  if (data.readiness) {
    writeJson(CONFIG.tonal.muscleReadiness, { fetchedAt: now, readiness: data.readiness });
  }
  if (data.strengthCurrent) {
    writeJson(CONFIG.tonal.strengthCurrent, { fetchedAt: now, scores: data.strengthCurrent });
  }
  if (data.distribution) {
    writeJson(CONFIG.tonal.strengthDistribution, { fetchedAt: now, distribution: data.distribution });
  }
  if (data.external) {
    writeJson(CONFIG.tonal.externalActivities, { fetchedAt: now, activities: data.external });
  }

  return {
    workouts: data.workouts.length,
    movements: Array.isArray(data.movements) ? data.movements.length : 0,
    strengthPoints: data.strengthHistory.length,
    readiness: !!data.readiness,
    distribution: !!data.distribution,
    latest: {
      title: latest.workoutTitle || 'untitled',
      date: (latest.beginTime || '').slice(0, 10),
      volume: latest.totalVolume || 0,
    },
  };
}
