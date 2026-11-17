import { chargerParametresPdf, chargerRecapitulatif } from './donnees.js';
import { contenuRecapitulatif, genererPdf } from './pdf.js';
import { sujetPour, textePour } from './messages.js';

const TENTATIVES_MAX = 3;
const DELAIS_MINUTES = [1, 5]; // attente après la 1re et la 2e tentative en échec
const SECURITE_BOUCLE = 500;

const NOM_PIECE = { approbation: 'approuvee', refus: 'refusee', enregistrement: 'enregistree' };

async function personnes(db, requete, valeurs) {
  const { rows } = await db.query(requete, valeurs);
  return rows;
}

// Enregistre, dans la transaction en cours, les e-mails que provoque un événement du journal.
// Qui reçoit quoi :
//   soumission      -> valideurs les plus proches : « à traiter », sans PDF
//   enregistrement  -> idem « enregistrée » sans PDF ; PDF au collaborateur et aux directeurs
//   approbation ou refus -> PDF au collaborateur, à la personne qui a décidé et aux directeurs
//   retrait, annulation (de l'absence d'origine) -> aucun e-mail
export async function enfiler(client, evenementId) {
  const recap = await chargerRecapitulatif(client, evenementId);
  const { demande: d, evenement: ev } = recap;
  if (!['soumission', 'enregistrement', 'approbation', 'refus'].includes(ev.type)) return 0;

  const destinataires = new Map(); // id -> { email, pdf }
  const ajouter = (rows, pdf) => {
    for (const p of rows) destinataires.set(Number(p.id), { email: p.email, pdf: pdf || destinataires.get(Number(p.id))?.pdf || false });
  };
  const proches = () => personnes(client,
    'SELECT c.id, c.email FROM collaborateurs c WHERE c.id IN (SELECT valideurs_proches_de($1))', [d.collaborateur.id]);
  const directeurs = () => personnes(client, `SELECT id, email FROM collaborateurs WHERE actif AND role = 'directeur'`, []);
  const parIds = (ids) => personnes(client, 'SELECT id, email FROM collaborateurs WHERE actif AND id = ANY($1)', [ids]);

  let modele;
  if (ev.type === 'soumission') {
    modele = 'a_traiter';
    ajouter(await proches(), false);
  } else if (ev.type === 'enregistrement') {
    modele = 'declaration';
    ajouter(await proches(), false);
    ajouter(await parIds([d.collaborateur.id]), true);
    ajouter(await directeurs(), true);
  } else {
    modele = 'decision';
    ajouter(await parIds([d.collaborateur.id, ev.auteur.id]), true);
    ajouter(await directeurs(), true);
  }

  const sujet = sujetPour(modele, recap);
  let enfilees = 0;
  for (const { email, pdf } of destinataires.values()) {
    const { rowCount } = await client.query(
      `INSERT INTO envois_email (demande_id, evenement_id, destinataire, sujet, avec_pdf, modele)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [d.id, ev.id, email, sujet, pdf, modele],
    );
    enfilees += rowCount;
  }
  return enfilees;
}

// Le message complet d'un envoi enregistré : texte, et PDF le cas échéant.
async function construireMessage(db, envoi, { appUrl, fuseau }) {
  const recap = await chargerRecapitulatif(db, envoi.evenement_id);
  const parametres = await chargerParametresPdf(db);
  const message = {
    a: envoi.destinataire,
    sujet: envoi.sujet,
    texte: textePour(envoi.modele, recap, { appUrl, fuseau, avecPdf: envoi.avec_pdf, raisonSociale: parametres.raisonSociale }),
  };
  if (envoi.avec_pdf) {
    const contenu = contenuRecapitulatif(recap, parametres, { fuseau });
    message.pieces = [{
      filename: `demande-${recap.demande.id}-${NOM_PIECE[recap.evenement.type]}.pdf`,
      content: await genererPdf(contenu, { dateCreation: new Date(recap.evenement.le) }),
      contentType: 'application/pdf',
    }];
  }
  return message;
}

// Envoie les e-mails en attente, un par un. Chacun a sa propre transaction : un échec n'en bloque pas un autre.
export async function traiterFile({ pool, courriel, config, log }) {
  const bilan = { envoyes: 0, echecs: 0 };
  for (let i = 0; i < SECURITE_BOUCLE; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM envois_email WHERE statut = 'en_attente' AND prochaine_tentative <= now()
         ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!rows.length) {
        await client.query('ROLLBACK');
        return bilan;
      }
      const envoi = rows[0];
      try {
        await courriel.envoyer(await construireMessage(client, envoi, { appUrl: config.appUrl, fuseau: config.fuseau ?? 'Europe/Paris' }));
        await client.query(
          `UPDATE envois_email SET statut = 'envoye', tentatives = tentatives + 1, envoye_le = now(), derniere_erreur = NULL WHERE id = $1`,
          [envoi.id],
        );
        bilan.envoyes++;
      } catch (erreur) {
        const tentatives = envoi.tentatives + 1;
        const definitif = tentatives >= TENTATIVES_MAX;
        await client.query(
          `UPDATE envois_email
           SET tentatives = $2, statut = $3, derniere_erreur = $4, prochaine_tentative = now() + make_interval(mins => $5)
           WHERE id = $1`,
          [envoi.id, tentatives, definitif ? 'echec' : 'en_attente', String(erreur.message).slice(0, 500), DELAIS_MINUTES[tentatives - 1] ?? 0],
        );
        log?.warn({ envoi: Number(envoi.id), destinataire: envoi.destinataire, tentatives, definitif }, `e-mail non envoyé : ${erreur.message}`);
        bilan.echecs++;
      }
      await client.query('COMMIT');
    } catch (erreur) {
      await client.query('ROLLBACK').catch(() => {});
      throw erreur;
    } finally {
      client.release();
    }
  }
  return bilan;
}

// La file d'un processus : envoi immédiat après chaque événement, plus un passage régulier pour les nouvelles tentatives.
export function creerFileEmails({ pool, courriel, config, log }) {
  let minuteur = null;
  let enCours = null;

  const traiter = () => {
    // Un seul passage à la fois dans ce processus ; les autres processus sont départagés par la base.
    enCours ??= traiterFile({ pool, courriel, config, log }).finally(() => { enCours = null; });
    return enCours;
  };

  return {
    traiter,
    get automatique() { return minuteur !== null; },
    // À appeler après la validation d'une transaction qui a enfilé des e-mails.
    reveiller() {
      if (minuteur) setImmediate(() => traiter().catch((erreur) => log?.error(erreur, "traitement de la file d'e-mails")));
    },
    demarrer(intervalleMs = 15000) {
      if (minuteur) return;
      minuteur = setInterval(() => traiter().catch((erreur) => log?.error(erreur, "traitement de la file d'e-mails")), intervalleMs);
      minuteur.unref();
      this.reveiller();
    },
    async arreter() {
      if (minuteur) clearInterval(minuteur);
      minuteur = null;
      await enCours?.catch(() => {});
    },
  };
}
