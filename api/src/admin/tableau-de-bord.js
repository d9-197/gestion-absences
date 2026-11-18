import { ajouterJours, jourSemaine } from '../calendrier/dates.js';
import { HEURE_PURGE } from '../purge/planificateur.js';
import { apercu, lireDuree } from '../purge/service.js';

const SEUIL_DEFAUT = 3;

// Vue d'ensemble pour la direction : qui est absent, ce qui attend depuis trop longtemps, ce qui est en panne.
// Les absents sont ceux du planning de la direction (toute l'entreprise), avec les mêmes règles de statut.
export async function routesTableauDeBord(app, { pool, aujourdhui }) {
  app.get('/tableau-de-bord', {
    schema: { querystring: { type: 'object', properties: { seuilJours: { type: 'integer', minimum: 1, maximum: 60, default: SEUIL_DEFAUT } } } },
  }, async (requete) => {
    const jour = aujourdhui();
    const { seuilJours } = requete.query;
    // Lundi de la semaine en cours (dimanche = 0 : retour au lundi précédent).
    const lundi = ajouterJours(jour, -((jourSemaine(jour) + 6) % 7));
    const semaine = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

    const [absences, attente, emails, feries] = await Promise.all([
      pool.query(
        `SELECT d.collaborateur_id, c.prenom, c.nom, e.nom AS equipe, t.libelle AS type,
                d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee, d.statut
         FROM demandes_avec_statut d
           JOIN collaborateurs c ON c.id = d.collaborateur_id
           JOIN equipes e ON e.id = c.equipe_id
           JOIN types_absence t ON t.id = d.type_id
         WHERE d.nature = 'absence' AND d.statut IN ('en_attente', 'approuvee', 'enregistree')
           AND d.date_debut <= $2 AND d.date_fin >= $1 AND c.actif
         ORDER BY c.nom, c.prenom, d.date_debut`,
        [semaine[0], semaine[6]],
      ),
      pool.query(
        `SELECT d.id, c.prenom, c.nom, d.date_debut, d.date_fin, d.soumise_le, t.libelle AS type
         FROM demandes_avec_statut d JOIN collaborateurs c ON c.id = d.collaborateur_id JOIN types_absence t ON t.id = d.type_id
         WHERE d.statut = 'en_attente' AND d.soumise_le <= now() - make_interval(days => $1)
         ORDER BY d.soumise_le LIMIT 20`,
        [seuilJours],
      ),
      pool.query(
        `SELECT count(*) FILTER (WHERE statut = 'echec')::int AS echecs, count(*) FILTER (WHERE statut = 'en_attente')::int AS en_attente
         FROM envois_email`,
      ),
      pool.query('SELECT jour FROM jours_feries WHERE jour BETWEEN $1 AND $2', [semaine[0], semaine[6]]),
    ]);
    const nbEnAttente = (await pool.query(`SELECT count(*)::int AS n FROM demandes_avec_statut WHERE statut = 'en_attente'`)).rows[0].n;

    // Pour chaque demi-journée, les personnes absentes ; un jour sans jour travaillé n'est pas compté.
    const absentsLe = (j, demi) => absences.rows
      .filter((a) => a.date_debut <= j && a.date_fin >= j
        && !(a.date_debut === j && demi === 'matin' && a.debut_demi_journee === 'apres_midi')
        && !(a.date_fin === j && demi === 'apres_midi' && a.fin_demi_journee === 'matin'));
    const ferie = new Set(feries.rows.map((r) => r.jour));
    const jours = semaine.map((j) => {
      const travaille = ![0, 6].includes(jourSemaine(j)) && !ferie.has(j);
      const matin = travaille ? new Set(absentsLe(j, 'matin').map((a) => Number(a.collaborateur_id))) : new Set();
      const aprem = travaille ? new Set(absentsLe(j, 'apres_midi').map((a) => Number(a.collaborateur_id))) : new Set();
      return { jour: j, travaille, matin: matin.size, apresMidi: aprem.size };
    });

    const aujourdhuiListe = new Map();
    for (const demi of ['matin', 'apres_midi']) {
      for (const a of absentsLe(jour, demi)) {
        const cle = Number(a.collaborateur_id);
        const ligne = aujourdhuiListe.get(cle) ?? {
          id: cle, prenom: a.prenom, nom: a.nom, equipe: a.equipe, type: a.type, statut: a.statut === 'en_attente' ? 'en_attente' : 'confirmee',
          matin: false, apresMidi: false,
        };
        if (demi === 'matin') ligne.matin = true; else ligne.apresMidi = true;
        aujourdhuiListe.set(cle, ligne);
      }
    }

    // Prochaine purge : la nuit prochaine, à partir de 3 h ; ce qu'elle supprimerait avec la durée actuelle.
    let purge = null;
    try {
      const mois = await lireDuree(pool);
      const prevu = await apercu(pool, { mois, aujourdhui: jour });
      purge = { apresHeure: HEURE_PURGE, dateLimite: prevu.dateLimite, demandes: prevu.demandes, moisConservation: mois };
    } catch { /* durée invalide : la page de conservation le signale */ }

    return {
      jour,
      absentsAujourdhui: [...aujourdhuiListe.values()],
      semaine: jours,
      enAttente: { total: nbEnAttente, seuilJours, anciennes: attente.rows.map((d) => ({
        id: Number(d.id), prenom: d.prenom, nom: d.nom, type: d.type, dateDebut: d.date_debut, dateFin: d.date_fin, soumiseLe: d.soumise_le,
      })) },
      emails: { echecs: emails.rows[0].echecs, enAttente: emails.rows[0].en_attente },
      purge,
    };
  });
}
