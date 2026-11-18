import { aujourdhui as jourDeLEntreprise, estWeekEnd, nombreDeJours } from '../calendrier/dates.js';
import { formatPeriodeCourte, nomComplet } from './format.js';

export const HEURE_RESUME = 7; // pas de résumé avant 7 h, heure de l'entreprise
export const RELANCE_JOURS_MAX = 60;

// Réglages : « immediat » envoie un e-mail à chaque demande ; « quotidien » groupe les demandes à traiter dans un résumé
// par jour. `relanceJours` (0 = aucune relance) : au bout de N jours sans décision le valideur le plus proche est relancé,
// au bout de 2 N jours toute la chaîne de validation (responsables du niveau supérieur, directeurs) l'est aussi.
export async function lireReglagesNotification(db) {
  const { rows } = await db.query(
    `SELECT cle, valeur FROM parametres WHERE cle IN ('notification_a_traiter', 'relance_jours')`,
  );
  const valeurs = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
  const mode = valeurs.notification_a_traiter === 'quotidien' ? 'quotidien' : 'immediat';
  const relance = Number.isInteger(valeurs.relance_jours) && valeurs.relance_jours >= 0 ? valeurs.relance_jours : 0;
  return { mode, relanceJours: Math.min(relance, RELANCE_JOURS_MAX) };
}

const ligneDemande = (d, relance) => {
  const age = d.age === 0 ? "reçue aujourd'hui" : `en attente depuis ${d.age} jour${d.age > 1 ? 's' : ''}`;
  const avert = d.avertissements.length ? `, ${d.avertissements.length} avertissement${d.avertissements.length > 1 ? 's' : ''}` : '';
  return `  - ${nomComplet(d.collaborateur)} (${d.equipe}) : ${d.type}, ${formatPeriodeCourte(d)} — ${age}${avert}${relance ? ' [relance]' : ''}`;
};

// Le texte du résumé d'un valideur : les demandes nouvelles ou en attente, et les relances.
export function texteResume({ prenom, demandes, appUrl, raisonSociale }) {
  const relances = demandes.filter((d) => d.relance);
  const autres = demandes.filter((d) => !d.relance);
  const lignes = [`Bonjour ${prenom},`, ''];
  if (autres.length) {
    lignes.push(`${autres.length} demande${autres.length > 1 ? 's attendent' : ' attend'} votre décision :`, ...autres.map((d) => ligneDemande(d, false)), '');
  }
  if (relances.length) {
    lignes.push(
      `Relance : ${relances.length} demande${relances.length > 1 ? 's sont' : ' est'} en attente depuis plusieurs jours :`,
      ...relances.map((d) => ligneDemande(d, false)), '',
    );
  }
  lignes.push(`Pour les traiter : ${appUrl}/a-traiter`, '', '--', raisonSociale || 'Gestion des absences', 'Message automatique, merci de ne pas y répondre.');
  return lignes.join('\n');
}

// Prépare les résumés du jour, dans la transaction en cours : un e-mail par valideur concerné. Renvoie le nombre
// d'e-mails enfilés. Appelé au plus une fois par jour (voir `envoyerResumes`).
export async function preparerResumes(client, { jour, fuseau, appUrl }) {
  const { mode, relanceJours } = await lireReglagesNotification(client);
  const { rows: demandes } = await client.query(
    `SELECT d.id, d.collaborateur_id, c.prenom, c.nom, e.nom AS equipe, t.libelle AS type,
            d.date_debut, d.date_fin, d.avertissements,
            (d.soumise_le AT TIME ZONE $1)::date AS soumise_le_jour
     FROM demandes_avec_statut d
       JOIN collaborateurs c ON c.id = d.collaborateur_id
       JOIN equipes e ON e.id = d.equipe_id
       JOIN types_absence t ON t.id = d.type_id
     WHERE d.statut = 'en_attente' ORDER BY d.date_debut, d.id`,
    [fuseau],
  );
  const parValideur = new Map(); // id -> demandes à lui présenter
  const presenter = (id, demande, relance) => {
    const liste = parValideur.get(id) ?? new Map();
    // Une demande n'apparaît qu'une fois ; si elle est à la fois nouvelle et en relance pour la personne, la relance prime.
    liste.set(demande.id, { ...demande, relance: relance || liste.get(demande.id)?.relance || false });
    parValideur.set(id, liste);
  };

  for (const d of demandes) {
    const age = Math.max(0, nombreDeJours(d.soumise_le_jour, jour) - 1);
    const demande = {
      id: Number(d.id), collaborateur: { prenom: d.prenom, nom: d.nom }, equipe: d.equipe, type: d.type,
      dateDebut: d.date_debut, dateFin: d.date_fin, avertissements: d.avertissements, age,
    };
    const proches = (await client.query('SELECT valideurs_proches_de($1) AS id', [d.collaborateur_id])).rows.map((r) => Number(r.id));
    const relancer = relanceJours > 0 && age >= relanceJours;
    if (mode === 'quotidien') proches.forEach((id) => presenter(id, demande, relancer));
    else if (relancer) proches.forEach((id) => presenter(id, demande, true));
    if (relanceJours > 0 && age >= 2 * relanceJours) {
      const tous = (await client.query('SELECT valideurs_de($1) AS id', [d.collaborateur_id])).rows.map((r) => Number(r.id));
      tous.forEach((id) => presenter(id, demande, true));
    }
  }
  if (!parValideur.size) return 0;

  const raisonSociale = (await client.query(`SELECT valeur FROM parametres WHERE cle = 'pdf_raison_sociale'`)).rows[0]?.valeur ?? '';
  const personnes = (await client.query(
    'SELECT id, email, prenom FROM collaborateurs WHERE actif AND id = ANY($1)', [[...parValideur.keys()]],
  )).rows;
  let enfiles = 0;
  for (const p of personnes) {
    const liste = [...parValideur.get(Number(p.id)).values()];
    const n = liste.length;
    const seulesRelances = liste.every((d) => d.relance);
    const sujet = seulesRelances
      ? `Relance : ${n} demande${n > 1 ? 's' : ''} en attente de décision`
      : `${n} demande${n > 1 ? 's' : ''} à traiter`;
    await client.query(
      `INSERT INTO envois_email (destinataire, sujet, avec_pdf, modele, corps) VALUES ($1, $2, false, 'resume', $3)`,
      [p.email, sujet, texteResume({ prenom: p.prenom, demandes: liste, appUrl, raisonSociale })],
    );
    enfiles++;
  }
  return enfiles;
}

// Un seul résumé par jour, même avec plusieurs processus : la ligne du jour est créée dans la même transaction que les
// e-mails, et sa clé unique départage les concurrents. Pas de résumé le week-end.
export async function envoyerResumes(pool, { jour, fuseau = 'Europe/Paris', appUrl }) {
  if (estWeekEnd(jour)) return null;
  const { mode, relanceJours } = await lireReglagesNotification(pool);
  if (mode === 'immediat' && relanceJours === 0) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('INSERT INTO resumes_quotidiens (jour, envoyes) VALUES ($1, 0) ON CONFLICT DO NOTHING', [jour]);
    if (!rowCount) { await client.query('ROLLBACK'); return null; }
    const envoyes = await preparerResumes(client, { jour, fuseau, appUrl });
    await client.query('UPDATE resumes_quotidiens SET envoyes = $2 WHERE jour = $1', [jour, envoyes]);
    await client.query('COMMIT');
    return { jour, envoyes };
  } catch (erreur) {
    await client.query('ROLLBACK').catch(() => {});
    throw erreur;
  } finally {
    client.release();
  }
}

// Contrôle toutes les 15 minutes ; envoie dès 7 h le premier jour ouvré où l'API tourne, une fois par jour.
export function creerPlanificateurResume({ pool, config, file, log, maintenant = () => new Date() }) {
  const fuseau = config.fuseau ?? 'Europe/Paris';
  let minuteur = null;
  let enCours = null;
  const verifier = () => {
    enCours ??= (async () => {
      const instant = maintenant();
      const heure = Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(instant).find((partie) => partie.type === 'hour')?.value);
      if (!Number.isInteger(heure) || heure < HEURE_RESUME) return null;
      const resultat = await envoyerResumes(pool, { jour: jourDeLEntreprise(fuseau, instant), fuseau, appUrl: config.appUrl });
      if (resultat?.envoyes) { log?.info(resultat, 'résumés quotidiens enfilés'); file?.reveiller(); }
      return resultat;
    })().finally(() => { enCours = null; });
    return enCours;
  };
  const surveiller = () => verifier().catch((erreur) => log?.error(erreur, 'résumé quotidien impossible'));
  return {
    verifier,
    demarrer() { if (minuteur) return; minuteur = setInterval(surveiller, 15 * 60 * 1000); minuteur.unref(); surveiller(); },
    async arreter() { if (minuteur) clearInterval(minuteur); minuteur = null; await enCours?.catch(() => {}); },
  };
}
