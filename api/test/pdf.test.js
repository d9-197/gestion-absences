import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contenuRecapitulatif, genererPdf } from '../src/emails/pdf.js';
import { nombreDePages, texteDuPdf } from './aide-pdf.js';

const personne = (id, prenom, nom) => ({ id, prenom, nom });
const base = () => ({
  evenement: { id: 34, type: 'approbation', motif: null, le: '2026-11-17T20:00:00Z', auteur: personne(3, 'Bob', 'Petit') },
  demande: {
    id: 12, nature: 'absence', demandeAnnuleeId: null,
    dateDebut: '2026-12-14', debutDemiJournee: 'matin', dateFin: '2026-12-18', finDemiJournee: 'apres_midi',
    dureeDemiJournees: 10, commentaire: null, avertissements: [], soumiseLe: '2026-11-17T19:30:00Z',
    collaborateur: personne(4, 'Alice', 'Durand'), equipe: 'Technique', type: 'Congés payés', saisiePar: personne(4, 'Alice', 'Durand'),
  },
});
const parametres = { raisonSociale: 'Société Exemple', mentions: 'Mention légale de test.' };
const lignes = (contenu, section) => Object.fromEntries(contenu.sections.find((s) => s.titre === section).lignes);

test('le contenu d\'une approbation', () => {
  const contenu = contenuRecapitulatif(base(), parametres);
  assert.equal(contenu.titre, "Demande d'absence approuvée");
  assert.equal(contenu.sousTitre, 'Demande n° 12');
  assert.deepEqual(lignes(contenu, 'Demande'), {
    Collaborateur: 'Alice Durand',
    Équipe: 'Technique',
    "Type d'absence": 'Congés payés',
    Période: 'du lundi 14 décembre 2026 au vendredi 18 décembre 2026',
    Durée: '5 jours ouvrés',
    'Soumise le': '17/11/2026 à 20:30',
  });
  assert.deepEqual(lignes(contenu, 'Décision'), { Décision: 'Approuvée', 'Décidée par': 'Bob Petit', Le: '17/11/2026 à 21:00' });
  assert.equal(contenu.raisonSociale, 'Société Exemple');
  assert.equal(contenu.mentions, 'Mention légale de test.');
  assert.match(contenu.pied, /demande n° 12, événement n° 34/);
});

test('un refus porte son motif, une approbation non', () => {
  const refus = base();
  Object.assign(refus.evenement, { type: 'refus', motif: 'Période de clôture' });
  const contenu = contenuRecapitulatif(refus, parametres);
  assert.equal(contenu.titre, "Demande d'absence refusée");
  assert.equal(lignes(contenu, 'Décision')['Motif du refus'], 'Période de clôture');
  assert.equal('Motif du refus' in lignes(contenuRecapitulatif(base(), parametres), 'Décision'), false);
});

test('commentaire, auteur de la saisie et avertissements n\'apparaissent que s\'ils existent', () => {
  const recap = base();
  Object.assign(recap.demande, {
    commentaire: 'Vacances', saisiePar: personne(5, 'Carla', 'Roux'),
    avertissements: [{ code: 'chevauchement', message: 'Chevauche une autre demande' }],
  });
  const demande = lignes(contenuRecapitulatif(recap, parametres), 'Demande');
  assert.equal(demande.Commentaire, 'Vacances');
  assert.equal(demande['Saisie par'], 'Carla Roux');
  assert.equal(demande['Avertissements affichés à la saisie'], '- Chevauche une autre demande');
});

test('une déclaration et une annulation ont leur propre libellé', () => {
  const declaration = base();
  declaration.evenement.type = 'enregistrement';
  const c1 = contenuRecapitulatif(declaration, parametres);
  assert.equal(c1.titre, 'Absence enregistrée');
  assert.equal(lignes(c1, 'Décision')['Décision'], 'Enregistrée');
  assert.equal(lignes(c1, 'Décision')['Enregistrée par'], 'Bob Petit');

  const annulation = base();
  Object.assign(annulation.demande, { nature: 'annulation', demandeAnnuleeId: 9 });
  const c2 = contenuRecapitulatif(annulation, parametres);
  assert.equal(c2.titre, "Demande d'annulation approuvée");
  assert.equal(c2.sousTitre, "Demande d'annulation n° 12");
  assert.equal(lignes(c2, "Demande d'annulation").Concerne, "Demande d'absence n° 9");
});

test('l\'exemple est signalé comme tel', () => {
  assert.equal(contenuRecapitulatif(base(), parametres, { exemple: true }).sousTitre, 'Exemple : aucune demande réelle');
});

test('le PDF est valide et son texte relisible, accents compris', async () => {
  const recap = base();
  recap.demande.commentaire = 'Congés de fin d\'année';
  const pdf = await genererPdf(contenuRecapitulatif(recap, parametres), { dateCreation: new Date('2026-11-17T20:00:00Z') });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-8).toString(), /%%EOF/);
  assert.equal(nombreDePages(pdf), 1);
  const texte = texteDuPdf(pdf);
  for (const attendu of ['Société Exemple', "Demande d'absence approuvée", 'Alice Durand', 'Congés payés', '5 jours ouvrés',
    'Approuvée', 'Bob Petit', 'Mention légale de test.', 'demande n° 12']) {
    assert.ok(texte.includes(attendu), `« ${attendu} » absent du PDF`);
  }
});

test('le PDF est identique d\'un envoi à l\'autre pour les mêmes données', async () => {
  const options = { dateCreation: new Date('2026-11-17T20:00:00Z') };
  const contenu = contenuRecapitulatif(base(), parametres);
  const a = await genererPdf(contenu, options);
  const b = await genererPdf(contenu, options);
  // Seul l'identifiant interne peut différer : le contenu des pages, lui, ne change pas.
  assert.equal(texteDuPdf(a), texteDuPdf(b));
  assert.equal(a.length, b.length);
});

test('un long contenu passe sur une seconde page sans rien perdre', async () => {
  const recap = base();
  recap.demande.avertissements = Array.from({ length: 120 }, (_, i) => ({ code: 'x', message: `Avertissement numéro ${i + 1}` }));
  const pdf = await genererPdf(contenuRecapitulatif(recap, parametres));
  assert.ok(nombreDePages(pdf) >= 2);
  const texte = texteDuPdf(pdf);
  assert.ok(texte.includes('Avertissement numéro 120'));
  assert.ok(texte.includes('Mention légale de test.'));
});

test('sans raison sociale ni mentions, le PDF reste complet', async () => {
  const contenu = contenuRecapitulatif(base(), { raisonSociale: '', mentions: '' });
  const texte = texteDuPdf(await genererPdf(contenu));
  assert.ok(texte.includes('Alice Durand'));
  assert.ok(!texte.includes('undefined'));
});
