import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cookieSecure } from '../src/auth/cookie.js';

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
