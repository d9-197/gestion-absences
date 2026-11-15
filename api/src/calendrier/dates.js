// Calculs de dates sur des chaînes « AAAA-MM-JJ », toujours en UTC pour ne dépendre d'aucun fuseau.

const versDate = (iso) => new Date(`${iso}T00:00:00Z`);
const versIso = (date) => date.toISOString().slice(0, 10);

export const estDateValide = (iso) =>
  typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(versDate(iso).getTime())
  && versIso(versDate(iso)) === iso;

export function ajouterJours(iso, nombre) {
  const date = versDate(iso);
  date.setUTCDate(date.getUTCDate() + nombre);
  return versIso(date);
}

export const annee = (iso) => Number(iso.slice(0, 4));
export const nombreDeJours = (debut, fin) => Math.round((versDate(fin) - versDate(debut)) / 86400000) + 1;

// 0 = dimanche … 6 = samedi.
export const jourSemaine = (iso) => versDate(iso).getUTCDay();
export const estWeekEnd = (iso) => [0, 6].includes(jourSemaine(iso));

// Dimanche de Pâques (calendrier grégorien, algorithme de Meeus-Jones-Butcher).
export function paques(an) {
  const a = an % 19;
  const b = Math.floor(an / 100);
  const c = an % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${an}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

// Les onze jours fériés légaux de France métropolitaine (hors Alsace-Moselle), dans l'ordre de l'année.
export function joursFeriesFrancais(an) {
  const dimancheDePaques = paques(an);
  return [
    { jour: `${an}-01-01`, libelle: "Jour de l'An" },
    { jour: ajouterJours(dimancheDePaques, 1), libelle: 'Lundi de Pâques' },
    { jour: `${an}-05-01`, libelle: 'Fête du Travail' },
    { jour: `${an}-05-08`, libelle: 'Victoire 1945' },
    { jour: ajouterJours(dimancheDePaques, 39), libelle: 'Ascension' },
    { jour: ajouterJours(dimancheDePaques, 50), libelle: 'Lundi de Pentecôte' },
    { jour: `${an}-07-14`, libelle: 'Fête nationale' },
    { jour: `${an}-08-15`, libelle: 'Assomption' },
    { jour: `${an}-11-01`, libelle: 'Toussaint' },
    { jour: `${an}-11-11`, libelle: 'Armistice 1918' },
    { jour: `${an}-12-25`, libelle: 'Noël' },
  ].sort((x, y) => x.jour.localeCompare(y.jour));
}

// Durée d'une absence en demi-journées ouvrées.
// Ne compte ni les week-ends ni les jours de l'ensemble « nonTravailles » (fériés et jours imposés).
// La demi-journée de début ou de fin ne retire une demi-journée que si ce jour-là est travaillé.
export function calculerDuree({ dateDebut, debutDemiJournee = 'matin', dateFin, finDemiJournee = 'apres_midi', nonTravailles = new Set() }) {
  let demiJournees = 0;
  for (let jour = dateDebut; jour <= dateFin; jour = ajouterJours(jour, 1)) {
    if (estWeekEnd(jour) || nonTravailles.has(jour)) continue;
    demiJournees += 2;
    if (jour === dateDebut && debutDemiJournee === 'apres_midi') demiJournees -= 1;
    if (jour === dateFin && finDemiJournee === 'matin') demiJournees -= 1;
  }
  return demiJournees;
}
