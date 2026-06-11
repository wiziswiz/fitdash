/**
 * workout-spec.test.js — Tests for the workout payload builder.
 * Pure logic, no network. Covers the rep-vs-duration auto-correction that
 * prevents Tonal HTTP 400s, circuit flattening, and suggest templating.
 */

import { describe, it, expect } from 'vitest';
import { buildPayload, specFromSuggestion } from '../lib/workout-spec.js';
import { indexMovements } from '../lib/tonal-api.js';

// Fake movement library covering both measure types + off-machine.
const MOVEMENTS = [
  { id: 'rep-1', name: 'Shoulder Shrug', muscleGroups: ['Traps'], countReps: true, onMachine: true },
  { id: 'rep-2', name: 'Standing Lift', muscleGroups: ['Obliques'], countReps: true, onMachine: true },
  { id: 'dur-1', name: 'Suitcase March', muscleGroups: ['Core'], countReps: false, onMachine: true },
  { id: 'off-1', name: 'V-Up', muscleGroups: ['Abs'], countReps: false, onMachine: false },
  { id: 'unk-1', name: 'Mystery Move', muscleGroups: [], countReps: null, onMachine: null },
];
const byName = indexMovements(MOVEMENTS);

describe('indexMovements', () => {
  it('builds a case-insensitive name map', () => {
    expect(byName['shoulder shrug'].id).toBe('rep-1');
    expect(byName['v-up'].id).toBe('off-1');
  });
});

describe('buildPayload — basics', () => {
  it('flattens a 3-exercise × 4-round circuit into 12 sets', () => {
    const spec = {
      title: 'Abs + Obliques + Traps',
      rounds: 4,
      exercises: [
        { name: 'V-Up', duration: 40 },
        { name: 'Standing Lift', reps: 15 },
        { name: 'Shoulder Shrug', reps: 12 },
      ],
    };
    const { payload } = buildPayload(spec, byName);
    expect(payload.title).toBe('Abs + Obliques + Traps');
    expect(payload.sets).toHaveLength(12);
  });

  it('sets blockStart=true only on the very first set', () => {
    const spec = { title: 'T', rounds: 2, exercises: [{ name: 'V-Up' }, { name: 'Shoulder Shrug' }] };
    const { payload } = buildPayload(spec, byName);
    expect(payload.sets[0].blockStart).toBe(true);
    expect(payload.sets.slice(1).every((s) => s.blockStart === false)).toBe(true);
  });

  it('assigns correct setGroup × round grid', () => {
    const spec = { title: 'T', rounds: 2, exercises: [{ name: 'V-Up' }, { name: 'Shoulder Shrug' }] };
    const { payload } = buildPayload(spec, byName);
    expect(payload.sets.map((s) => [s.round, s.setGroup])).toEqual([
      [1, 1], [1, 2], [2, 1], [2, 2],
    ]);
  });

  it('defaults rounds to 1', () => {
    const spec = { title: 'T', exercises: [{ name: 'V-Up' }] };
    const { payload } = buildPayload(spec, byName);
    expect(payload.sets).toHaveLength(1);
    expect(payload.sets[0].repetitionTotal).toBe(1);
  });
});

describe('buildPayload — rep-vs-duration auto-correction (HTTP 400 guard)', () => {
  it('rep-based movement uses prescribedReps, never prescribedDuration', () => {
    const { payload } = buildPayload({ title: 'T', exercises: [{ name: 'Shoulder Shrug', reps: 12 }] }, byName);
    expect(payload.sets[0].prescribedReps).toBe(12);
    expect(payload.sets[0].prescribedDuration).toBeUndefined();
  });

  it('timed movement uses prescribedDuration, never prescribedReps', () => {
    const { payload } = buildPayload({ title: 'T', exercises: [{ name: 'Suitcase March', duration: 40 }] }, byName);
    expect(payload.sets[0].prescribedDuration).toBe(40);
    expect(payload.sets[0].prescribedReps).toBeUndefined();
  });

  it('converts reps→duration for a timed movement and warns', () => {
    const { payload, warnings } = buildPayload({ title: 'T', exercises: [{ name: 'Suitcase March', reps: 10 }] }, byName);
    expect(payload.sets[0].prescribedDuration).toBe(30); // 10 reps * 3s
    expect(payload.sets[0].prescribedReps).toBeUndefined();
    expect(warnings.some((w) => /timed/.test(w))).toBe(true);
  });

  it('converts duration→reps for a rep-based movement and warns', () => {
    const { payload, warnings } = buildPayload({ title: 'T', exercises: [{ name: 'Shoulder Shrug', duration: 30 }] }, byName);
    expect(payload.sets[0].prescribedReps).toBe(10); // 30s / 3
    expect(payload.sets[0].prescribedDuration).toBeUndefined();
    expect(warnings.some((w) => /rep-based/.test(w))).toBe(true);
  });

  it('warns about off-machine (untracked weight) movements', () => {
    const { warnings } = buildPayload({ title: 'T', exercises: [{ name: 'V-Up', duration: 40 }] }, byName);
    expect(warnings.some((w) => /off-machine/.test(w))).toBe(true);
  });

  it('trusts user values when countReps is unknown', () => {
    const { payload } = buildPayload({ title: 'T', exercises: [{ name: 'Mystery Move', reps: 8 }] }, byName);
    expect(payload.sets[0].prescribedReps).toBe(8);
  });
});

describe('buildPayload — validation', () => {
  it('throws on missing title', () => {
    expect(() => buildPayload({ exercises: [{ name: 'V-Up' }] }, byName)).toThrow(/title/);
  });

  it('throws on no exercises', () => {
    expect(() => buildPayload({ title: 'T', exercises: [] }, byName)).toThrow(/at least one/);
  });

  it('throws with a helpful message on unknown exercise', () => {
    expect(() => buildPayload({ title: 'T', exercises: [{ name: 'Nonexistent Move' }] }, byName)).toThrow(/not found/);
  });

  it('defaults weightPercentage to 100', () => {
    const { payload } = buildPayload({ title: 'T', exercises: [{ name: 'V-Up' }] }, byName);
    expect(payload.sets[0].weightPercentage).toBe(100);
  });
});

describe('specFromSuggestion', () => {
  it('returns null for an unknown focus', () => {
    expect(specFromSuggestion('Nonsense Focus', byName)).toBe(null);
  });

  it('builds a Core spec from available library moves', () => {
    const spec = specFromSuggestion('Core & Mobility', byName, { rounds: 3 });
    expect(spec).not.toBe(null);
    expect(spec.rounds).toBe(3);
    // Template names V-Up, Standing Lift, Suitcase March all exist in fake lib
    expect(spec.exercises.map((e) => e.name)).toEqual(['V-Up', 'Standing Lift', 'Suitcase March']);
  });

  it('skips template exercises not present in the library', () => {
    // Our fake lib only has core moves; Back & Biceps template names are absent → null.
    expect(specFromSuggestion('Back & Biceps', byName)).toBe(null);
  });
});
