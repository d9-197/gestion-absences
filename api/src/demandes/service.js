import { ErreurMetier, introuvable } from '../erreurs.js';
import { ajouterMois, calculerDuree, nombreDeJours, numeroDemiJournee } from '../calendrier/dates.js';
import { joursNonTravailles } from '../calendrier/service.js';
import { enfiler } from '../emails/file.js';

export const PERIODE_MAX_JOURS = 366;

const STATUTS_ACTIFS = ['en_attente', 'approuvee', 'enregistree'];
const LIBELLE_STATUT = {
  en_attente: 'en attente', approuvee: 'approuvée', enregistree: 'enregistrée',
  refusee: 'refusée', retiree: 'retirée', annulee: 'annulée',
};
const frDate = (iso) => iso.split('-').reverse().join('/');

// Colonnes lues pour décrire une demande, avec ce qui permet de calculer les actions possibles pour $1.
export const SELECTION_DEMANDE = `
  SELECT d.id, d.nature, d.demande_annulee_id, d.remplace_id,
         d.collaborateur_id, c.prenom AS collaborateur_prenom, c.nom AS collaborateur_nom,
         d.equipe_id, e.nom AS equipe_nom,
         d.type_id, t.libelle AS type_libelle,
         d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee, d.duree_demi_journees,
         d.commentaire, d.avertissements,
         d.saisie_par_id, s.prenom AS saisie_prenom, s.nom AS saisie_nom, d.soumise_le,
         d.statut, d.statut_par_id, sp.prenom AS statut_par_prenom, sp.nom AS statut_par_nom,
         d.statut_le, d.statut_motif,
         EXISTS (SELECT 1 FROM valideurs_de(d.collaborateur_id) v WHERE v = $1) AS est_valideur,
         EXISTS (SELECT 1 FROM demandes_avec_statut a
                 WHERE a.demande_annulee_id = d.id AND a.statut = 'en_attente') AS annulation_en_cours
  FROM demandes_avec_statut d
  JOIN collaborateurs c ON c.id = d.collaborateur_id
  JOIN equipes e ON e.id = d.equipe_id
  JOIN types_absence t ON t.id = d.type_id
  JOIN collaborateurs s ON s.id = d.saisie_par_id
  LEFT JOIN collaborateurs sp ON sp.id = d.statut_par_id`;

const personne = (id, prenom, nom) => (id === null ? null : { id: Number(id), prenom, nom });

// Description d'une demande pour la personne `moi`, avec les actions qu'elle peut faire dessus.
export function demandeVersJson(d, moi) {
  const estSoi = Number(d.collaborateur_id) === moi;
  const estAuteur = estSoi || Number(d.saisie_par_id) === moi;
  const enAttente = d.statut === 'en_attente';
  return {
    id: Number(d.id),
    nature: d.nature,
    demandeAnnuleeId: d.demande_annulee_id === null ? null : Number(d.demande_annulee_id),
    remplaceId: d.remplace_id === null ? null : Number(d.remplace_id),
    collaborateur: personne(d.collaborateur_id, d.collaborateur_prenom, d.collaborateur_nom),
    equipe: { id: Number(d.equipe_id), nom: d.equipe_nom },
    type: { id: Number(d.type_id), libelle: d.type_libelle },
    dateDebut: d.date_debut,
    debutDemiJournee: d.debut_demi_journee,
    dateFin: d.date_fin,
    finDemiJournee: d.fin_demi_journee,
    dureeDemiJournees: d.duree_demi_journees,
    commentaire: d.commentaire,
    avertissements: d.avertissements,
    saisiePar: personne(d.saisie_par_id, d.saisie_prenom, d.saisie_nom),
    soumiseLe: d.soumise_le,
    statut: d.statut,
    statutPar: personne(d.statut_par_id, d.statut_par_prenom, d.statut_par_nom),
    statutLe: d.statut_le,
    motif: d.statut_motif,
    actions: {
      decider: enAttente && d.est_valideur,
      retirer: enAttente && estAuteur,
      annuler: d.nature === 'absence' && ['approuvee', 'enregistree'].includes(d.statut)
        && !d.annulation_en_cours && (estSoi || d.est_valideur),
    },
    annulationEnCours: d.annulation_en_cours,
  };
}

export async function lireDemande(db, id, moi) {
  const { rows } = await db.query(`${SELECTION_DEMANDE} WHERE d.id = $2`, [moi, id]);
  return rows[0] ?? null;
}

// Une demande n'est visible que de son collaborateur, de la personne qui l'a saisie et de ses valideurs.
export async function lireDemandeVisible(db, id, moi) {
  const demande = await lireDemande(db, id, moi);
  const visible = demande
    && (Number(demande.collaborateur_id) === moi || Number(demande.saisie_par_id) === moi || demande.est_valideur);
  if (!visible) throw introuvable('Demande');
  return demande;
}

export async function nombreDeValideurs(db, collaborateurId) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM valideurs_de($1)', [collaborateurId]);
  return rows[0].n;
}

async function parametre(db, cle) {
  const { rows } = await db.query('SELECT valeur FROM parametres WHERE cle = $1', [cle]);
  return Number(rows[0].valeur);
}

// Contrôles d'une période : règles bloquantes uniquement (les avertissements viennent ensuite).
function verifierPeriode({ dateDebut, debutDemiJournee, dateFin, finDemiJournee }) {
  if (dateFin < dateDebut) throw new ErreurMetier(400, 'La date de fin précède la date de début');
  if (dateFin === dateDebut && debutDemiJournee === 'apres_midi' && finDemiJournee === 'matin') {
    throw new ErreurMetier(400, 'Le matin de fin précède l\'après-midi de début');
  }
  if (nombreDeJours(dateDebut, dateFin) > PERIODE_MAX_JOURS) {
    throw new ErreurMetier(400, `Une demande ne peut pas dépasser ${PERIODE_MAX_JOURS} jours`);
  }
}

async function verifierFenetre(db, { dateDebut, dateFin }, aujourdhui) {
  const [futur, passe] = await Promise.all([parametre(db, 'horizon_futur_mois'), parametre(db, 'conservation_passe_mois')]);
  if (dateFin > ajouterMois(aujourdhui, futur)) {
    throw new ErreurMetier(400, `Une demande ne peut pas porter sur une date située à plus de ${futur} mois`);
  }
  if (dateDebut < ajouterMois(aujourdhui, -passe)) {
    throw new ErreurMetier(400, `Une demande ne peut pas porter sur une date antérieure à ${passe} mois`);
  }
}

async function avertissementsDe(db, { collaborateurId, type, dateDebut, debutDemiJournee, dateFin, finDemiJournee, duree, soi, ignorer }, aujourdhui) {
  const avertissements = [];

  const { rows } = await db.query(
    `SELECT id, date_debut, date_fin, statut FROM demandes_avec_statut
     WHERE collaborateur_id = $1 AND nature = 'absence' AND statut = ANY($2)
       AND (date_debut - DATE '2000-01-01') * 2 + (debut_demi_journee = 'apres_midi')::int <= $4
       AND (date_fin - DATE '2000-01-01') * 2 + (fin_demi_journee = 'apres_midi')::int >= $3
       AND ($5::bigint IS NULL OR id <> $5)
     ORDER BY date_debut, (debut_demi_journee = 'apres_midi')::int, id`,
    [collaborateurId, STATUTS_ACTIFS, numeroDemiJournee(dateDebut, debutDemiJournee), numeroDemiJournee(dateFin, finDemiJournee), ignorer ?? null],
  );
  for (const autre of rows) {
    avertissements.push({
      code: 'chevauchement',
      message: `Cette période chevauche ${soi ? 'votre' : 'une'} demande ${LIBELLE_STATUT[autre.statut]} du ${frDate(autre.date_debut)} au ${frDate(autre.date_fin)}`,
      demandeId: Number(autre.id),
    });
  }

  if (dateDebut < aujourdhui) {
    avertissements.push({
      code: 'date_passee',
      message: dateFin < aujourdhui ? 'Cette période est déjà terminée' : 'Cette période a déjà commencé',
    });
  } else if (type.delai_prevenance_jours !== null) {
    const delai = nombreDeJours(aujourdhui, dateDebut) - 1;
    if (delai < type.delai_prevenance_jours) {
      avertissements.push({
        code: 'delai_prevenance',
        message: `Délai de prévenance non respecté : ${type.delai_prevenance_jours} jours demandés pour « ${type.libelle} », ${delai} jour${delai > 1 ? 's' : ''} avant le début`,
      });
    }
  }

  if (duree === 0) {
    avertissements.push({ code: 'duree_nulle', message: 'Cette période ne contient aucun jour ouvré' });
  }
  return avertissements;
}

// Prépare une demande sans l'enregistrer : durée, avertissements, circuit. Sert à la prévisualisation et à la soumission.
export async function preparerDemande(db, { utilisateur, corps, aujourdhui, pourAnnulation = false, ignorer = null }) {
  const moi = Number(utilisateur.id);
  const collaborateurId = corps.collaborateurId ?? moi;
  const periode = {
    dateDebut: corps.dateDebut,
    debutDemiJournee: corps.debutDemiJournee ?? 'matin',
    dateFin: corps.dateFin,
    finDemiJournee: corps.finDemiJournee ?? 'apres_midi',
  };

  const { rows } = await db.query('SELECT id, equipe_id, actif FROM collaborateurs WHERE id = $1', [collaborateurId]);
  const collaborateur = rows[0];
  if (!collaborateur || !collaborateur.actif) throw new ErreurMetier(400, 'Collaborateur inconnu ou désactivé');
  if (collaborateurId !== moi) {
    const { rowCount } = await db.query('SELECT 1 FROM valideurs_de($1) v WHERE v = $2', [collaborateurId, moi]);
    if (!rowCount) throw new ErreurMetier(403, "Vous ne pouvez pas saisir d'absence pour ce collaborateur");
  }

  const types = await db.query(
    'SELECT id, libelle, approbation_requise, delai_prevenance_jours, actif FROM types_absence WHERE id = $1',
    [corps.typeId],
  );
  const type = types.rows[0];
  // Un type désactivé depuis la demande d'origine ne doit pas empêcher de l'annuler.
  if (!type || (!type.actif && !pourAnnulation)) throw new ErreurMetier(400, "Type d'absence inconnu ou désactivé");

  verifierPeriode(periode);
  // L'annulation d'une absence déjà enregistrée n'est pas soumise à la fenêtre de saisie.
  if (!pourAnnulation) await verifierFenetre(db, periode, aujourdhui);

  const nonTravailles = await joursNonTravailles(db, {
    equipeId: collaborateur.equipe_id, debut: periode.dateDebut, fin: periode.dateFin,
  });
  const duree = calculerDuree({ ...periode, nonTravailles });
  const avertissements = await avertissementsDe(
    db, { collaborateurId, type, ...periode, duree, soi: collaborateurId === moi, ignorer }, aujourdhui,
  );

  // Une demande qui ne pourrait être traitée par personne resterait bloquée : on la refuse dès la saisie.
  const nbValideurs = await nombreDeValideurs(db, collaborateurId);
  const blocage = type.approbation_requise && nbValideurs === 0
    ? "Personne d'autre ne peut valider cette demande : désignez un responsable ou un autre directeur"
    : null;

  // Les personnes prévenues par e-mail : le niveau de validation le plus proche, à défaut les directeurs.
  const proches = await db.query(
    'SELECT c.prenom, c.nom FROM collaborateurs c WHERE c.id IN (SELECT valideurs_proches_de($1))', [collaborateurId]);
  const ordre = new Intl.Collator('fr', { sensitivity: 'base' });
  const valideursProches = proches.rows
    .map((v) => ({ prenom: v.prenom, nom: v.nom }))
    .sort((a, b) => ordre.compare(a.nom, b.nom) || ordre.compare(a.prenom, b.prenom));

  return {
    collaborateur: { id: Number(collaborateurId), equipeId: Number(collaborateur.equipe_id) },
    type: { id: Number(type.id), libelle: type.libelle, approbationRequise: type.approbation_requise },
    periode, duree, avertissements, nbValideurs, valideursProches, blocage,
  };
}

// Enregistre une demande d'absence ou d'annulation et son premier événement, dans une même transaction.
export async function enregistrerDemande(client, { prepare, auteurId, commentaire, nature = 'absence', demandeAnnuleeId = null, remplaceId = null }) {
  const { collaborateur, type, periode, duree, avertissements } = prepare;
  const { rows } = await client.query(
    `INSERT INTO demandes (nature, demande_annulee_id, collaborateur_id, equipe_id, type_id,
                           date_debut, debut_demi_journee, date_fin, fin_demi_journee,
                           duree_demi_journees, commentaire, avertissements, saisie_par_id, remplace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [nature, demandeAnnuleeId, collaborateur.id, collaborateur.equipeId, type.id,
      periode.dateDebut, periode.debutDemiJournee, periode.dateFin, periode.finDemiJournee,
      duree, commentaire?.trim() || null, JSON.stringify(avertissements), auteurId, remplaceId],
  );
  const evenement = await client.query(
    'INSERT INTO evenements_demande (demande_id, type, auteur_id) VALUES ($1, $2, $3) RETURNING id',
    [rows[0].id, type.approbationRequise ? 'soumission' : 'enregistrement', auteurId],
  );
  // Les e-mails sont enregistrés dans la même transaction : pas d'événement sans notification, ni l'inverse.
  await enfiler(client, evenement.rows[0].id);
  return rows[0].id;
}
