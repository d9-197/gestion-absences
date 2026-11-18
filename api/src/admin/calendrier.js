import { ErreurMetier, introuvable } from '../erreurs.js';
import { ajouterJours, estDateValide, estWeekEnd, nombreDeJours } from '../calendrier/dates.js';
import { assurerAnnee, insererFeriesLegaux } from '../calendrier/service.js';
import { transaction } from './outils.js';
import { champsModifies, parametresId } from './outils.js';

const date = { type: 'string', format: 'date' };
const libelle = { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' };
const annee = { type: 'integer', minimum: 2000, maximum: 2100 };
const parametresJour = { type: 'object', required: ['jour'], properties: { jour: date } };

const imposeVersJson = (j) => ({
  id: Number(j.id),
  jour: j.jour,
  libelle: j.libelle,
  equipeId: j.equipe_id === null ? null : Number(j.equipe_id),
  avecDecompte: j.avec_decompte,
});

const proprietesImpose = {
  jour: date,
  libelle,
  // null : toute l'entreprise ; sinon l'équipe et ses sous-équipes.
  equipeId: { type: ['integer', 'null'], minimum: 1 },
  avecDecompte: { type: 'boolean' },
};

export async function routesAdminCalendrier(app, { pool }) {
  async function verifierEquipe(equipeId) {
    if (equipeId === null || equipeId === undefined) return;
    const { rowCount } = await pool.query('SELECT 1 FROM equipes WHERE id = $1', [equipeId]);
    if (!rowCount) throw new ErreurMetier(400, 'Équipe inconnue');
  }

  // Tout le calendrier d'une année. Le premier appel préremplit ses jours fériés légaux.
  app.get('/calendrier', {
    schema: { querystring: { type: 'object', required: ['annee'], properties: { annee } } },
  }, async (requete) => {
    const an = requete.query.annee;
    await assurerAnnee(pool, an);
    const bornes = [`${an}-01-01`, `${an}-12-31`];
    const [feries, imposes] = await Promise.all([
      pool.query('SELECT jour, libelle FROM jours_feries WHERE jour BETWEEN $1 AND $2 ORDER BY jour', bornes),
      pool.query(
        `SELECT id, jour, libelle, equipe_id, avec_decompte FROM jours_imposes
         WHERE jour BETWEEN $1 AND $2 ORDER BY jour, equipe_id NULLS FIRST`,
        bornes,
      ),
    ]);
    return { annee: an, joursFeries: feries.rows, joursImposes: imposes.rows.map(imposeVersJson) };
  });

  // --- Jours fériés ----------------------------------------------------------

  app.post('/jours-feries', {
    schema: { body: { type: 'object', required: ['jour', 'libelle'], additionalProperties: false, properties: { jour: date, libelle } } },
  }, async (requete, reponse) => {
    const { rows } = await pool.query(
      'INSERT INTO jours_feries (jour, libelle) VALUES ($1, $2) RETURNING jour, libelle',
      [requete.body.jour, requete.body.libelle.trim()],
    );
    return reponse.code(201).send(rows[0]);
  });

  app.patch('/jours-feries/:jour', {
    schema: {
      params: parametresJour,
      body: { type: 'object', required: ['libelle'], additionalProperties: false, properties: { libelle } },
    },
  }, async (requete) => {
    const { rows } = await pool.query(
      'UPDATE jours_feries SET libelle = $1 WHERE jour = $2 RETURNING jour, libelle',
      [requete.body.libelle.trim(), requete.params.jour],
    );
    if (!rows.length) throw introuvable('Jour férié');
    return rows[0];
  });

  app.delete('/jours-feries/:jour', { schema: { params: parametresJour } }, async (requete, reponse) => {
    const { rowCount } = await pool.query('DELETE FROM jours_feries WHERE jour = $1', [requete.params.jour]);
    if (!rowCount) throw introuvable('Jour férié');
    return reponse.code(204).send();
  });

  // Remet les jours fériés légaux manquants d'une année, sans toucher à ceux qui existent.
  app.post('/jours-feries/retablir', {
    schema: { body: { type: 'object', required: ['annee'], additionalProperties: false, properties: { annee } } },
  }, async (requete) => {
    await assurerAnnee(pool, requete.body.annee);
    return { ajoutes: await insererFeriesLegaux(pool, requete.body.annee) };
  });

  // --- Jours non travaillés imposés -------------------------------------------

  app.post('/jours-imposes', {
    schema: {
      body: {
        type: 'object', required: ['jour', 'libelle', 'avecDecompte'], additionalProperties: false,
        properties: proprietesImpose,
      },
    },
  }, async (requete, reponse) => {
    const { jour, libelle: texte, equipeId = null, avecDecompte } = requete.body;
    await verifierEquipe(equipeId);
    const { rows } = await pool.query(
      `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte) VALUES ($1, $2, $3, $4)
       RETURNING id, jour, libelle, equipe_id, avec_decompte`,
      [jour, texte.trim(), equipeId, avecDecompte],
    );
    return reponse.code(201).send(imposeVersJson(rows[0]));
  });

  // Le même jour imposé sur toute une période (une fermeture de plusieurs jours, un pont). Les jours déjà imposés pour la
  // même équipe sont laissés tels quels. Par défaut, les week-ends et jours fériés sont sautés : ils ne sont pas travaillés.
  app.post('/jours-imposes/plage', {
    schema: {
      body: {
        type: 'object', required: ['debut', 'fin', 'libelle', 'avecDecompte'], additionalProperties: false,
        properties: {
          debut: date, fin: date, libelle,
          equipeId: { type: ['integer', 'null'], minimum: 1 },
          avecDecompte: { type: 'boolean' },
          ouvresSeulement: { type: 'boolean', default: true },
        },
      },
    },
  }, async (requete, reponse) => {
    const { debut, fin, libelle: texte, equipeId = null, avecDecompte, ouvresSeulement } = requete.body;
    if (fin < debut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
    if (nombreDeJours(debut, fin) > 366) throw new ErreurMetier(400, 'La période est limitée à 366 jours');
    await verifierEquipe(equipeId);
    await assurerAnnee(pool, Number(debut.slice(0, 4)));
    await assurerAnnee(pool, Number(fin.slice(0, 4)));
    const feries = new Set((await pool.query('SELECT jour FROM jours_feries WHERE jour BETWEEN $1 AND $2', [debut, fin])).rows.map((r) => r.jour));
    const jours = [];
    for (let jour = debut; jour <= fin; jour = ajouterJours(jour, 1)) {
      if (ouvresSeulement && (estWeekEnd(jour) || feries.has(jour))) continue;
      jours.push(jour);
    }
    if (!jours.length) throw new ErreurMetier(400, 'Aucun jour à ajouter sur cette période (week-ends et jours fériés exclus)');
    const { rowCount } = await pool.query(
      `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte)
       SELECT j, $2, $3, $4 FROM unnest($1::date[]) AS j ON CONFLICT DO NOTHING`,
      [jours, texte.trim(), equipeId, avecDecompte],
    );
    return reponse.code(201).send({ ajoutes: rowCount, dejaPresents: jours.length - rowCount });
  });

  // Reprend les jours imposés d'une année sur une autre, à la même date (les ponts changent de jour d'une année à l'autre :
  // à relire ensuite). Un 29 février sans équivalent est ignoré, comme les jours déjà imposés pour la même équipe.
  app.post('/jours-imposes/copie', {
    schema: {
      body: {
        type: 'object', required: ['anneeSource', 'anneeCible'], additionalProperties: false,
        properties: { anneeSource: annee, anneeCible: annee },
      },
    },
  }, async (requete, reponse) => {
    const { anneeSource, anneeCible } = requete.body;
    if (anneeSource === anneeCible) throw new ErreurMetier(400, 'Les deux années doivent être différentes');
    const resultat = await transaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT jour, libelle, equipe_id, avec_decompte FROM jours_imposes WHERE jour BETWEEN $1 AND $2`,
        [`${anneeSource}-01-01`, `${anneeSource}-12-31`],
      );
      let ajoutes = 0;
      let ignores = 0;
      for (const ligne of rows) {
        const cible = `${anneeCible}${ligne.jour.slice(4)}`;
        if (!estDateValide(cible)) { ignores++; continue; }
        const { rowCount } = await client.query(
          `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [cible, ligne.libelle, ligne.equipe_id, ligne.avec_decompte],
        );
        ajoutes += rowCount;
        ignores += 1 - rowCount;
      }
      return { trouves: rows.length, ajoutes, ignores };
    });
    return reponse.code(201).send(resultat);
  });

  app.patch('/jours-imposes/:id', {
    schema: {
      params: parametresId,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: proprietesImpose },
    },
  }, async (requete) => {
    const corps = { ...requete.body };
    if (corps.libelle !== undefined) corps.libelle = corps.libelle.trim();
    await verifierEquipe(corps.equipeId);
    const { colonnes, valeurs } = champsModifies(corps, {
      jour: 'jour', libelle: 'libelle', equipeId: 'equipe_id', avecDecompte: 'avec_decompte',
    });
    const { rows } = await pool.query(
      `UPDATE jours_imposes SET ${colonnes.join(', ')} WHERE id = $${valeurs.length + 1}
       RETURNING id, jour, libelle, equipe_id, avec_decompte`,
      [...valeurs, requete.params.id],
    );
    if (!rows.length) throw introuvable('Jour imposé');
    return imposeVersJson(rows[0]);
  });

  app.delete('/jours-imposes/:id', { schema: { params: parametresId } }, async (requete, reponse) => {
    const { rowCount } = await pool.query('DELETE FROM jours_imposes WHERE id = $1', [requete.params.id]);
    if (!rowCount) throw introuvable('Jour imposé');
    return reponse.code(204).send();
  });
}
