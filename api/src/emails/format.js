// Mise en forme en français des dates, périodes et durées, pour les e-mails et le PDF.

const jourLong = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
const jourNumerique = (iso) => iso.split('-').reverse().join('/');

// « lundi 14 décembre 2026 » ou « du lundi 14 décembre 2026 (après-midi) au vendredi 18 décembre 2026 ».
export function formatPeriode({ dateDebut, debutDemiJournee, dateFin, finDemiJournee }) {
  if (dateDebut === dateFin) {
    const precision = debutDemiJournee === finDemiJournee ? (debutDemiJournee === 'matin' ? ' (matin)' : ' (après-midi)') : '';
    return `${jourLong(dateDebut)}${precision}`;
  }
  return `du ${jourLong(dateDebut)}${debutDemiJournee === 'apres_midi' ? ' (après-midi)' : ''}`
    + ` au ${jourLong(dateFin)}${finDemiJournee === 'matin' ? ' (matin)' : ''}`;
}

// Version courte pour un objet d'e-mail : « 14/12/2026 » ou « 14/12/2026 au 18/12/2026 ».
export const formatPeriodeCourte = ({ dateDebut, dateFin }) =>
  (dateDebut === dateFin ? jourNumerique(dateDebut) : `${jourNumerique(dateDebut)} au ${jourNumerique(dateFin)}`);

export function formatDuree(demiJournees) {
  const jours = demiJournees / 2;
  return `${jours.toLocaleString('fr-FR')} jour${jours >= 2 ? 's' : ''}`;
}

// « 17/11/2026 à 21:00 », dans le fuseau de l'entreprise.
export function formatDateHeure(valeur, fuseau = 'Europe/Paris') {
  const date = new Date(valeur);
  const jour = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: fuseau });
  const heure = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau });
  return `${jour} à ${heure}`;
}

export const nomComplet = (personne) => `${personne.prenom} ${personne.nom}`;
