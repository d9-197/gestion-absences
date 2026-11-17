// Calculs de dates sur des chaînes « AAAA-MM-JJ », en UTC pour ne dépendre d'aucun fuseau.

const deux = (n) => String(n).padStart(2, '0');

// Date du jour dans le fuseau de l'entreprise, comme le fait le serveur.
export const aujourdhui = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());

export const moisCourant = () => {
  const [annee, mois] = aujourdhui().split('-').map(Number);
  return { annee, mois: mois - 1 };
};

// Tous les jours d'un mois (mois de 0 à 11).
export function joursDuMois(annee, mois) {
  const nombre = new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
  return Array.from({ length: nombre }, (_, i) => `${annee}-${deux(mois + 1)}-${deux(i + 1)}`);
}

export const moisSuivant = ({ annee, mois }, pas) => {
  const total = annee * 12 + mois + pas;
  return { annee: Math.floor(total / 12), mois: total % 12 };
};

export const libelleMois = ({ annee, mois }) =>
  new Date(Date.UTC(annee, mois, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// 0 = dimanche … 6 = samedi.
export const jourSemaine = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const estWeekEnd = (iso) => [0, 6].includes(jourSemaine(iso));
export const initialeJour = (iso) => ['D', 'L', 'M', 'M', 'J', 'V', 'S'][jourSemaine(iso)];

// Numéro d'une demi-journée, pour comparer des périodes : deux numéros par jour.
export const numeroDemiJournee = (iso, demiJournee) =>
  Math.round((new Date(`${iso}T00:00:00Z`) - new Date('2000-01-01T00:00:00Z')) / 86400000) * 2 + (demiJournee === 'apres_midi' ? 1 : 0);
