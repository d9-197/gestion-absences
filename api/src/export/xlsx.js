import writeExcelFile from 'write-excel-file/node';
import { COLONNES } from './service.js';

// « 2026-12-14 » ou « 2026-11-17 21:45 » -> date d'Excel, sans fuseau : l'heure affichée est celle de l'entreprise.
// Excel stocke une heure comme une fraction de jour : une imprécision d'une milliseconde en dessous suffirait à
// afficher la minute précédente dans certains tableurs. Une demi-seconde d'avance, invisible, l'évite.
function versDate(texte) {
  const [jour, heure] = texte.split(' ');
  const [an, mois, j] = jour.split('-').map(Number);
  const [h, m] = (heure ?? '00:00').split(':').map(Number);
  return new Date(Date.UTC(an, mois - 1, j, h, m, 0, heure ? 500 : 0));
}

function cellule(valeur, colonne) {
  if (valeur === null || valeur === undefined) return null;
  switch (colonne.type) {
    case 'nombre': return { value: valeur, type: Number };
    case 'date': return { value: versDate(valeur), type: Date, format: 'dd/mm/yyyy' };
    case 'datetime': return { value: versDate(valeur), type: Date, format: 'dd/mm/yyyy hh:mm' };
    // Un texte reste un texte : Excel n'évalue jamais comme formule une cellule de ce type.
    default: return { value: valeur, type: String };
  }
}

export function versXlsx(lignes) {
  const entetes = COLONNES.map((c) => ({ value: c.titre, fontWeight: 'bold', backgroundColor: '#e6eefb' }));
  const donnees = [entetes, ...lignes.map((ligne) => ligne.map((valeur, i) => cellule(valeur, COLONNES[i])))];
  return writeExcelFile(donnees, {
    sheet: 'Absences',
    columns: COLONNES.map((c) => ({ width: c.largeur })),
    stickyRowsCount: 1,
  }).toBuffer();
}
