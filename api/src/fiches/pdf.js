import PDFDocument from 'pdfkit';
import { ajouterJours, jourSemaine } from '../calendrier/dates.js';
import { formatDateHeure } from '../emails/format.js';

const COULEURS = ['#2b6cb0', '#c05621', '#2f855a', '#6b46c1', '#0f766e', '#b83280', '#8a5a00', '#5b7a00'];
const NOIR = '#111111';
const GRIS = '#555555';
const NOMS_JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.', 'Dim.'];
const MARGE = 40;

export const libelleMois = (mois) =>
  new Date(`${mois}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const titreFiche = (mois) => `Fiche RH salarié du mois de ${libelleMois(mois)}`;
const nombre = (n) => n.toLocaleString('fr-FR');

// Un code court par type d'absence : les initiales des mots, ou les trois premières lettres, sans doublon.
export function codesDesTypes(types) {
  const codes = new Map();
  const pris = new Set();
  for (const t of types) {
    const mots = t.libelle.normalize('NFD').replace(/\p{M}/gu, '').split(/[\s'-]+/).filter((m) => /^[A-Za-z]/.test(m));
    let code = (mots.length > 1 ? mots.map((m) => m[0]).join('').slice(0, 3) : (mots[0] ?? 'ABS').slice(0, 3)).toUpperCase();
    for (let i = 2; pris.has(code); i++) code = `${code.slice(0, 2)}${i}`;
    pris.add(code);
    codes.set(t.id, code);
  }
  return codes;
}

function dessinerFiche(doc, fiche, { raisonSociale, editeePar, fuseau, maintenant }) {
  const gauche = MARGE;
  const largeur = doc.page.width - 2 * MARGE;
  const codes = codesDesTypes(fiche.types);
  const indiceType = new Map(fiche.types.map((t, i) => [t.id, i]));
  const couleur = (typeId) => COULEURS[indiceType.get(typeId) % COULEURS.length];

  doc.y = MARGE;
  if (raisonSociale) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NOIR).text(raisonSociale, gauche, doc.y, { width: largeur });
    doc.moveDown(0.3);
  }
  doc.font('Helvetica-Bold').fontSize(17).fillColor(NOIR).text(titreFiche(fiche.mois), gauche, doc.y, { width: largeur });
  doc.font('Helvetica-Bold').fontSize(17).fillColor(NOIR).text(`${fiche.collaborateur.prenom} ${fiche.collaborateur.nom}`, gauche, doc.y, { width: largeur });
  doc.font('Helvetica').fontSize(11).fillColor(GRIS)
    .text(`Équipe ${fiche.collaborateur.equipe}${fiche.figee ? ` - fiche clôturée le ${formatDateHeure(fiche.figee.le, fuseau)} par ${fiche.figee.par}` : ''}`, gauche, doc.y, { width: largeur });
  doc.moveDown(0.8);

  // --- Calendrier du mois : une case par jour, la moitié gauche pour le matin, la droite pour l'après-midi.
  const cw = largeur / 7;
  const ch = 46;
  let y = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS);
  NOMS_JOURS.forEach((nom, i) => doc.text(nom, gauche + i * cw, y, { width: cw, align: 'center' }));
  y += 12;
  const premier = fiche.jours[0].jour;
  const decalage = (jourSemaine(premier) + 6) % 7; // lundi = 0
  let jour = ajouterJours(premier, -decalage);
  const parJour = new Map(fiche.jours.map((j) => [j.jour, j]));
  const nbSemaines = Math.ceil((decalage + fiche.jours.length) / 7);
  for (let s = 0; s < nbSemaines; s++) {
    for (let c = 0; c < 7; c++, jour = ajouterJours(jour, 1)) {
      const j = parJour.get(jour);
      if (!j) continue;
      const x = gauche + c * cw;
      const weekEnd = c >= 5;
      doc.save();
      doc.rect(x, y, cw, ch).fill(j.ferie ? '#ffe3a3' : j.impose ? '#dcd2f5' : weekEnd ? '#e9edf2' : '#ffffff');
      for (const [moitie, demi] of [[0, j.matin], [1, j.apresMidi]]) {
        if (!demi) continue;
        const col = couleur(demi.typeId);
        const bx = x + moitie * (cw / 2);
        if (demi.statut === 'en_attente') {
          // Demande en attente : fond clair hachuré.
          doc.save().rect(bx, y, cw / 2, ch).clip();
          doc.rect(bx, y, cw / 2, ch).fillOpacity(0.18).fill(col).fillOpacity(1);
          doc.lineWidth(1).strokeColor(col);
          for (let k = -ch; k < cw / 2; k += 6) doc.moveTo(bx + k, y + ch).lineTo(bx + k + ch, y).stroke();
          doc.restore();
        } else {
          doc.rect(bx, y, cw / 2, ch).fill(col);
        }
        doc.font('Helvetica-Bold').fontSize(8).fillColor(demi.statut === 'en_attente' ? col : '#ffffff')
          .text(codes.get(demi.typeId), bx, y + ch / 2 - 4, { width: cw / 2, align: 'center', lineBreak: false });
      }
      doc.rect(x, y, cw, ch).lineWidth(0.5).strokeColor('#999999').stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(j.matin && j.apresMidi && j.matin.statut !== 'en_attente' ? '#ffffff' : NOIR)
        .text(String(Number(jour.slice(8))), x + 3, y + 3, { lineBreak: false });
      if (j.teletravail) {
        doc.rect(x + 3, y + ch - 14, 16, 11).lineWidth(0.8).strokeColor(NOIR).fillAndStroke('#ffffff', NOIR);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NOIR).text('TT', x + 3, y + ch - 12, { width: 16, align: 'center', lineBreak: false });
      }
      if (j.ticket) {
        const texteX = x + cw - 17;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(j.ticket === 'retire' ? '#888888' : NOIR)
          .text('TR', texteX, y + ch - 11, { lineBreak: false });
        if (j.ticket === 'retire') doc.moveTo(texteX - 1, y + ch - 7.5).lineTo(texteX + 11, y + ch - 7.5).lineWidth(0.8).strokeColor('#888888').stroke();
      }
      doc.restore();
    }
    y += ch;
  }
  y += 10;

  // --- Compteurs
  const c = fiche.compteurs;
  const colonne = (titre, lignes, x, largeurColonne) => {
    let yy = y;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(NOIR).text(titre, x, yy, { width: largeurColonne });
    yy += 18;
    for (const [etiquette, valeur, fort] of lignes) {
      doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(NOIR).text(etiquette, x, yy, { width: largeurColonne - 60, lineBreak: false });
      doc.font('Helvetica-Bold').text(String(valeur), x + largeurColonne - 60, yy, { width: 60, align: 'right', lineBreak: false });
      doc.moveTo(x, yy + 13).lineTo(x + largeurColonne, yy + 13).lineWidth(0.3).strokeColor('#cccccc').stroke();
      yy += 17;
    }
    return yy;
  };
  const demiLargeur = (largeur - 24) / 2;
  const fin1 = colonne('Jours et tickets', [
    ['Jours ouvrés du mois', nombre(c.joursOuvres)],
    ['Jours travaillés', nombre(c.joursTravailles), true],
    ['dont en télétravail (TT)', nombre(c.teletravail)],
    ['dont sur site', nombre(c.surSite)],
    ['Tickets restaurant (TR)', c.tickets, true],
    ['TR retirés par le salarié', c.ticketsRetires],
  ], gauche, demiLargeur);
  const fin2 = colonne('Absences (jours, confirmées)', [
    ...c.absences.map((a) => [`${a.libelle} (${codes.get(a.typeId)})`, nombre(a.jours)]),
    ...(c.absencesEnAttente ? [['Demandes en attente (non comptées)', nombre(c.absencesEnAttente)]] : []),
  ], gauche + demiLargeur + 24, demiLargeur);
  y = Math.max(fin1, fin2) + 8;

  // --- Légende et notes
  doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(
    'Calendrier : moitié gauche de la case = matin, moitié droite = après-midi. TT = télétravail déclaré. TR = ticket restaurant dû '
    + '(barré : retiré par le salarié). Fond jaune = jour férié, violet = jour imposé, gris = week-end. Case hachurée = demande en attente.',
    gauche, y, { width: largeur });
  y = doc.y + 4;
  doc.text(
    "Un ticket restaurant est dû chaque jour travaillé sans aucune absence, même d'une demi-journée, et non retiré par le salarié. "
    + `Les jours sont comptés en jours ouvrés : jours travaillés + absences confirmées + demandes en attente = jours ouvrés.`,
    gauche, y, { width: largeur });
  if (fiche.soldes?.length) {
    doc.moveDown(0.4);
    const au = fiche.soldesAu.split('-').reverse().join('/');
    doc.font('Helvetica-Bold').fillColor(NOIR).text(
      `Soldes de congés au ${au} : ${fiche.soldes.map((s) => `${s.libelle} ${nombre(s.solde)} j`).join(' - ')}`, gauche, doc.y, { width: largeur });
    doc.font('Helvetica').fillColor(GRIS).text("Indicatif : les soldes figurant sur les bulletins de paie font foi.", gauche, doc.y, { width: largeur });
  }
  if (c.provisoire) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fillColor('#8f1d1d')
      .text(`Fiche provisoire : ${nombre(c.absencesEnAttente)} jour(s) d'absence en attente de décision ne sont comptés ni comme travaillés ni comme absents.`, gauche, doc.y, { width: largeur });
  }
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(`Édité le ${formatDateHeure(maintenant, fuseau)} par ${editeePar}.`, gauche, doc.page.height - MARGE - 10, { width: largeur, lineBreak: false });
}

// Un PDF A4 portrait, une page par fiche.
export function genererFichesPdf(fiches, { raisonSociale = '', editeePar, fuseau = 'Europe/Paris', maintenant = new Date(), compresser = true } = {}) {
  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4', margin: MARGE, compress: compresser, autoFirstPage: false,
      info: {
        Title: fiches.length === 1 ? `${titreFiche(fiches[0].mois)} - ${fiches[0].collaborateur.prenom} ${fiches[0].collaborateur.nom}` : titreFiche(fiches[0].mois),
        Author: raisonSociale || 'Gestion des absences', Creator: 'Gestion des absences', CreationDate: maintenant,
      },
    });
    const morceaux = [];
    doc.on('data', (m) => morceaux.push(m));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);
    for (const fiche of fiches) {
      doc.addPage();
      dessinerFiche(doc, fiche, { raisonSociale, editeePar, fuseau, maintenant });
    }
    doc.end();
  });
}
