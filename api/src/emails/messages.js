import { formatDateHeure, formatDuree, formatPeriode, formatPeriodeCourte, nomComplet } from './format.js';

const VERBES = { approbation: 'approuvée', refus: 'refusée', enregistrement: 'enregistrée' };

export function sujetPour(modele, recap) {
  const { demande: d, evenement: ev } = recap;
  const annulation = d.nature === 'annulation';
  const detail = `${nomComplet(d.collaborateur)} - ${d.type}, ${formatPeriodeCourte(d)}`;
  if (modele === 'a_traiter') return `${annulation ? 'Annulation' : 'Demande'} à traiter : ${detail}`;
  const nom = annulation ? 'Annulation' : (modele === 'declaration' ? 'Absence' : 'Demande');
  return `${nom} ${VERBES[ev.type]} : ${detail}`;
}

// Texte brut de l'e-mail. `avecPdf` annonce la pièce jointe.
export function textePour(modele, recap, { appUrl, fuseau, avecPdf, raisonSociale }) {
  const { demande: d, evenement: ev } = recap;
  const annulation = d.nature === 'annulation';
  const lignes = ['Bonjour,', ''];

  const resume = [
    `  Collaborateur : ${nomComplet(d.collaborateur)} (${d.equipe})`,
    `  Type : ${d.type}`,
    `  Période : ${formatPeriode(d)}`,
    `  Durée : ${formatDuree(d.dureeDemiJournees)}`,
  ];
  if (d.commentaire) resume.push(`  Commentaire : ${d.commentaire}`);
  if (d.saisiePar.id !== d.collaborateur.id) resume.push(`  Saisie par : ${nomComplet(d.saisiePar)}`);

  if (modele === 'a_traiter') {
    lignes.push(annulation
      ? `${nomComplet(d.collaborateur)} demande l'annulation d'une absence (demande n° ${d.demandeAnnuleeId}) :`
      : `${nomComplet(d.collaborateur)} a demandé une absence qui attend votre décision :`,
    '', ...resume);
    if (d.avertissements.length) {
      lignes.push('', "Avertissements affichés à la saisie :", ...d.avertissements.map((a) => `  - ${a.message}`));
    }
    if (d.remplaceId) lignes.push('', `Cette demande remplace la demande n° ${d.remplaceId}, retirée par son auteur.`);
    lignes.push('', `Pour la traiter : ${appUrl}/a-traiter`);
  } else {
    const quand = formatDateHeure(ev.le, fuseau);
    if (modele === 'declaration') {
      lignes.push(annulation
        ? `L'annulation de l'absence de ${nomComplet(d.collaborateur)} (demande n° ${d.demandeAnnuleeId}) a été enregistrée par ${nomComplet(ev.auteur)} le ${quand}, sans validation :`
        : `L'absence de ${nomComplet(d.collaborateur)} a été enregistrée par ${nomComplet(ev.auteur)} le ${quand}, sans validation :`);
    } else {
      lignes.push(`La demande ${annulation ? "d'annulation" : "d'absence"} de ${nomComplet(d.collaborateur)} a été ${VERBES[ev.type]} par ${nomComplet(ev.auteur)} le ${quand} :`);
    }
    lignes.push('', ...resume);
    if (ev.type === 'refus' && ev.motif) lignes.push(`  Motif du refus : ${ev.motif}`);
    if (avecPdf) {
      lignes.push('', 'Le récapitulatif de cette décision est joint à ce message (PDF). Conservez-le : il constitue la copie de référence, hors de l\'outil.');
    }
  }

  lignes.push('', '--', raisonSociale || 'Gestion des absences', 'Message automatique, merci de ne pas y répondre.');
  return lignes.join('\n');
}
