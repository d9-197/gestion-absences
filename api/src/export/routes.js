import { ErreurMetier } from '../erreurs.js';
import { nombreDeJours } from '../calendrier/dates.js';
import { STATUTS, lignesExport, lireAbsences } from './service.js';
import { versCsv } from './csv.js';
import { versXlsx } from './xlsx.js';

const PERIODE_MAX_JOURS = 731;
const date = { type: 'string', format: 'date' };
const ordre = new Intl.Collator('fr', { sensitivity: 'base' });

// L'export est réservé aux responsables (pour leurs équipes) et aux directeurs (pour toute l'entreprise).
export async function routesExport(app, { pool, config }) {
  app.addHook('onRequest', app.authentifier);
  app.addHook('onRequest', app.exigerRole('responsable', 'directeur'));

  const portee = (requete) => ({ moi: Number(requete.utilisateur.id), directeur: requete.utilisateur.role === 'directeur' });

  // Ce que la personne peut choisir dans les filtres : ses collaborateurs, leurs équipes, tous les types.
  app.get('/export/options', async (requete) => {
    const { moi, directeur } = portee(requete);
    const dansLaPortee = 'EXISTS (SELECT 1 FROM valideurs_de(c.id) v WHERE v = $2)';
    const [collaborateurs, equipes, types] = await Promise.all([
      pool.query(
        `SELECT c.id, c.prenom, c.nom, c.actif FROM collaborateurs c WHERE $1 OR ${dansLaPortee}`, [directeur, moi]),
      pool.query(
        `SELECT e.id, e.nom FROM equipes e
         WHERE EXISTS (SELECT 1 FROM collaborateurs c
                       WHERE c.equipe_id IN (SELECT sous_equipes(e.id)) AND ($1 OR ${dansLaPortee}))`, [directeur, moi]),
      pool.query('SELECT id, libelle, actif FROM types_absence ORDER BY ordre, lower(libelle)'),
    ]);
    return {
      collaborateurs: collaborateurs.rows
        .sort((a, b) => ordre.compare(a.nom, b.nom) || ordre.compare(a.prenom, b.prenom))
        .map((c) => ({ id: Number(c.id), prenom: c.prenom, nom: c.nom, actif: c.actif })),
      equipes: equipes.rows.sort((a, b) => ordre.compare(a.nom, b.nom)).map((e) => ({ id: Number(e.id), nom: e.nom })),
      types: types.rows.map((t) => ({ id: Number(t.id), libelle: t.libelle, actif: t.actif })),
    };
  });

  app.get('/export/absences', {
    schema: {
      querystring: {
        type: 'object',
        required: ['debut', 'fin'],
        properties: {
          debut: date,
          fin: date,
          format: { enum: ['xlsx', 'csv'] },
          equipeId: { type: 'integer', minimum: 1 },
          collaborateurId: { type: 'integer', minimum: 1 },
          typeId: { type: 'integer', minimum: 1 },
          statut: { type: 'string', maxLength: 100 }, // plusieurs statuts, séparés par des virgules
        },
      },
    },
  }, async (requete, reponse) => {
    const { debut, fin, format = 'xlsx', equipeId, collaborateurId, typeId } = requete.query;
    if (fin < debut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
    if (nombreDeJours(debut, fin) > PERIODE_MAX_JOURS) throw new ErreurMetier(400, `La période est limitée à ${PERIODE_MAX_JOURS} jours`);

    const statuts = requete.query.statut ? requete.query.statut.split(',').map((s) => s.trim()) : STATUTS;
    const inconnu = statuts.find((s) => !STATUTS.includes(s));
    if (inconnu) throw new ErreurMetier(400, `Statut inconnu : ${inconnu}`);

    const { moi, directeur } = portee(requete);
    const rows = await lireAbsences(pool, { moi, directeur, debut, fin, equipeId, collaborateurId, typeId, statuts });
    const lignes = lignesExport(rows, config.fuseau ?? 'Europe/Paris');
    // Un export contient des données personnelles, dont des données de santé : il est tracé.
    requete.log.info({ exporteur: moi, debut, fin, format, lignes: lignes.length, filtres: { equipeId, collaborateurId, typeId, statuts } }, 'export des absences');

    const nom = `absences_${debut}_${fin}.${format}`;
    return reponse
      .header('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${nom}"`)
      .header('X-Lignes', String(lignes.length))
      .header('Cache-Control', 'no-store')
      .send(format === 'csv' ? versCsv(lignes) : await versXlsx(lignes));
  });
}
