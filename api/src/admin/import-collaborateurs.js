import { ErreurMetier } from '../erreurs.js';
import { transaction } from './outils.js';

const LIGNES_MAX = 500;
const ROLES = ['collaborateur', 'responsable', 'directeur'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const normaliser = (texte) => String(texte ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

// Lit un CSV (séparateur « ; » ou « , », champs entre guillemets possibles) et renvoie des lignes de champs.
export function lireCsv(texte) {
  const brut = texte.replace(/^﻿/, '');
  const premiere = brut.split(/\r?\n/, 1)[0];
  const separateur = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ';' : ',';
  const lignes = [];
  let ligne = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < brut.length; i++) {
    const c = brut[i];
    if (guillemets) {
      if (c === '"' && brut[i + 1] === '"') { champ += '"'; i++; } else if (c === '"') guillemets = false; else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === separateur) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && brut[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((v) => v.trim() !== '')) lignes.push(ligne);
  return lignes;
}

const COLONNES = {
  email: ['email', 'e-mail', 'courriel', 'mail'],
  nom: ['nom'],
  prenom: ['prenom'],
  equipe: ['equipe'],
  role: ['role', 'profil'],
};

// Import de collaborateurs depuis un CSV, pour la mise en route. Tout ou rien : s'il y a la moindre erreur, rien n'est
// créé et le rapport dit quoi corriger. Les équipes doivent exister (elles ne sont pas créées). Aucun e-mail n'est envoyé :
// les liens de mot de passe se demandent ensuite, à la demande.
export async function routesImportCollaborateurs(app, { pool }) {
  app.post('/collaborateurs/import', {
    schema: {
      body: {
        type: 'object', required: ['csv'], additionalProperties: false,
        properties: { csv: { type: 'string', minLength: 1, maxLength: 200000 }, simulation: { type: 'boolean', default: false } },
      },
    },
  }, async (requete, reponse) => {
    const lignes = lireCsv(requete.body.csv);
    if (lignes.length < 2) throw new ErreurMetier(400, "Le fichier doit contenir une ligne d'en-têtes puis au moins un collaborateur");
    if (lignes.length - 1 > LIGNES_MAX) throw new ErreurMetier(400, `L'import est limité à ${LIGNES_MAX} collaborateurs`);

    const entetes = lignes[0].map(normaliser);
    const colonne = {};
    for (const [cle, noms] of Object.entries(COLONNES)) colonne[cle] = entetes.findIndex((e) => noms.includes(e));
    const manquantes = ['email', 'nom', 'prenom', 'equipe'].filter((cle) => colonne[cle] < 0);
    if (manquantes.length) {
      throw new ErreurMetier(400, `Colonnes manquantes : ${manquantes.join(', ')} (colonnes attendues : email, nom, prenom, equipe, et en option role)`);
    }

    const resultat = await transaction(pool, async (client) => {
      const equipes = (await client.query('SELECT id, nom, actif FROM equipes')).rows;
      const existants = new Set((await client.query('SELECT lower(email) AS e FROM collaborateurs')).rows.map((r) => r.e));
      const vus = new Set();
      const rapport = [];
      const aCreer = [];

      lignes.slice(1).forEach((champs, indice) => {
        const valeur = (cle) => (colonne[cle] >= 0 ? (champs[colonne[cle]] ?? '').trim() : '');
        const erreurs = [];
        const email = valeur('email');
        const nom = valeur('nom');
        const prenom = valeur('prenom');
        const role = valeur('role') ? normaliser(valeur('role')) : 'collaborateur';
        if (!EMAIL.test(email)) erreurs.push('adresse e-mail invalide');
        else if (existants.has(email.toLowerCase())) erreurs.push('adresse déjà utilisée par un collaborateur');
        else if (vus.has(email.toLowerCase())) erreurs.push("adresse en double dans le fichier");
        if (!nom || nom.length > 100) erreurs.push('nom absent ou trop long');
        if (!prenom || prenom.length > 100) erreurs.push('prénom absent ou trop long');
        if (!ROLES.includes(role)) erreurs.push(`rôle inconnu (${ROLES.join(', ')})`);
        const candidates = equipes.filter((e) => normaliser(e.nom) === normaliser(valeur('equipe')));
        if (candidates.length === 0) erreurs.push(`équipe inconnue : « ${valeur('equipe')} »`);
        else if (candidates.length > 1) erreurs.push(`plusieurs équipes portent le nom « ${valeur('equipe')} »`);
        else if (!candidates[0].actif) erreurs.push(`équipe désactivée : « ${candidates[0].nom} »`);
        if (EMAIL.test(email)) vus.add(email.toLowerCase());
        rapport.push({ ligne: indice + 2, email, nom, prenom, equipe: candidates[0]?.nom ?? valeur('equipe'), role, erreurs });
        if (!erreurs.length) aCreer.push({ email, nom, prenom, role, equipeId: candidates[0].id });
      });

      const valide = rapport.every((l) => l.erreurs.length === 0);
      if (valide && !requete.body.simulation) {
        for (const c of aCreer) {
          await client.query(
            'INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role) VALUES ($1, $2, $3, $4, $5)',
            [c.email, c.nom, c.prenom, c.equipeId, c.role],
          );
        }
      }
      return { valide, importes: valide && !requete.body.simulation ? aCreer.length : 0, simulation: requete.body.simulation, lignes: rapport };
    });
    return reponse.code(resultat.importes ? 201 : 200).send(resultat);
  });
}
