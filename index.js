#!/usr/bin/env node
/**
 * fitdash — Fitness Intelligence Dashboard CLI
 * Tonal + WHOOP data, no network calls.
 */

import { Command } from 'commander';
import chalk from 'chalk';

import {
  loadTonalWorkouts,
  loadTonalSummary,
  checkTonalStaleness,
  getTodayTonalWorkouts,
  getTonalWorkoutsForDays,
  getStrengthScoreHistory,
  getTonalWeeklyBuckets,
  getCurrentStrengthScores,
  getWorkoutTitle,
  formatDuration,
  sumVolume,
  sumReps,
  loadMovementsCache,
  suggestTodayFocus,
  loadMuscleReadiness,
  loadStrengthDistribution,
  loadStrengthCurrent,
  loadExternalActivities,
  suggestFromReadiness,
} from './lib/tonal.js';

import {
  loadWhoopActivity,
  loadWhoopSummary,
  checkWhoopStaleness,
  getTodayWhoopWorkouts,
  getWhoopWorkoutsForDays,
  getRecoveryInfo,
  formatWhoopWorkout,
  sumStrain,
  sumCalories,
  getRecoveryRecommendation,
  getWhoopWeeklyBuckets,
} from './lib/whoop.js';

import {
  calculateStreak,
  getTrainingRecommendation,
  weekOverWeekChange,
  getPeakVolumeWeek,
  strengthTrend,
} from './lib/insights.js';

import {
  escapeMdV2,
  sparkline,
  commaNum,
  pct,
  formatChange,
  shortDate,
  formatAge,
  capitalize,
} from './lib/format.js';

// Network layer (only loaded/used by online commands: sync, workout)
import { runSync } from './lib/sync.js';
import { connect, getMovements, indexMovements, listWorkouts, createWorkout, deleteWorkout } from './lib/tonal-api.js';
import { buildPayload, specFromSuggestion } from './lib/workout-spec.js';
import { readFileSync } from 'fs';

const program = new Command();

program
  .name('fitdash')
  .description('Fitness Intelligence Dashboard — Tonal + WHOOP')
  .version('1.0.0');

// ─── Staleness warning helper ────────────────────────────────────────────────

function warnStale(label, result) {
  if (result.stale && isFinite(result.ageMs)) {
    console.warn(chalk.yellow(`⚠  ${label} data is ${formatAge(result.ageMs)} — may be outdated`));
  }
}

// ─── fitdash today ───────────────────────────────────────────────────────────

program
  .command('today')
  .description("Today's Tonal workout + WHOOP strain/recovery")
  .action(() => {
    const tonalData = loadTonalWorkouts();
    const whoopData = loadWhoopActivity();
    const whoopSummary = loadWhoopSummary();

    if (!tonalData && !whoopData) {
      console.log(chalk.yellow('No fitness data found. Run the nightly sync first.'));
      process.exit(0);
    }

    warnStale('Tonal', checkTonalStaleness());
    warnStale('WHOOP', checkWhoopStaleness());

    console.log(chalk.bold.cyan('\n🏋️  Today\'s Fitness\n'));

    // ── Tonal ──
    if (tonalData) {
      const todayWorkouts = getTodayTonalWorkouts(tonalData);
      if (todayWorkouts.length > 0) {
        console.log(chalk.bold('Tonal:'));
        for (const w of todayWorkouts) {
          const title = getWorkoutTitle(w);
          const vol = commaNum(w.totalVolume);
          const dur = formatDuration(w.totalDuration);
          console.log(`  ${chalk.green('●')} ${title} — ${vol} lbs, ${w.totalReps} reps, ${w.totalMovements} movements, ${dur}`);
        }
      } else {
        // Show last workout instead
        const summary = loadTonalSummary();
        if (summary && summary.latestWorkout) {
          const lw = summary.latestWorkout;
          console.log(chalk.bold('Tonal:') + chalk.dim(' (no workout today)'));
          console.log(`  Last: ${shortDate(lw.date)} — ${commaNum(lw.volume)} lbs, ${lw.reps} reps`);
        } else {
          console.log(chalk.dim('Tonal: no workout today'));
        }
      }
    } else {
      console.log(chalk.dim('Tonal: data unavailable'));
    }

    // ── WHOOP ──
    if (whoopData) {
      const todayWhoop = getTodayWhoopWorkouts(whoopData);
      if (todayWhoop.length > 0) {
        console.log(chalk.bold('\nWHOOP Activity:'));
        for (const w of todayWhoop) {
          const fmt = formatWhoopWorkout(w);
          const strain = fmt.strain != null ? `strain ${fmt.strain}` : '';
          const hr = fmt.avgHr ? `avg HR ${fmt.avgHr} bpm` : '';
          const cal = fmt.calories ? `${commaNum(fmt.calories)} cal` : '';
          const dist = fmt.distanceMiles ? `${fmt.distanceMiles} mi` : '';
          const parts = [strain, hr, cal, dist].filter(Boolean).join(' · ');
          console.log(`  ${chalk.blue('●')} ${capitalize(fmt.sport)} — ${fmt.durationMin}m · ${parts}`);
        }
      } else {
        console.log(chalk.dim('\nWHOOP: no activity today'));
      }
    } else {
      console.log(chalk.dim('\nWHOOP: data unavailable'));
    }

    // ── Recovery ──
    if (whoopSummary) {
      const recovery = getRecoveryInfo(whoopSummary);
      console.log(chalk.bold('\nRecovery:'));
      if (recovery.score !== null) {
        const badge = recovery.score >= 67 ? chalk.green('●') : recovery.score >= 34 ? chalk.yellow('●') : chalk.red('●');
        console.log(`  ${badge} Score: ${pct(recovery.score)}${recovery.hrv ? `  HRV: ${Math.round(recovery.hrv)}ms` : ''}${recovery.rhr ? `  RHR: ${recovery.rhr} bpm` : ''}`);
      } else {
        console.log(`  ${chalk.dim('●')} Not yet scored for today`);
      }
      const rec = getTrainingRecommendation(recovery.score, 0);
      console.log(`  → ${rec}`);
    }

    // ── Strength snapshot ──
    if (tonalData) {
      const scores = getCurrentStrengthScores(tonalData);
      if (scores) {
        console.log(chalk.bold('\nStrength Scores:'));
        console.log(`  Overall ${chalk.cyan(scores.overall)}  Upper ${scores.upper}  Lower ${scores.lower}  Core ${scores.core}`);
      }
    }

    console.log('');
  });

// ─── fitdash week ────────────────────────────────────────────────────────────

program
  .command('week')
  .description('Weekly fitness summary')
  .option('--days <n>', 'Days to look back', '7')
  .action((opts) => {
    const days = parseInt(opts.days, 10) || 7;
    const tonalData = loadTonalWorkouts();
    const whoopData = loadWhoopActivity();
    const whoopSummary = loadWhoopSummary();

    warnStale('Tonal', checkTonalStaleness());
    warnStale('WHOOP', checkWhoopStaleness());

    console.log(chalk.bold.cyan(`\n📅 Last ${days} Days Summary\n`));

    let tonalWorkouts = [];
    if (tonalData) {
      tonalWorkouts = getTonalWorkoutsForDays(tonalData, days);
      const vol = sumVolume(tonalWorkouts);
      const reps = sumReps(tonalWorkouts);
      console.log(chalk.bold('Tonal:'));
      console.log(`  Workouts: ${tonalWorkouts.length}`);
      console.log(`  Total volume: ${commaNum(vol)} lbs`);
      console.log(`  Total reps: ${commaNum(reps)}`);
    } else {
      console.log(chalk.dim('Tonal: data unavailable'));
    }

    let whoopWorkouts = [];
    if (whoopData) {
      whoopWorkouts = getWhoopWorkoutsForDays(whoopData, days);
      const totalStrain = sumStrain(whoopWorkouts);
      const totalCal = sumCalories(whoopWorkouts);
      const avgStrain = whoopWorkouts.length > 0 ? totalStrain / whoopWorkouts.length : 0;
      console.log(chalk.bold('\nWHOOP:'));
      console.log(`  Sessions: ${whoopWorkouts.length}`);
      console.log(`  Avg strain/session: ${avgStrain.toFixed(1)}`);
      console.log(`  Total calories: ${commaNum(totalCal)}`);
    } else {
      console.log(chalk.dim('\nWHOOP: data unavailable'));
    }

    // Week-over-week comparison (if days=7)
    if (days <= 7 && tonalData) {
      const curBuckets = getTonalWeeklyBuckets(tonalData, 7);
      const prevBuckets = getTonalWeeklyBuckets(tonalData, 14);
      const prevOnlyBuckets = prevBuckets.slice(0, prevBuckets.length - curBuckets.length);
      if (prevOnlyBuckets.length > 0) {
        const volChange = weekOverWeekChange(curBuckets, prevOnlyBuckets, 'totalVolume');
        if (volChange !== null) {
          const arrow = volChange >= 0 ? chalk.green('↑') : chalk.red('↓');
          console.log(`\n  vs prior week: volume ${arrow} ${formatChange(volChange)}`);
        }
      }
    }

    // Streak
    const streak = calculateStreak(tonalData?.workouts || [], whoopData?.workouts || []);
    console.log(chalk.bold('\nStreak:') + ` ${streak > 0 ? chalk.green(streak + ' consecutive days') : chalk.dim('0 days')}`);

    console.log('');
  });

// ─── fitdash strength ────────────────────────────────────────────────────────

program
  .command('strength')
  .description('Tonal strength score progression')
  .option('--history <n>', 'Days of history', '30')
  .action((opts) => {
    const historyDays = parseInt(opts.history, 10) || 30;
    const tonalData = loadTonalWorkouts();

    if (!tonalData) {
      console.log(chalk.yellow('No Tonal data available.'));
      process.exit(0);
    }

    warnStale('Tonal', checkTonalStaleness());

    const current = getCurrentStrengthScores(tonalData);
    const history = getStrengthScoreHistory(tonalData, historyDays);

    console.log(chalk.bold.cyan('\n💪 Strength Score Progression\n'));

    if (current) {
      console.log(chalk.bold('Current Scores:'));
      console.log(`  Overall: ${chalk.cyan.bold(current.overall)}`);
      console.log(`  Upper:   ${current.upper}`);
      console.log(`  Lower:   ${current.lower}`);
      console.log(`  Core:    ${current.core}`);
      console.log(`  As of:   ${shortDate(current.activityTime)}`);
    }

    if (history.length >= 2) {
      console.log(chalk.bold(`\nTrend (last ${historyDays} days, ${history.length} data points):`));
      const categories = ['overall', 'upper', 'lower', 'core'];
      for (const cat of categories) {
        const trend = strengthTrend(history, cat);
        const sorted = [...history].sort((a, b) => new Date(a.activityTime) - new Date(b.activityTime));
        const values = sorted.map(s => s[cat]).filter(v => v != null);
        const spark = sparkline(values);
        const arrow = trend === 'up' ? chalk.green('↑') : trend === 'down' ? chalk.red('↓') : chalk.dim('→');
        const first = values[0];
        const last = values[values.length - 1];
        const delta = last - first;
        const deltaStr = delta >= 0 ? chalk.green(`+${delta}`) : chalk.red(`${delta}`);
        console.log(`  ${capitalize(cat).padEnd(8)} ${arrow} ${spark}  ${first} → ${last} (${deltaStr})`);
      }
    } else if (history.length === 1) {
      console.log(chalk.dim('\nOnly 1 data point in range — need more history for trend.'));
    } else {
      console.log(chalk.dim('\nNo strength history in range.'));
    }

    // All-time context
    if (tonalData.strengthScoreHistory && tonalData.strengthScoreHistory.length > 0) {
      const allSorted = [...tonalData.strengthScoreHistory].sort((a, b) => new Date(a.activityTime) - new Date(b.activityTime));
      const oldest = allSorted[0];
      const allTime = getPeakVolumeWeek(getTonalWeeklyBuckets(tonalData, 365));
      console.log(chalk.bold('\nAll-time:'));
      console.log(`  First score: ${oldest.overall} (${shortDate(oldest.activityTime)})`);
      console.log(`  Total data points: ${tonalData.strengthScoreHistory.length}`);
      if (allTime) {
        console.log(`  Peak volume week: ${shortDate(allTime.weekStart)} — ${commaNum(allTime.totalVolume)} lbs`);
      }
    }

    console.log('');
  });

// ─── fitdash trend ───────────────────────────────────────────────────────────

program
  .command('trend')
  .description('Trend analysis for a metric')
  .option('--metric <m>', 'volume | reps | strain | recovery', 'volume')
  .option('--days <n>', 'Days to analyze', '30')
  .action((opts) => {
    const days = parseInt(opts.days, 10) || 30;
    const metric = opts.metric.toLowerCase();

    const validMetrics = ['volume', 'reps', 'strain', 'recovery'];
    if (!validMetrics.includes(metric)) {
      console.error(chalk.red(`Invalid metric: ${metric}. Use: ${validMetrics.join(', ')}`));
      process.exit(1);
    }

    console.log(chalk.bold.cyan(`\n📈 ${capitalize(metric)} Trend — Last ${days} Days\n`));

    if (metric === 'volume' || metric === 'reps') {
      const tonalData = loadTonalWorkouts();
      if (!tonalData) {
        console.log(chalk.yellow('No Tonal data available.'));
        process.exit(0);
      }
      warnStale('Tonal', checkTonalStaleness());
      const buckets = getTonalWeeklyBuckets(tonalData, days);
      if (buckets.length === 0) {
        console.log(chalk.dim('No data in range.'));
        process.exit(0);
      }
      const key = metric === 'volume' ? 'totalVolume' : 'totalReps';
      const values = buckets.map(b => b[key]);
      console.log('Weekly buckets:');
      const maxBarVal = Math.max(...values);
      buckets.forEach((b, i) => {
        const bar = maxBarVal > 0 ? '█'.repeat(Math.min(Math.round(values[i] / maxBarVal * 20), 20)) : '';
        const label = metric === 'volume' ? commaNum(values[i]) + ' lbs' : commaNum(values[i]) + ' reps';
        console.log(`  ${shortDate(b.weekStart).padEnd(8)} ${chalk.cyan(bar)} ${label}`);
      });
      console.log(`\nSparkline: ${sparkline(values)}`);

      if (values.length >= 2) {
        const change = (values[values.length - 1] - values[0]) / values[0];
        console.log(`Overall change: ${formatChange(change)} over period`);
      }
    } else if (metric === 'strain') {
      const whoopData = loadWhoopActivity();
      if (!whoopData) {
        console.log(chalk.yellow('No WHOOP data available.'));
        process.exit(0);
      }
      warnStale('WHOOP', checkWhoopStaleness());
      const buckets = getWhoopWeeklyBuckets(whoopData, days);
      if (buckets.length === 0) {
        console.log(chalk.dim('No WHOOP data in range.'));
        process.exit(0);
      }
      const values = buckets.map(b => b.totalStrain);
      console.log('Weekly strain totals:');
      buckets.forEach((b, i) => {
        const maxVal = Math.max(...values);
        const bar = '█'.repeat(maxVal > 0 ? Math.min(Math.round(values[i] / maxVal * 20), 20) : 0);
        console.log(`  ${shortDate(b.weekStart).padEnd(8)} ${chalk.blue(bar)} ${values[i].toFixed(1)}`);
      });
      console.log(`\nSparkline: ${sparkline(values)}`);
    } else if (metric === 'recovery') {
      console.log(chalk.dim('Recovery trend requires historical daily recovery data.'));
      console.log(chalk.dim('Current WHOOP sync captures summary only (not historical scores).'));
      const whoopSummary = loadWhoopSummary();
      if (whoopSummary) {
        const rec = getRecoveryInfo(whoopSummary);
        console.log(`\nToday's recovery: ${rec.score !== null ? pct(rec.score) : 'not scored'}`);
        if (rec.hrv) console.log(`HRV: ${Math.round(rec.hrv)}ms`);
        if (rec.rhr) console.log(`RHR: ${rec.rhr} bpm`);
      }
    }

    console.log('');
  });

// ─── fitdash digest ──────────────────────────────────────────────────────────

// ─── fitdash suggest ────────────────────────────────────────────────────────

program
  .command('suggest')
  .description("Suggest today's workout focus using muscle readiness + WHOOP recovery")
  .option('--telegram', 'Output Telegram MarkdownV2-safe')
  .option('--heuristic', 'Force heuristic mode (ignore muscle readiness data)')
  .action((opts) => {
    const whoopSummary = loadWhoopSummary();
    const recovery = whoopSummary ? getRecoveryInfo(whoopSummary) : { score: null };

    // Try real muscle readiness first (from Tonal API)
    const readiness = opts.heuristic ? null : loadMuscleReadiness();
    const readinessSuggestion = suggestFromReadiness(readiness, recovery.score);

    if (readinessSuggestion) {
      // ─── Real muscle readiness mode ───
      const { suggestion, muscles, avoid, rationale } = readinessSuggestion;

      if (opts.telegram) {
        console.log(`💪 *Today's Focus:* ` + escapeMdV2(suggestion));
        if (muscles && muscles.length > 0) {
          console.log(`  Ready: ` + escapeMdV2(muscles.slice(0, 4).join(', ')));
        }
        if (avoid && avoid.length > 0) {
          console.log(`  ⚠️ Avoid: ` + escapeMdV2(avoid.slice(0, 3).join(', ')));
        }
        console.log('  ' + escapeMdV2(rationale));
      } else {
        console.log(chalk.bold.cyan('\n💪 Workout Suggestion (Muscle Readiness)\n'));
        console.log(chalk.bold(`  Today's Focus: `) + chalk.green(suggestion));
        if (muscles && muscles.length > 0) {
          console.log(chalk.dim('  Ready: ') + muscles.slice(0, 4).join(', '));
        }
        if (avoid && avoid.length > 0) {
          console.log(chalk.dim('  ⚠️  Avoid: ') + chalk.red(avoid.slice(0, 3).join(', ')));
        }
        console.log(chalk.dim('  ' + rationale));
        console.log();
      }
    } else {
      // ─── Heuristic fallback (no readiness data) ───
      const tonalData = loadTonalWorkouts();
      const movementsMap = loadMovementsCache();
      const { suggestion, yesterday, rationale } = suggestTodayFocus(
        tonalData, movementsMap, recovery.score
      );
      const yLine = yesterday.length > 0
        ? 'Yesterday: ' + yesterday.slice(0, 3).join(', ')
        : 'No recent workout data';

      if (opts.telegram) {
        console.log(`💪 *Today's Focus:* ` + escapeMdV2(suggestion));
        console.log('  ' + escapeMdV2(yLine) + ' → ' + escapeMdV2(rationale));
      } else {
        console.log(chalk.bold.cyan('\n💪 Workout Suggestion (heuristic)\n'));
        console.log(chalk.bold(`  Today's Focus: `) + chalk.green(suggestion));
        console.log(chalk.dim('  ' + yLine + ' → ' + rationale));
        console.log();
      }
    }
  });

// ─── fitdash readiness ───────────────────────────────────────────────────────────────

program
  .command('readiness')
  .description('Show per-muscle readiness heatmap from Tonal')
  .option('--telegram', 'Output Telegram MarkdownV2-safe')
  .action((opts) => {
    const readiness = loadMuscleReadiness();
    const distribution = loadStrengthDistribution();
    const whoopSummary = loadWhoopSummary();
    const recovery = whoopSummary ? getRecoveryInfo(whoopSummary) : { score: null };

    if (!readiness) {
      console.error('No muscle readiness data. Run tonal-sync.sh first.');
      process.exit(1);
    }

    // Sort by readiness score
    const sorted = Object.entries(readiness)
      .map(([muscle, score]) => ({ muscle, score }))
      .sort((a, b) => b.score - a.score);

    const bar = (score) => {
      const filled = Math.round(score / 10);
      return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };

    const indicator = (score) => {
      if (score >= 80) return '🟢';
      if (score >= 50) return '🟡';
      return '🔴';
    };

    if (opts.telegram) {
      console.log('*🎯 Muscle Readiness*');
      if (recovery.score !== null) {
        console.log(`WHOOP Recovery: ${recovery.score}%`);
      }
      console.log('');
      for (const { muscle, score } of sorted) {
        console.log(`${indicator(score)} ${escapeMdV2(muscle)}: ${score}%`);
      }
      if (distribution) {
        console.log('');
        console.log(`Strength: ${distribution.overallScore} \\(${escapeMdV2(distribution.percentile + 'th percentile')}\\)`);
      }
    } else {
      console.log(chalk.bold.cyan('\n🎯 Muscle Readiness\n'));
      if (recovery.score !== null) {
        console.log(chalk.dim(`  WHOOP Recovery: ${recovery.score}%\n`));
      }
      for (const { muscle, score } of sorted) {
        const pad = muscle.padEnd(11);
        const color = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
        console.log(`  ${indicator(score)} ${pad} ${bar(score)} ${color(score + '%')}`);
      }
      if (distribution) {
        console.log(chalk.dim(`\n  Strength: ${distribution.overallScore} (${distribution.percentile}th percentile among Tonal users)`));
      }
      console.log();
    }
  });

program
  .command('digest')
  .description('One-liner for morning digest')
  .option('--telegram', 'Output Telegram MarkdownV2-safe')
  .action((opts) => {
    const tonalData = loadTonalWorkouts();
    const whoopData = loadWhoopActivity();
    const whoopSummary = loadWhoopSummary();
    const tonalSummary = loadTonalSummary();

    // Count today's workouts
    const todayTonal = tonalData ? getTodayTonalWorkouts(tonalData) : [];
    const todayWhoop = whoopData ? getTodayWhoopWorkouts(whoopData) : [];
    const totalWorkouts = todayTonal.length + todayWhoop.length;

    // Volume
    const todayVol = sumVolume(todayTonal);

    // Recovery
    const recovery = whoopSummary ? getRecoveryInfo(whoopSummary) : { score: null };
    const recStr = recovery.score !== null ? `recovery ${pct(recovery.score)}` : 'recovery unscored';

    // Streak
    const streak = calculateStreak(tonalData?.workouts || [], whoopData?.workouts || []);
    const streakStr = streak > 0 ? `streak ${streak}d` : 'no streak';

    // Strength
    const scores = tonalData ? getCurrentStrengthScores(tonalData) : null;
    const strengthStr = scores ? `strength ${scores.overall}` : '';

    // Workout suggestion (muscle group awareness)
    const movementsMap = loadMovementsCache();
    const { suggestion, yesterday } = suggestTodayFocus(tonalData, movementsMap, recovery.score);
    const yLine = yesterday.length > 0 ? `yesterday: ${yesterday.slice(0, 2).join(' + ')}` : '';
    const suggestStr = `today: ${suggestion}${yLine ? ` (${yLine})` : ''}`;

    let parts = [];
    if (totalWorkouts > 0) {
      parts.push(`${totalWorkouts} workout${totalWorkouts > 1 ? 's' : ''} today`);
      if (todayVol > 0) parts.push(`${commaNum(todayVol)} lbs`);
    } else if (tonalSummary?.latestWorkout) {
      const lw = tonalSummary.latestWorkout;
      parts.push(`last workout ${shortDate(lw.date)}`);
      if (lw.volume > 0) parts.push(`${commaNum(lw.volume)} lbs`);
    } else {
      parts.push('no workout today');
    }

    parts.push(recStr);
    if (strengthStr) parts.push(strengthStr);
    parts.push(streakStr);
    parts.push(suggestStr);

    const line = `fitdash: ${parts.join(', ')}`;

    if (opts.telegram) {
      console.log(escapeMdV2(line));
    } else {
      console.log(line);
    }
  });

// ─── fitdash list ────────────────────────────────────────────────────────────

program
  .command('list')
  .description('Recent workouts list')
  .option('--days <n>', 'Days to look back', '14')
  .option('--source <src>', 'tonal | whoop | all', 'all')
  .action((opts) => {
    const days = parseInt(opts.days, 10) || 14;
    const source = opts.source.toLowerCase();

    const validSources = ['tonal', 'whoop', 'all'];
    if (!validSources.includes(source)) {
      console.error(chalk.red(`Invalid source: ${source}. Use: ${validSources.join(', ')}`));
      process.exit(1);
    }

    console.log(chalk.bold.cyan(`\n📋 Workouts — Last ${days} Days\n`));

    const entries = [];

    if (source === 'tonal' || source === 'all') {
      const tonalData = loadTonalWorkouts();
      warnStale('Tonal', checkTonalStaleness());
      if (tonalData) {
        const workouts = getTonalWorkoutsForDays(tonalData, days);
        for (const w of workouts) {
          entries.push({
            date: new Date(w.beginTime),
            source: 'tonal',
            label: getWorkoutTitle(w),
            detail: `${commaNum(w.totalVolume)} lbs · ${w.totalReps} reps · ${w.totalMovements} mvmts`,
            extra: formatDuration(w.totalDuration),
          });
        }
      } else {
        console.log(chalk.dim('Tonal: data unavailable'));
      }
    }

    if (source === 'whoop' || source === 'all') {
      const whoopData = loadWhoopActivity();
      warnStale('WHOOP', checkWhoopStaleness());
      if (whoopData) {
        const workouts = getWhoopWorkoutsForDays(whoopData, days);
        for (const w of workouts) {
          const fmt = formatWhoopWorkout(w);
          if (!fmt) continue;
          const parts = [
            fmt.strain != null ? `strain ${fmt.strain}` : null,
            fmt.avgHr ? `avg HR ${fmt.avgHr}` : null,
            fmt.calories ? `${fmt.calories} cal` : null,
            fmt.distanceMiles ? `${fmt.distanceMiles} mi` : null,
          ].filter(Boolean);
          entries.push({
            date: new Date(w.start),
            source: 'whoop',
            label: capitalize(fmt.sport),
            detail: parts.join(' · '),
            extra: `${fmt.durationMin}m`,
          });
        }
      } else if (source === 'whoop') {
        console.log(chalk.dim('WHOOP: data unavailable'));
      }
    }

    // Sort by date descending
    entries.sort((a, b) => b.date - a.date);

    if (entries.length === 0) {
      console.log(chalk.dim(`No workouts found in last ${days} days.`));
    } else {
      for (const e of entries) {
        const sourceTag = e.source === 'tonal' ? chalk.green('[Tonal]') : chalk.blue('[WHOOP]');
        const dateStr = shortDate(e.date.toISOString());
        console.log(`  ${dateStr.padEnd(8)} ${sourceTag} ${chalk.bold(e.label.padEnd(15))} ${e.detail}  ${chalk.dim(e.extra)}`);
      }
      console.log(`\n  ${entries.length} workouts shown`);
    }

    console.log('');
  });

// ─── fitdash sync (ONLINE — requires login) ──────────────────────────────────

program
  .command('sync')
  .description('🔌 Log in to Tonal and download all data to local files (requires credentials)')
  .action(async () => {
    try {
      console.log(chalk.dim('Logging in to Tonal…'));
      const summary = await runSync();
      console.log(chalk.bold.green('\n✓ Sync complete\n'));
      console.log(`  Workouts:        ${summary.workouts}`);
      console.log(`  Movement library:${String(summary.movements).padStart(2)} exercises`);
      console.log(`  Strength points: ${summary.strengthPoints}`);
      console.log(`  Muscle readiness:${summary.readiness ? ' ✓' : ' —'}`);
      console.log(`  Distribution:    ${summary.distribution ? ' ✓' : ' —'}`);
      if (summary.latest.date) {
        console.log(chalk.dim(`\n  Latest: ${summary.latest.title} on ${summary.latest.date} — ${commaNum(summary.latest.volume)} lbs`));
      }
      console.log(chalk.dim('\n  Now run `fitdash today` / `fitdash strength` (offline) to view it.\n'));
    } catch (err) {
      console.error(chalk.red(`\nSync failed: ${err.message}\n`));
      process.exit(1);
    }
  });

// ─── fitdash workout (ONLINE — requires login) ───────────────────────────────

const workout = program
  .command('workout')
  .description('🔌 Create / list / delete custom workouts on Tonal (requires credentials)');

workout
  .command('list')
  .description('List your custom workouts')
  .action(async () => {
    try {
      const { token } = await connect();
      const ws = await listWorkouts(token);
      console.log(chalk.bold.cyan(`\n🏋️  Custom Workouts (${ws.length})\n`));
      if (!ws.length) {
        console.log(chalk.dim('  None yet. Create one with `fitdash workout create <spec.json>`.'));
      }
      for (const w of ws) {
        console.log(`  ${chalk.green('●')} ${chalk.bold((w.title || 'untitled').padEnd(28))} ${chalk.dim('id=' + w.id)}  ${chalk.dim(w.publishState || '')}`);
      }
      console.log(chalk.dim('\n  (list view shows sets:0 in summary — that is normal, not a bug)\n'));
    } catch (err) {
      console.error(chalk.red(`\nList failed: ${err.message}\n`));
      process.exit(1);
    }
  });

workout
  .command('movements')
  .description('Search the Tonal exercise library (by name)')
  .option('--search <term>', 'Filter by name substring')
  .action(async (opts) => {
    try {
      const { token } = await connect();
      let mv = await getMovements(token);
      const term = (opts.search || '').toLowerCase();
      if (term) mv = mv.filter((m) => (m.name || '').toLowerCase().includes(term));
      mv.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      console.log(chalk.bold.cyan(`\n📚 Exercise Library (${mv.length}${term ? ` matching "${opts.search}"` : ''})\n`));
      for (const m of mv.slice(0, 80)) {
        const measure = m.countReps === false ? chalk.yellow('timed') : m.countReps === true ? chalk.green('reps') : chalk.dim('?');
        const machine = m.onMachine === false ? chalk.dim('off-machine') : '';
        console.log(`  ${chalk.bold((m.name || '').padEnd(26))} ${measure.padEnd(15)} ${machine}  ${chalk.dim(m.muscleGroups?.join(', ') || '')}`);
      }
      if (mv.length > 80) console.log(chalk.dim(`\n  …${mv.length - 80} more. Narrow with --search.`));
      console.log('');
    } catch (err) {
      console.error(chalk.red(`\nMovements failed: ${err.message}\n`));
      process.exit(1);
    }
  });

workout
  .command('create [specFile]')
  .description('Create a custom workout from a spec JSON, or use --from-suggest')
  .option('--from-suggest', 'Build the workout that `fitdash suggest` recommends today')
  .option('--rounds <n>', 'Circuit rounds when using --from-suggest', '3')
  .option('--dry-run', 'Show the payload without sending it')
  .action(async (specFile, opts) => {
    try {
      const { token } = await connect();
      const movements = await getMovements(token);
      const byName = indexMovements(movements);

      let spec;
      if (opts.fromSuggest) {
        // Reuse the offline suggest logic to pick a focus, then template it.
        const whoopSummary = loadWhoopSummary();
        const recovery = whoopSummary ? getRecoveryInfo(whoopSummary) : { score: null };
        const readiness = loadMuscleReadiness();
        const rs = suggestFromReadiness(readiness, recovery.score);
        let focus;
        if (rs) {
          focus = rs.suggestion;
        } else {
          const tonalData = loadTonalWorkouts();
          const movementsMap = loadMovementsCache();
          focus = suggestTodayFocus(tonalData, movementsMap, recovery.score).suggestion;
        }
        spec = specFromSuggestion(focus, byName, { rounds: parseInt(opts.rounds, 10) || 3 });
        if (!spec) {
          console.error(chalk.red(`\nNo workout template for focus "${focus}". Build a spec file instead.\n`));
          process.exit(1);
        }
        console.log(chalk.dim(`Focus from suggest: ${chalk.bold(focus)}`));
      } else if (specFile) {
        spec = JSON.parse(readFileSync(specFile, 'utf8'));
      } else {
        console.error(chalk.red('\nProvide a <specFile> or use --from-suggest.\n'));
        process.exit(1);
      }

      const { payload, warnings } = buildPayload(spec, byName);
      for (const w of warnings) console.log(chalk.yellow(`  ⚠  ${w}`));

      console.log(chalk.bold.cyan(`\n🏗️  ${payload.title}`));
      console.log(chalk.dim(`  ${payload.sets.length} sets across ${spec.exercises.length} exercises\n`));

      if (opts.dryRun) {
        console.log(JSON.stringify(payload, null, 2));
        console.log(chalk.dim('\n  --dry-run: nothing sent.\n'));
        return;
      }

      const created = await createWorkout(token, payload);
      console.log(chalk.green(`✓ Tonal accepted it (id=${created.id || '?'})`));
      console.log(
        chalk.yellow(
          '\n  ⚠  API accepted ≠ instantly visible. Pull-to-refresh (or force-quit) the\n' +
            '     Tonal app, and it should appear. The device usually shows it right away.\n'
        )
      );
    } catch (err) {
      console.error(chalk.red(`\nCreate failed: ${err.message}\n`));
      process.exit(1);
    }
  });

workout
  .command('delete <id>')
  .description('Delete a custom workout by id')
  .action(async (id) => {
    try {
      const { token } = await connect();
      await deleteWorkout(token, id);
      console.log(chalk.green(`\n✓ Deleted workout ${id}\n`));
    } catch (err) {
      console.error(chalk.red(`\nDelete failed: ${err.message}\n`));
      process.exit(1);
    }
  });

program.parse(process.argv);
