import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajouterJours, calculerDuree, estDateValide, joursFeriesFrancais, paques } from '../src/calendrier/dates.js';

test('Pâques tombe aux dates connues', () => {
  const connues = { 2019: '2019-04-21', 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2038: '2038-04-25' };
  for (const [an, date] of Object.entries(connues)) assert.equal(paques(Number(an)), date);
});

test('les onze jours fériés de 2026', () => {
  assert.deepEqual(joursFeriesFrancais(2026).map((f) => `${f.jour} ${f.libelle}`), [
    "2026-01-01 Jour de l'An",
    '2026-04-06 Lundi de Pâques',
    '2026-05-01 Fête du Travail',
    '2026-05-08 Victoire 1945',
    '2026-05-14 Ascension',
    '2026-05-25 Lundi de Pentecôte',
    '2026-07-14 Fête nationale',
    '2026-08-15 Assomption',
    '2026-11-01 Toussaint',
    '2026-11-11 Armistice 1918',
    '2026-12-25 Noël',
  ]);
});

test('en 2008, Ascension et 1er mai tombent le même jour : la liste reste triée', () => {
  const jours = joursFeriesFrancais(2008).map((f) => f.jour);
  assert.equal(jours.filter((j) => j === '2008-05-01').length, 2);
  assert.deepEqual(jours, [...jours].sort());
});

test('ajouterJours passe les fins de mois, d\'année et les années bissextiles', () => {
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
  assert.equal(ajouterJours('2028-02-28', 1), '2028-02-29');
  assert.equal(ajouterJours('2026-03-01', -1), '2026-02-28');
  // Changement d'heure de mars : pas de jour sauté ni doublé.
  assert.equal(ajouterJours('2026-03-28', 2), '2026-03-30');
});

test('estDateValide refuse les dates impossibles', () => {
  assert.equal(estDateValide('2026-02-28'), true);
  assert.equal(estDateValide('2026-02-30'), false);
  assert.equal(estDateValide('26-02-28'), false);
  assert.equal(estDateValide(null), false);
});

// Semaine du lundi 2 au vendredi 6 mars 2026, sans jour férié.
const duree = (dateDebut, dateFin, debutDemiJournee, finDemiJournee, nonTravailles) =>
  calculerDuree({ dateDebut, dateFin, debutDemiJournee, finDemiJournee, nonTravailles });

test('durée : semaine complète, week-ends exclus', () => {
  assert.equal(duree('2026-03-02', '2026-03-06'), 10);
  assert.equal(duree('2026-03-02', '2026-03-13'), 20);
  assert.equal(duree('2026-03-07', '2026-03-08'), 0); // samedi et dimanche
});

test('durée : demi-journées de début et de fin', () => {
  assert.equal(duree('2026-03-02', '2026-03-02'), 2);
  assert.equal(duree('2026-03-02', '2026-03-02', 'matin', 'matin'), 1);
  assert.equal(duree('2026-03-02', '2026-03-02', 'apres_midi', 'apres_midi'), 1);
  assert.equal(duree('2026-03-02', '2026-03-03', 'apres_midi', 'matin'), 2);
  // Du vendredi après-midi au lundi matin.
  assert.equal(duree('2026-03-06', '2026-03-09', 'apres_midi', 'matin'), 2);
});

test('durée : une demi-journée sur un jour non travaillé ne retire rien', () => {
  // Début un samedi après-midi, fin le lundi : seul le lundi compte, en entier.
  assert.equal(duree('2026-03-07', '2026-03-09', 'apres_midi', 'apres_midi'), 2);
  // Fin un dimanche matin : le vendredi compte en entier.
  assert.equal(duree('2026-03-06', '2026-03-08', 'matin', 'matin'), 2);
});

test('durée : jours fériés et jours imposés exclus', () => {
  // Semaine de l'Ascension 2026 : jeudi 14 férié, vendredi 15 pont imposé.
  const nonTravailles = new Set(['2026-05-14', '2026-05-15']);
  assert.equal(duree('2026-05-11', '2026-05-15', 'matin', 'apres_midi', nonTravailles), 6);
  assert.equal(duree('2026-05-14', '2026-05-15', 'matin', 'apres_midi', nonTravailles), 0);
  assert.equal(duree('2026-05-13', '2026-05-14', 'apres_midi', 'matin', nonTravailles), 1);
});
