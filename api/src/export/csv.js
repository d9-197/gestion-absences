import { COLONNES } from './service.js';

// Une cellule de texte qui commence par l'un de ces caractères serait interprétée comme une formule par un tableur.
const FORMULE = /^[=+\-@\t\r]/;

function champ(valeur) {
  if (valeur === null || valeur === undefined) return '';
  let texte = String(valeur);
  if (typeof valeur === 'string' && FORMULE.test(texte)) texte = `'${texte}`;
  return /[;"\r\n]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte;
}

// CSV pour Excel en français : séparateur « ; », UTF-8 avec marque d'ordre des octets, fins de ligne CRLF.
// Les dates sont au format AAAA-MM-JJ, que tout tableur reconnaît quelle que soit sa langue.
export function versCsv(lignes) {
  const entetes = COLONNES.map((c) => c.titre);
  return `﻿${[entetes, ...lignes].map((ligne) => ligne.map(champ).join(';')).join('\r\n')}\r\n`;
}
