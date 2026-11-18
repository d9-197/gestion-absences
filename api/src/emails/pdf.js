import PDFDocument from 'pdfkit';
import { formatDateHeure, formatDuree, formatPeriode, nomComplet } from './format.js';

const DECISIONS = { approbation: 'Approuvée', refus: 'Refusée', enregistrement: 'Enregistrée' };

// Le contenu du récapitulatif, indépendamment de sa mise en page.
export function contenuRecapitulatif(recap, parametres, { fuseau = 'Europe/Paris', exemple = false } = {}) {
  const { demande: d, evenement: ev } = recap;
  const annulation = d.nature === 'annulation';
  const decision = DECISIONS[ev.type];

  const titres = {
    approbation: annulation ? "Demande d'annulation approuvée" : "Demande d'absence approuvée",
    refus: annulation ? "Demande d'annulation refusée" : "Demande d'absence refusée",
    enregistrement: annulation ? 'Annulation enregistrée' : 'Absence enregistrée',
  };

  const demande = [
    ['Collaborateur', nomComplet(d.collaborateur)],
    ['Équipe', d.equipe],
    ["Type d'absence", d.type],
    ['Période', formatPeriode(d)],
    ['Durée', `${formatDuree(d.dureeDemiJournees)} ouvré${d.dureeDemiJournees >= 4 ? 's' : ''}`],
  ];
  if (annulation) demande.push(['Concerne', `Demande d'absence n° ${d.demandeAnnuleeId}`]);
  if (d.remplaceId) demande.push(['Remplace', `Demande n° ${d.remplaceId}, retirée par son auteur`]);
  if (d.commentaire) demande.push(['Commentaire', d.commentaire]);
  if (d.saisiePar.id !== d.collaborateur.id) demande.push(['Saisie par', nomComplet(d.saisiePar)]);
  demande.push(['Soumise le', formatDateHeure(d.soumiseLe, fuseau)]);
  if (d.avertissements.length) {
    demande.push(['Avertissements affichés à la saisie', d.avertissements.map((a) => `- ${a.message}`).join('\n')]);
  }

  const lignesDecision = [['Décision', decision]];
  lignesDecision.push([ev.type === 'enregistrement' ? 'Enregistrée par' : 'Décidée par', nomComplet(ev.auteur)]);
  lignesDecision.push(['Le', formatDateHeure(ev.le, fuseau)]);
  if (ev.type === 'refus' && ev.motif) lignesDecision.push(['Motif du refus', ev.motif]);

  return {
    raisonSociale: parametres.raisonSociale,
    titre: titres[ev.type],
    sousTitre: exemple ? 'Exemple : aucune demande réelle' : `${annulation ? "Demande d'annulation" : 'Demande'} n° ${d.id}`,
    sections: [
      { titre: annulation ? "Demande d'annulation" : 'Demande', lignes: demande },
      { titre: 'Décision', lignes: lignesDecision },
    ],
    mentions: parametres.mentions,
    pied: `Récapitulatif envoyé automatiquement par l'outil de gestion des absences. Référence : demande n° ${d.id}, événement n° ${ev.id}.`,
  };
}

const GRIS = '#555555';
const NOIR = '#111111';
const LARGEUR_ETIQUETTE = 160;

// Met en page le contenu en un PDF A4. `compresser: false` sert aux tests, pour relire le texte.
export function genererPdf(contenu, { dateCreation = new Date(), compresser = true } = {}) {
  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      compress: compresser,
      info: {
        Title: `${contenu.titre} - ${contenu.sousTitre}`,
        Author: contenu.raisonSociale || 'Gestion des absences',
        Creator: 'Gestion des absences',
        CreationDate: dateCreation,
      },
    });
    const morceaux = [];
    doc.on('data', (morceau) => morceaux.push(morceau));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    const gauche = doc.page.margins.left;
    const largeur = doc.page.width - gauche - doc.page.margins.right;
    const bas = () => doc.page.height - doc.page.margins.bottom;

    if (contenu.raisonSociale) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(contenu.raisonSociale, gauche, doc.y, { width: largeur });
      doc.moveDown(0.4);
    }
    doc.moveTo(gauche, doc.y).lineTo(gauche + largeur, doc.y).lineWidth(0.5).strokeColor('#999999').stroke();
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(20).fillColor(NOIR).text(contenu.titre, gauche, doc.y, { width: largeur });
    doc.font('Helvetica').fontSize(11).fillColor(GRIS).text(contenu.sousTitre, gauche, doc.y, { width: largeur });
    doc.moveDown(1.2);

    for (const section of contenu.sections) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(NOIR).text(section.titre, gauche, doc.y, { width: largeur });
      doc.moveDown(0.5);
      for (const [etiquette, valeur] of section.lignes) {
        doc.font('Helvetica').fontSize(10);
        const hauteurEtiquette = doc.heightOfString(etiquette, { width: LARGEUR_ETIQUETTE });
        doc.font('Helvetica-Bold');
        const hauteurValeur = doc.heightOfString(valeur, { width: largeur - LARGEUR_ETIQUETTE });
        if (doc.y + Math.max(hauteurEtiquette, hauteurValeur) > bas()) doc.addPage();
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(etiquette, gauche, y, { width: LARGEUR_ETIQUETTE - 10 });
        doc.font('Helvetica-Bold').fillColor(NOIR).text(valeur, gauche + LARGEUR_ETIQUETTE, y, { width: largeur - LARGEUR_ETIQUETTE });
        doc.y = y + Math.max(hauteurEtiquette, hauteurValeur) + 7;
      }
      doc.moveDown(0.8);
    }

    if (contenu.mentions) {
      doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(contenu.mentions, gauche, doc.y, { width: largeur });
      doc.moveDown(1);
    }
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(contenu.pied, gauche, doc.y, { width: largeur });
    doc.end();
  });
}
