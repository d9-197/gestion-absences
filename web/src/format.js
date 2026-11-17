// Mise en forme des dates, durées et statuts, partagée par les pages de demandes.

const JOUR_COURT = { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };

export const jourCourt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', JOUR_COURT);

export function formatPeriode(d) {
  const debut = d.debutDemiJournee;
  const fin = d.finDemiJournee;
  if (d.dateDebut === d.dateFin) {
    const precision = debut === fin ? (debut === 'matin' ? ' (matin)' : ' (après-midi)') : '';
    return `${jourCourt(d.dateDebut)}${precision}`;
  }
  return `${jourCourt(d.dateDebut)}${debut === 'apres_midi' ? ' (après-midi)' : ''} → ${jourCourt(d.dateFin)}${fin === 'matin' ? ' (matin)' : ''}`;
}

export function formatDuree(demiJournees) {
  const jours = demiJournees / 2;
  return `${jours.toLocaleString('fr-FR')} jour${jours >= 2 ? 's' : ''}`;
}

export const formatDateHeure = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

export const nomComplet = (personne) => `${personne.prenom} ${personne.nom}`;

export const STATUTS = {
  en_attente: 'En attente',
  approuvee: 'Approuvée',
  refusee: 'Refusée',
  enregistree: 'Enregistrée',
  retiree: 'Retirée',
  annulee: 'Annulée',
};

export const EVENEMENTS = {
  soumission: 'Demande soumise',
  enregistrement: 'Absence enregistrée',
  approbation: 'Demande approuvée',
  refus: 'Demande refusée',
  retrait: 'Demande retirée',
  annulation: 'Absence annulée',
};
