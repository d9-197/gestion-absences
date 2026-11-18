import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieSecure } from '../src/auth/cookie.js';
import { cheminPublic } from '../src/auth/sessions.js';

test('le cookie suit le schéma de l\'adresse publique quand rien n\'est précisé', () => {
  assert.equal(cookieSecure('https://absences.exemple.fr', undefined), true);
  assert.equal(cookieSecure('https://absences.exemple.fr', ''), true);
  assert.equal(cookieSecure('http://192.168.1.12:3002', undefined), false);
  assert.equal(cookieSecure('http://192.168.1.12:3002', ''), false);
});

test('un réglage explicite l\'emporte', () => {
  assert.equal(cookieSecure('http://192.168.1.12:3002', 'true'), true);
  assert.equal(cookieSecure('https://absences.exemple.fr', 'false'), false);
});

test('le chemin public se déduit de APP_URL : vide à la racine, « /abs » sous un préfixe', () => {
  assert.equal(cheminPublic('https://absences.exemple.fr'), '');
  assert.equal(cheminPublic('https://absences.exemple.fr/'), '');
  assert.equal(cheminPublic('https://alainfarina.com/abs'), '/abs');
  assert.equal(cheminPublic('https://alainfarina.com/abs/'), '/abs');
  assert.equal(cheminPublic('pas une adresse'), '');
});
