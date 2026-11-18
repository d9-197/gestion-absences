// Lecture de ce qu'il faut pour écrire un e-mail ou un PDF : un événement du journal, la demande, les personnes.
// Tout vient du journal, qui ne change jamais : un envoi relancé plus tard produit le même contenu.

const personne = (id, prenom, nom) => ({ id: Number(id), prenom, nom });

export async function chargerRecapitulatif(db, evenementId) {
  const { rows } = await db.query(
    `SELECT ev.id AS evenement_id, ev.type AS evenement_type, ev.motif, ev.cree_le AS evenement_le,
            au.id AS auteur_id, au.prenom AS auteur_prenom, au.nom AS auteur_nom,
            d.id, d.nature, d.demande_annulee_id, d.remplace_id, d.date_debut, d.debut_demi_journee, d.date_fin, d.fin_demi_journee,
            d.duree_demi_journees, d.commentaire, d.avertissements, d.soumise_le,
            c.id AS collaborateur_id, c.prenom AS collaborateur_prenom, c.nom AS collaborateur_nom,
            e.nom AS equipe_nom, t.libelle AS type_libelle,
            s.id AS saisie_id, s.prenom AS saisie_prenom, s.nom AS saisie_nom
     FROM evenements_demande ev
       JOIN demandes d ON d.id = ev.demande_id
       JOIN collaborateurs au ON au.id = ev.auteur_id
       JOIN collaborateurs c ON c.id = d.collaborateur_id
       JOIN equipes e ON e.id = d.equipe_id
       JOIN types_absence t ON t.id = d.type_id
       JOIN collaborateurs s ON s.id = d.saisie_par_id
     WHERE ev.id = $1`,
    [evenementId],
  );
  const r = rows[0];
  if (!r) throw new Error(`Événement ${evenementId} introuvable`);
  return {
    evenement: {
      id: Number(r.evenement_id), type: r.evenement_type, motif: r.motif, le: r.evenement_le,
      auteur: personne(r.auteur_id, r.auteur_prenom, r.auteur_nom),
    },
    demande: {
      id: Number(r.id),
      nature: r.nature,
      demandeAnnuleeId: r.demande_annulee_id === null ? null : Number(r.demande_annulee_id),
      remplaceId: r.remplace_id === null ? null : Number(r.remplace_id),
      dateDebut: r.date_debut, debutDemiJournee: r.debut_demi_journee,
      dateFin: r.date_fin, finDemiJournee: r.fin_demi_journee,
      dureeDemiJournees: r.duree_demi_journees,
      commentaire: r.commentaire,
      avertissements: r.avertissements,
      soumiseLe: r.soumise_le,
      collaborateur: personne(r.collaborateur_id, r.collaborateur_prenom, r.collaborateur_nom),
      equipe: r.equipe_nom,
      type: r.type_libelle,
      saisiePar: personne(r.saisie_id, r.saisie_prenom, r.saisie_nom),
    },
  };
}

// Mentions du PDF réglées par les directeurs.
export async function chargerParametresPdf(db) {
  const { rows } = await db.query(`SELECT cle, valeur FROM parametres WHERE cle IN ('pdf_raison_sociale', 'pdf_mentions')`);
  const valeur = (cle) => {
    const ligne = rows.find((l) => l.cle === cle);
    return typeof ligne?.valeur === 'string' ? ligne.valeur : '';
  };
  return { raisonSociale: valeur('pdf_raison_sociale'), mentions: valeur('pdf_mentions') };
}
