import { ErreurMetier, introuvable } from '../erreurs.js';
import { chargerParametresPdf } from '../emails/donnees.js';
import { contenuRecapitulatif, genererPdf } from '../emails/pdf.js';
import { parametresId } from './outils.js';

const envoiVersJson = (e) => ({
  id: Number(e.id),
  demandeId: e.demande_id === null ? null : Number(e.demande_id),
  destinataire: e.destinataire,
  sujet: e.sujet,
  avecPdf: e.avec_pdf,
  statut: e.statut,
  tentatives: e.tentatives,
  derniereErreur: e.derniere_erreur,
  creeLe: e.cree_le,
  envoyeLe: e.envoye_le,
  prochaineTentative: e.prochaine_tentative,
});

// Exemple fictif, pour voir l'effet des mentions sur le PDF sans attendre une vraie décision.
function recapitulatifExemple(fuseau) {
  const maintenant = new Date();
  const dans = (jours) => new Date(maintenant.getTime() + jours * 86400000).toISOString().slice(0, 10);
  return {
    evenement: { id: 0, type: 'approbation', motif: null, le: maintenant, auteur: { id: 0, prenom: 'Camille', nom: 'Responsable' } },
    demande: {
      id: 0, nature: 'absence', demandeAnnuleeId: null,
      dateDebut: dans(14), debutDemiJournee: 'matin', dateFin: dans(18), finDemiJournee: 'apres_midi',
      dureeDemiJournees: 10, commentaire: 'Exemple de commentaire', avertissements: [],
      soumiseLe: new Date(maintenant.getTime() - 3600000),
      collaborateur: { id: 1, prenom: 'Prénom', nom: 'Nom' }, equipe: 'Équipe', type: 'Congés payés',
      saisiePar: { id: 1, prenom: 'Prénom', nom: 'Nom' },
    },
    fuseau,
  };
}

export async function routesAdminEmails(app, { pool, config }) {
  // --- Mentions du PDF -------------------------------------------------------

  app.get('/parametres-pdf', async () => chargerParametresPdf(pool));

  app.put('/parametres-pdf', {
    schema: {
      body: {
        type: 'object', required: ['raisonSociale', 'mentions'], additionalProperties: false,
        properties: { raisonSociale: { type: 'string', maxLength: 150 }, mentions: { type: 'string', maxLength: 2000 } },
      },
    },
  }, async (requete) => {
    const valeurs = { pdf_raison_sociale: requete.body.raisonSociale.trim(), pdf_mentions: requete.body.mentions.trim() };
    for (const [cle, valeur] of Object.entries(valeurs)) {
      await pool.query(
        `INSERT INTO parametres (cle, valeur) VALUES ($1, $2::jsonb)
         ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, modifie_le = now()`,
        [cle, JSON.stringify(valeur)],
      );
    }
    return chargerParametresPdf(pool);
  });

  app.get('/parametres-pdf/apercu', async (_requete, reponse) => {
    const fuseau = config.fuseau ?? 'Europe/Paris';
    const recap = recapitulatifExemple(fuseau);
    const contenu = contenuRecapitulatif(recap, await chargerParametresPdf(pool), { fuseau, exemple: true });
    return reponse
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'inline; filename="exemple-recapitulatif.pdf"')
      .header('Cache-Control', 'no-store')
      .send(await genererPdf(contenu));
  });

  // --- Suivi des envois ------------------------------------------------------

  app.get('/envois-email', {
    schema: { querystring: { type: 'object', properties: { statut: { enum: ['echec', 'en_attente', 'envoye'] } } } },
  }, async (requete) => {
    const { rows } = await pool.query(
      `SELECT id, demande_id, destinataire, sujet, avec_pdf, statut, tentatives, derniere_erreur, cree_le, envoye_le, prochaine_tentative
       FROM envois_email WHERE statut = $1 ORDER BY id DESC LIMIT 200`,
      [requete.query.statut ?? 'echec'],
    );
    return rows.map(envoiVersJson);
  });

  app.get('/envois-email/compteur', async () => {
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE statut = 'echec')::int AS echecs,
              count(*) FILTER (WHERE statut = 'en_attente')::int AS en_attente
       FROM envois_email`,
    );
    return { echecs: rows[0].echecs, enAttente: rows[0].en_attente };
  });

  // Remet en file les envois définitivement en échec (la cause de la panne est supposée réparée).
  app.post('/envois-email/relancer', async () => {
    const { rowCount } = await pool.query(
      `UPDATE envois_email SET statut = 'en_attente', tentatives = 0, prochaine_tentative = now()
       WHERE statut = 'echec'`,
    );
    app.fileEmails.reveiller();
    return { relances: rowCount };
  });

  app.post('/envois-email/:id/relancer', { schema: { params: parametresId } }, async (requete, reponse) => {
    const { rows } = await pool.query(
      `UPDATE envois_email SET statut = 'en_attente', tentatives = 0, prochaine_tentative = now()
       WHERE id = $1 AND statut = 'echec' RETURNING id`,
      [requete.params.id],
    );
    if (!rows.length) {
      const existe = await pool.query('SELECT 1 FROM envois_email WHERE id = $1', [requete.params.id]);
      if (!existe.rowCount) throw introuvable('Envoi');
      throw new ErreurMetier(409, "Seul un envoi en échec peut être relancé");
    }
    app.fileEmails.reveiller();
    return reponse.code(204).send();
  });
}
