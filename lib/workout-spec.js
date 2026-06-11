/**
 * workout-spec.js — Build a Tonal create-payload from a friendly spec.
 *
 * Friendly spec (what the user writes) → flat Tonal sets[] (what the API wants).
 *
 * Friendly spec format:
 * {
 *   "title": "Abs + Obliques + Traps",
 *   "rounds": 4,                      // circuit passes (default 1)
 *   "exercises": [
 *     { "name": "V-Up",          "reps": 12 },          // rep-based
 *     { "name": "Suitcase March","duration": 40 },      // timed (seconds)
 *     { "name": "Shoulder Shrug","reps": 12, "weightPercentage": 100 }
 *   ]
 * }
 *
 * The circuit model is FLAT: a 3-exercise × 4-round circuit = 12 set entries,
 * setGroup 1/2/3 × round 1..4. `blockStart:true` only on the very first set.
 *
 * CRITICAL (HTTP 400 guard): each movement has a `countReps` flag.
 *   countReps:true  → MUST use reps (prescribedReps)
 *   countReps:false → MUST use duration (prescribedDuration, seconds); reps rejected
 * We auto-correct + warn rather than silently 400.
 */

function findMovement(byNameLower, name) {
  const m = byNameLower[name.toLowerCase()];
  if (!m) {
    throw new Error(`Exercise not found in Tonal library: "${name}". ` + `Run \`fitdash workout movements --search ${name.split(' ')[0]}\` to find the right name.`);
  }
  return m;
}

/**
 * @param {Object} spec - friendly spec (above)
 * @param {Object} byNameLower - name(lowercase)→movement, from indexMovements()
 * @returns {{ payload: Object, warnings: string[] }}
 */
export function buildPayload(spec, byNameLower) {
  if (!spec || !spec.title) throw new Error('Spec needs a "title".');
  const exercises = spec.exercises || [];
  if (!exercises.length) throw new Error('Spec needs at least one exercise.');

  const rounds = Math.max(1, parseInt(spec.rounds, 10) || 1);
  const warnings = [];
  const resolved = exercises.map((ex, i) => {
    if (!ex.name) throw new Error(`exercises[${i}] is missing "name".`);
    const mv = findMovement(byNameLower, ex.name);
    const countReps = mv.countReps;

    let reps = ex.reps != null ? parseInt(ex.reps, 10) : null;
    let duration = ex.duration != null ? parseInt(ex.duration, 10) : null;

    // Auto-correct measure to the movement's requirement.
    if (countReps === true) {
      if (reps == null) {
        if (duration != null) {
          reps = Math.max(1, Math.round(duration / 3)); // ~3s/rep estimate
          warnings.push(`"${mv.name}" is rep-based; converted ${duration}s → ${reps} reps.`);
        } else {
          reps = 10;
          warnings.push(`"${mv.name}" had no reps; defaulted to 10.`);
        }
      }
      duration = null;
    } else if (countReps === false) {
      if (duration == null) {
        if (reps != null) {
          duration = Math.max(10, reps * 3); // ~3s/rep
          warnings.push(`"${mv.name}" is timed (Tonal can't count its reps); converted ${reps} reps → ${duration}s.`);
        } else {
          duration = 40;
          warnings.push(`"${mv.name}" had no duration; defaulted to 40s.`);
        }
      }
      reps = null;
    }
    // countReps unknown (null) → trust whatever the user gave.

    if (mv.onMachine === false) {
      warnings.push(`"${mv.name}" is off-machine — Tonal won't track its weight (no cable tension).`);
    }

    return {
      mv,
      reps,
      duration,
      weightPercentage: ex.weightPercentage != null ? ex.weightPercentage : 100,
    };
  });

  // Flatten into round × setGroup grid.
  const sets = [];
  let first = true;
  for (let round = 1; round <= rounds; round++) {
    resolved.forEach((r, idx) => {
      const setGroup = idx + 1;
      const set = {
        blockStart: first,
        movementId: r.mv.id,
        dropSet: false,
        repetition: round,
        repetitionTotal: rounds,
        blockNumber: 1,
        burnout: false,
        spotter: true,
        eccentric: false,
        chains: false,
        flex: false,
        warmUp: false,
        weightPercentage: r.weightPercentage,
        setGroup,
        round,
        description: '',
      };
      if (r.reps != null) set.prescribedReps = r.reps;
      if (r.duration != null) set.prescribedDuration = r.duration;
      sets.push(set);
      first = false;
    });
  }

  return { payload: { title: spec.title, sets }, warnings };
}

// ─── Region → exercise suggestions (for `workout create --from-suggest`) ──────
// Maps a `suggest` focus region to a default circuit. All names below are
// verified against the live /v6/movements library (June 2026) and are rep-based,
// on-machine moves. The builder still validates + auto-corrects measure at runtime;
// specFromSuggestion silently skips any name not present in the user's library.
const REGION_TEMPLATES = {
  'Chest & Shoulders': ['Bench Press', 'Half Kneeling Overhead Press', 'Bench Chest Fly'],
  'Back & Biceps': ['Bent Over Row', 'Neutral Lat Pulldown', 'Biceps Curl'],
  'Legs / Lower Body': ['Goblet Squat', 'RDL', 'Resisted Calf Raise'],
  'Core & Mobility': ['V-Up', 'Standing Lift', 'Suitcase March'],
};

/**
 * Build a friendly spec from a `suggest` focus string. Picks template exercises
 * that actually exist in the user's movement library (skips missing names).
 * @returns {Object|null} friendly spec, or null if no template/matches.
 */
export function specFromSuggestion(focus, byNameLower, { rounds = 3 } = {}) {
  const template = REGION_TEMPLATES[focus];
  if (!template) return null;
  const exercises = template
    .filter((name) => byNameLower[name.toLowerCase()])
    .map((name) => ({ name }));
  if (!exercises.length) return null;
  return { title: `${focus} (auto)`, rounds, exercises };
}
