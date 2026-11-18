import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enteteTelechargement } from '../src/nom-fichier.js';

test('nom de fichier : accents et caractères spéciaux', () => {
  assert.equal(
    enteteTelechargement('fiche-rh-2026-10-Müller-Çelik-Hélène.pdf'),
    `attachment; filename="fiche-rh-2026-10-Muller-Celik-Helene.pdf"; filename*=UTF-8''fiche-rh-2026-10-M%C3%BCller-%C3%87elik-H%C3%A9l%C3%A8ne.pdf`,
  );
  const o = enteteTelechargement("Cœur d'Œuvre/ß:ø*?.pdf");
  assert.match(o, /filename="Coeur_d_OEuvre_ss_o_.pdf"/);
  assert.match(o, /filename\*=UTF-8''C%C5%93ur%20d%27%C5%92uvre_%C3%9F_%C3%B8_.pdf/);
  assert.equal(enteteTelechargement('absences_2026-12-01.csv'), 'attachment; filename="absences_2026-12-01.csv"');
  assert.match(enteteTelechargement('///'), /filename="_"/);
});
