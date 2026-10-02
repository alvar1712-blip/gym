// Perfil (rondas 5 y 6): valores por defecto para perfiles antiguos, edad exacta y grupos de edad.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfile, ageOn, validBirthDate, ageGroup, isNewProfile, profileExtrasMissing, profileIncomplete, MINOR_AGE, SENIOR_AGE,
} from '../../js/profile.js';

test('un perfil de la ronda 5 (sin los campos nuevos) sigue valiendo tal cual', () => {
  const old = { sex: 'male', goal: 'gain', experience: 'advanced', cycleTracking: true, contraception: null, promptDismissed: true };
  const p = getProfile({ profile: old });
  assert.deepEqual([p.sex, p.goal, p.experience, p.promptDismissed], ['male', 'gain', 'advanced', true]);
  assert.deepEqual([p.birthDate, p.secondaryGoals, p.sports, p.limitations, p.weeklyFrequency, p.onboardedAt], [null, [], [], '', null, null]);
  assert.equal(profileIncomplete(p), false);
  assert.equal(isNewProfile(p), false);
  assert.deepEqual(profileExtrasMissing(p), ['birthDate', 'sports', 'weeklyFrequency']);
  assert.equal(ageGroup(p, '2026-10-02'), 'unknown', 'sin fecha de nacimiento no se supone ninguna edad');
  // Sin ajustes o sin perfil: todo por defecto.
  assert.equal(getProfile(undefined).sex, null);
  assert.equal(getProfile({}).cycleLengthGuess, 28);
});

test('getProfile: listas nuevas en cada llamada y datos raros saneados', () => {
  const a = getProfile({});
  a.sports.push('run');
  assert.deepEqual(getProfile({}).sports, [], 'los valores por defecto no se contaminan');
  const p = getProfile({ profile: { sports: 'run', secondaryGoals: null, limitations: 3 } });
  assert.deepEqual([p.sports, p.secondaryGoals, p.limitations], [[], [], '']);
  const src = { profile: { sports: ['run'] } };
  getProfile(src).sports.push('bike');
  assert.deepEqual(src.profile.sports, ['run'], 'no modifica el perfil guardado');
});

test('ageOn: edad cumplida exacta (también el día del cumpleaños y el 29 de febrero)', () => {
  assert.equal(ageOn('2008-10-02', '2026-10-02'), 18, 'cumple 18 hoy');
  assert.equal(ageOn('2008-10-03', '2026-10-02'), 17, 'cumple 18 mañana');
  assert.equal(ageOn('2008-12-31', '2026-01-01'), 17);
  assert.equal(ageOn('2004-02-29', '2025-02-28'), 20);
  assert.equal(ageOn('2004-02-29', '2025-03-01'), 21);
  assert.equal(ageOn('2026-10-03', '2026-10-02'), null, 'en el futuro');
  assert.equal(ageOn('1900-01-01', '2026-10-02'), null, 'más de 110 años: casi seguro un error');
  assert.equal(ageOn('2008-02-30', '2026-10-02'), null);
  assert.equal(ageOn(null, '2026-10-02'), null);
  assert.equal(validBirthDate('2000-05-05', '2026-10-02'), true);
  assert.equal(validBirthDate('', '2026-10-02'), false);
});

test('ageGroup: menor, adulto y mayor', () => {
  const at = (birthDate) => ageGroup({ birthDate }, '2026-10-02');
  assert.equal(MINOR_AGE, 18);
  assert.equal(SENIOR_AGE, 65);
  assert.equal(at('2012-03-01'), 'minor');
  assert.equal(at('2008-10-03'), 'minor', 'un día antes de los 18');
  assert.equal(at('2008-10-02'), 'adult');
  assert.equal(at('1961-10-03'), 'adult', 'un día antes de los 65');
  assert.equal(at('1961-10-02'), 'senior');
  assert.equal(at('2030-01-01'), 'unknown');
  assert.equal(ageGroup(null, '2026-10-02'), 'unknown');
});

test('isNewProfile: solo sin datos básicos y sin onboarding', () => {
  assert.equal(isNewProfile(getProfile({})), true);
  assert.equal(isNewProfile(getProfile({ profile: { sex: 'female' } })), false);
  assert.equal(isNewProfile(getProfile({ profile: { onboardedAt: 1 } })), false, 'si ya pasó por el onboarding (aunque lo saltara todo)');
  assert.deepEqual(profileExtrasMissing(getProfile({ profile: { birthDate: '2000-01-01', sports: ['run'], weeklyFrequency: 4 } })), []);
});
