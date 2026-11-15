// Erreur attendue, à renvoyer telle quelle au client (règle de gestion non respectée, élément introuvable…).
export class ErreurMetier extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

export const introuvable = (quoi) => new ErreurMetier(404, `${quoi} introuvable`);

const DOUBLONS = {
  equipes_nom_unique: 'Une équipe porte déjà ce nom',
  collaborateurs_email_unique: 'Un collaborateur a déjà cette adresse e-mail',
  types_absence_libelle_unique: "Un type d'absence porte déjà ce libellé",
};

// Traduit les erreurs en réponses JSON homogènes : { erreur: "message" }.
export function gestionnaireErreurs(erreur, requete, reponse) {
  if (erreur instanceof ErreurMetier) return reponse.code(erreur.statut).send({ erreur: erreur.message });
  if (erreur.validation) return reponse.code(400).send({ erreur: 'Données invalides', detail: erreur.message });
  // Contraintes de la base : doublon, élément encore référencé, règle vérifiée par un déclencheur.
  if (erreur.code === '23505') {
    return reponse.code(409).send({ erreur: DOUBLONS[erreur.constraint] ?? 'Cette valeur existe déjà' });
  }
  if (erreur.code === '23503') {
    return reponse.code(409).send({ erreur: 'Cet élément est encore utilisé et ne peut pas être supprimé' });
  }
  if (erreur.code === '23514') return reponse.code(409).send({ erreur: erreur.message });
  if (erreur.statusCode && erreur.statusCode < 500) {
    return reponse.code(erreur.statusCode).send({ erreur: erreur.message });
  }
  requete.log.error(erreur);
  return reponse.code(500).send({ erreur: 'Erreur interne' });
}
