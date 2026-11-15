import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hacher, verifier } from '../src/auth/mots-de-passe.js';

test('un mot de passe haché se vérifie, un autre non', async () => {
  const hachage = await hacher('correct horse battery');
  assert.match(hachage, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifier('correct horse battery', hachage), true);
  assert.equal(await verifier('correct horse batterie', hachage), false);
});

test('deux hachages du même mot de passe diffèrent (sel aléatoire)', async () => {
  assert.notEqual(await hacher('identique-identique'), await hacher('identique-identique'));
});

test('une valeur stockée invalide ne se vérifie jamais', async () => {
  assert.equal(await verifier('x', null), false);
  assert.equal(await verifier('x', 'en clair'), false);
});
