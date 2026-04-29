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

program.parse(process.argv);
