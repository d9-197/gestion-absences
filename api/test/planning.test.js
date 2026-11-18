// Tests du planning contre une vraie base (ignorés si TEST_DB_HOST n'est pas défini).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { construireApp } from '../src/app.js';
import { hacher } from '../src/auth/mots-de-passe.js';
import { construirePlanning } from '../src/planning/service.js';
import { creerBaseDeTest, hote, options } from './aide-base.js';

const config = { appUrl: 'http://app.test', cookieSecure: false, sessionDureeHeures: 12 };
const sansLimite = { connexion: { max: 10000, timeWindow: '1 minute' }, oubli: { max: 10000, timeWindow: '1 minute' } };
const MOT_DE_PASSE = 'un mot de passe solide';

let baseDeTest;
let pool;
let app;
const sessions = {};
const ids = {};

const appel = (qui, method, url, payload) => app.inject({ method, url, payload, cookies: sessions[qui] ?? {} });
const planning = async (qui, debut = '2026-12-01', fin = '2026-12-31') => {
  const reponse = await appel(qui, 'GET', `/api/planning?debut=${debut}&fin=${fin}`);
  assert.equal(reponse.statusCode, 200, reponse.body);
  return reponse.json();
};
const noms = (p) => p.personnes.map((x) => x.prenom);
const personne = (p, prenom) => p.personnes.find((x) => x.prenom === prenom);

async function demander(qui, corps, attendu = 201) {
  const reponse = await appel(qui, 'POST', '/api/demandes', { typeId: ids.conges, ...corps });
  assert.equal(reponse.statusCode, attendu, reponse.body);
  return reponse.json();
}
const decider = (qui, id, decision, motif) => appel(qui, 'POST', `/api/demandes/${id}/decision`, { decision, motif });

before(async () => {
  if (!hote) return;
  baseDeTest = await creerBaseDeTest();
  pool = baseDeTest.api;
  const equipe = async (nom, parent = null) =>
    Number((await pool.query('INSERT INTO equipes (nom, parent_id) VALUES ($1, $2) RETURNING id', [nom, parent])).rows[0].id);
  ids.direction = await equipe('Direction');
  ids.technique = await equipe('Technique', ids.direction);
  ids.dev = await equipe('Développement', ids.technique);
  ids.commerce = await equipe('Commerce', ids.direction);

  const hachage = await hacher(MOT_DE_PASSE);
  const creer = async (prenom, equipeId, role, actif = true) => {
    ids[prenom] = Number((await pool.query(
      `INSERT INTO collaborateurs (email, nom, prenom, equipe_id, role, mot_de_passe_hash, actif)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [`${prenom}@exemple.test`, prenom.toUpperCase(), prenom, equipeId, role, hachage, actif],
    )).rows[0].id);
  };
  await creer('diane', ids.direction, 'directeur');
  await creer('eric', ids.direction, 'directeur');
  await creer('bob', ids.technique, 'responsable');
  await creer('carla', ids.dev, 'responsable');
  await creer('dan', ids.technique, 'responsable'); // délégué de Développement
  await creer('alice', ids.dev, 'collaborateur');
  await creer('chloe', ids.commerce, 'collaborateur');
  await creer('zoe', ids.dev, 'collaborateur'); // sera désactivée
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.direction, ids.diane]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.technique, ids.bob]);
  await pool.query('UPDATE equipes SET responsable_id = $2 WHERE id = $1', [ids.dev, ids.carla]);
  await pool.query('INSERT INTO delegations (equipe_id, delegue_id) VALUES ($1, $2)', [ids.dev, ids.dan]);
  const type = async (libelle) =>
    Number((await pool.query('SELECT id FROM types_absence WHERE libelle = $1', [libelle])).rows[0].id);
  ids.conges = await type('Congés payés');
  ids.rtt = await type('RTT');
  ids.maladie = await type('Maladie');

  app = await construireApp({
    pool, config, logger: false, limites: sansLimite, aujourdhui: () => '2026-11-17',
    courriel: { envoyer: async () => {} },
  });
  for (const prenom of ['diane', 'eric', 'bob', 'carla', 'dan', 'alice', 'chloe', 'zoe']) {
    const connexion = await app.inject({
      method: 'POST', url: '/api/auth/connexion', payload: { email: `${prenom}@exemple.test`, motDePasse: MOT_DE_PASSE },
    });
    sessions[prenom] = { absences_session: connexion.cookies.find((c) => c.name === 'absences_session').value };
  }
});

after(async () => {
  await app?.close();
  await baseDeTest?.fermer();
});

test('le planning exige une connexion et une période valide', options, async () => {
  assert.equal((await appel('inconnu', 'GET', '/api/planning?debut=2026-12-01&fin=2026-12-31')).statusCode, 401);
  for (const requete of ['', '?debut=2026-12-01', '?fin=2026-12-31', '?debut=2026-02-30&fin=2026-03-01',
    '?debut=2026-12-31&fin=2026-12-01', '?debut=2026-01-01&fin=2026-12-31']) {
    assert.equal((await appel('alice', 'GET', `/api/planning${requete}`)).statusCode, 400, requete);
  }
  assert.equal((await appel('alice', 'GET', '/api/planning?debut=2026-12-01&fin=2027-03-10')).statusCode, 200); // 100 jours
});

test('chacun ne voit que les plannings qu\'il a le droit de voir', options, async () => {
  assert.deepEqual(noms(await planning('alice')), ['alice']);
  assert.deepEqual(noms(await planning('chloe')), ['chloe']);
  // Un responsable : son équipe, avec lui-même.
  assert.deepEqual(noms(await planning('carla')).sort(), ['alice', 'carla', 'zoe']);
  assert.deepEqual(noms(await planning('dan')).sort(), ['alice', 'dan', 'zoe']); // délégué de Développement
  // Le responsable de l'équipe parente voit aussi les sous-équipes.
  assert.deepEqual(noms(await planning('bob')).sort(), ['alice', 'bob', 'carla', 'dan', 'zoe']);
  // Les directeurs voient toute l'entreprise.
  const direction = noms(await planning('diane')).sort();
  assert.deepEqual(direction, ['alice', 'bob', 'carla', 'chloe', 'dan', 'diane', 'eric', 'zoe']);
  assert.deepEqual(noms(await planning('eric')).sort(), direction);
});

test('le planning est classé par équipe puis par nom, la personne connectée en tête', options, async () => {
  // Après la personne connectée : Commerce, Développement (avec son accent), Direction, Technique ; par nom dans chaque équipe.
  assert.deepEqual(noms(await planning('diane')), ['diane', 'chloe', 'alice', 'carla', 'zoe', 'eric', 'bob', 'dan']);
  assert.deepEqual(noms(await planning('eric')), ['eric', 'chloe', 'alice', 'carla', 'zoe', 'diane', 'bob', 'dan']);
});

test('la ligne de l\'utilisateur est la première, quel que soit son rôle ou son équipe', options, async () => {
  assert.deepEqual(noms(await planning('alice')), ['alice']);
  assert.deepEqual(noms(await planning('carla')), ['carla', 'alice', 'zoe']);
  assert.deepEqual(noms(await planning('dan')), ['dan', 'alice', 'zoe']);
  assert.deepEqual(noms(await planning('bob')), ['bob', 'alice', 'carla', 'zoe', 'dan']);
  assert.deepEqual(noms(await planning('chloe')), ['chloe']);
});

test('les absences valables et en attente figurent, à la demi-journée', options, async () => {
  const approuvee = await demander('alice', { dateDebut: '2026-12-07', debutDemiJournee: 'apres_midi', dateFin: '2026-12-09', finDemiJournee: 'matin' });
  await decider('carla', approuvee.id, 'approbation');
  const attente = await demander('alice', { typeId: ids.rtt, dateDebut: '2026-12-14', dateFin: '2026-12-14' });
  const declaration = await demander('alice', { typeId: ids.maladie, dateDebut: '2026-12-21', dateFin: '2026-12-22' });

  const alice = personne(await planning('alice'), 'alice');
  assert.deepEqual(alice.absences, [
    {
      demandeId: approuvee.id, dateDebut: '2026-12-07', debutDemiJournee: 'apres_midi', dateFin: '2026-12-09', finDemiJournee: 'matin',
      statut: 'confirmee', type: { id: ids.conges, libelle: 'Congés payés' },
    },
    {
      demandeId: attente.id, dateDebut: '2026-12-14', debutDemiJournee: 'matin', dateFin: '2026-12-14', finDemiJournee: 'apres_midi',
      statut: 'en_attente', type: { id: ids.rtt, libelle: 'RTT' },
    },
    {
      demandeId: declaration.id, dateDebut: '2026-12-21', debutDemiJournee: 'matin', dateFin: '2026-12-22', finDemiJournee: 'apres_midi',
      statut: 'confirmee', type: { id: ids.maladie, libelle: 'Maladie' },
    },
  ]);
});

test('refusées, retirées et annulées ne figurent pas ; les demandes d\'annulation non plus', options, async () => {
  const refusee = await demander('chloe', { dateDebut: '2026-12-01', dateFin: '2026-12-01' });
  await decider('diane', refusee.id, 'refus', 'Non');
  const retiree = await demander('chloe', { dateDebut: '2026-12-02', dateFin: '2026-12-02' });
  await appel('chloe', 'POST', `/api/demandes/${retiree.id}/retrait`);
  const annulee = await demander('chloe', { dateDebut: '2026-12-03', dateFin: '2026-12-03' });
  await decider('diane', annulee.id, 'approbation');
  const annulation = (await appel('chloe', 'POST', `/api/demandes/${annulee.id}/annulation`, {})).json();
  // Tant que l'annulation n'est pas approuvée, l'absence reste valable et l'annulation n'apparaît pas à part.
  let chloe = personne(await planning('chloe'), 'chloe');
  assert.deepEqual(chloe.absences.map((a) => [a.demandeId, a.statut]), [[annulee.id, 'confirmee']]);
  await decider('diane', annulation.id, 'approbation');
  chloe = personne(await planning('chloe'), 'chloe');
  assert.deepEqual(chloe.absences, []);
});

test('seules les absences qui touchent la période sont renvoyées', options, async () => {
  const hors = await planning('alice', '2026-12-10', '2026-12-13');
  assert.deepEqual(personne(hors, 'alice').absences, []);
  // Une absence à cheval sur le début de la période est renvoyée en entier.
  const cheval = await planning('alice', '2026-12-08', '2026-12-10');
  assert.deepEqual(personne(cheval, 'alice').absences.map((a) => [a.dateDebut, a.dateFin]), [['2026-12-07', '2026-12-09']]);
  // Bornes incluses.
  assert.equal(personne(await planning('alice', '2026-12-09', '2026-12-09'), 'alice').absences.length, 1);
  assert.equal(personne(await planning('alice', '2026-12-10', '2026-12-10'), 'alice').absences.length, 0);
});

test('les responsables voient les absences de leur équipe avec leur type ; les autres équipes restent invisibles', options, async () => {
  const carla = await planning('carla');
  assert.equal(personne(carla, 'alice').absences.length, 3);
  assert.deepEqual(carla.types.map((t) => t.libelle), ['Congés payés', 'Maladie', 'RTT']);
  const demandeDeChloe = await demander('chloe', { dateDebut: '2026-12-15', dateFin: '2026-12-15' });
  assert.ok(!(await planning('carla')).personnes.some((p) => p.absences.some((a) => a.demandeId === demandeDeChloe.id)));
  assert.equal(personne(await planning('carla'), 'chloe'), undefined);
  assert.equal(personne(await planning('diane'), 'chloe').absences.some((a) => a.demandeId === demandeDeChloe.id), true);
});

test('jours fériés et jours imposés selon l\'équipe', options, async () => {
  await pool.query(
    `INSERT INTO jours_imposes (jour, libelle, equipe_id, avec_decompte) VALUES
       ('2026-12-24', 'Pont de Noël', NULL, true), ('2026-12-28', 'Fermeture technique', $1, false)`,
    [ids.technique],
  );
  const p = await planning('diane');
  assert.deepEqual(p.joursFeries, [{ jour: '2026-12-25', libelle: 'Noël' }]);
  // Technique et Développement (sous-équipe) : les deux jours ; les autres équipes : seulement celui de l'entreprise.
  const jours = (equipeId) => (p.imposesParEquipe[equipeId] ?? []).map((j) => j.jour);
  assert.deepEqual(jours(ids.technique), ['2026-12-24', '2026-12-28']);
  assert.deepEqual(jours(ids.dev), ['2026-12-24', '2026-12-28']);
  assert.deepEqual(jours(ids.commerce), ['2026-12-24']);
  assert.deepEqual(jours(ids.direction), ['2026-12-24']);
  assert.deepEqual(p.imposesParEquipe[ids.commerce], [{ jour: '2026-12-24', libelle: 'Pont de Noël', avecDecompte: true }]);
  // Une collaboratrice ne reçoit que les équipes qu'elle voit.
  assert.deepEqual(Object.keys((await planning('chloe')).imposesParEquipe), [String(ids.commerce)]);
  // Les fériés de l'année sont préremplis à la demande.
  assert.equal((await planning('alice', '2027-05-01', '2027-05-31')).joursFeries.length, 4); // 1er et 8 mai, Ascension, lundi de Pentecôte
});

test('les équipes présentes dans le planning servent de filtre', options, async () => {
  const p = await planning('bob');
  assert.deepEqual(p.equipes.map((e) => e.nom).sort(), ['Développement', 'Technique']);
});

test('une personne désactivée n\'apparaît que si elle a des absences sur la période', options, async () => {
  const absence = await demander('zoe', { dateDebut: '2026-12-16', dateFin: '2026-12-16' });
  await pool.query('UPDATE collaborateurs SET actif = false WHERE id = $1', [ids.zoe]);
  try {
    const avec = personne(await planning('diane', '2026-12-14', '2026-12-18'), 'zoe');
    assert.equal(avec.actif, false);
    assert.equal(avec.absences[0].demandeId, absence.id);
    assert.equal(personne(await planning('diane', '2026-12-28', '2026-12-31'), 'zoe'), undefined);
  } finally {
    await pool.query('UPDATE collaborateurs SET actif = true WHERE id = $1', [ids.zoe]);
  }
});

// --- Confidentialité ---------------------------------------------------------

test('le type d\'une absence confidentielle est montré à la personne et à ses valideurs', options, async () => {
  const maladie = (p, prenom) => personne(p, prenom).absences.find((a) => a.dateDebut === '2026-12-21');
  for (const qui of ['alice', 'carla', 'dan', 'bob', 'diane', 'eric']) {
    const absence = maladie(await planning(qui), 'alice');
    assert.equal(absence.type.libelle, 'Maladie', qui);
    assert.ok(absence.demandeId > 0, qui);
  }
});

test('pour tout autre lecteur, une absence confidentielle apparaît sans type ni lien', options, async () => {
  // Les routes n'exposent jamais le planning d'une personne à un lecteur qui n'est ni elle ni l'un de ses valideurs ;
  // le service masque pourtant le type par précaution, si la visibilité devait être élargie.
  const alice = { id: ids.alice, prenom: 'alice', nom: 'ALICE', actif: true, equipe_id: ids.dev, equipe_nom: 'Développement' };
  const vuParChloe = await construirePlanning(pool, { moi: ids.chloe, debut: '2026-12-01', fin: '2026-12-31', personnes: [alice] });
  const absences = vuParChloe.personnes[0].absences;
  const maladie = absences.find((a) => a.dateDebut === '2026-12-21');
  assert.deepEqual(maladie, {
    demandeId: null, dateDebut: '2026-12-21', debutDemiJournee: 'matin', dateFin: '2026-12-22', finDemiJournee: 'apres_midi',
    statut: 'confirmee', type: null,
  });
  // Les types ordinaires restent visibles, et la légende ne mentionne pas le type masqué.
  assert.equal(absences.find((a) => a.dateDebut === '2026-12-07').type.libelle, 'Congés payés');
  assert.deepEqual(vuParChloe.types.map((t) => t.libelle), ['Congés payés', 'RTT']);
  assert.ok(!JSON.stringify(vuParChloe).includes('Maladie'));
});

test('un type rendu confidentiel par les directeurs est masqué de la même façon', options, async () => {
  await pool.query('UPDATE types_absence SET confidentiel = true WHERE id = $1', [ids.rtt]);
  try {
    const alice = { id: ids.alice, prenom: 'alice', nom: 'ALICE', actif: true, equipe_id: ids.dev, equipe_nom: 'Développement' };
    const vu = await construirePlanning(pool, { moi: ids.chloe, debut: '2026-12-01', fin: '2026-12-31', personnes: [alice] });
    const rtt = vu.personnes[0].absences.find((a) => a.dateDebut === '2026-12-14');
    assert.equal(rtt.type, null);
    assert.equal(rtt.statut, 'en_attente'); // une demande en attente se distingue toujours
  } finally {
    await pool.query('UPDATE types_absence SET confidentiel = false WHERE id = $1', [ids.rtt]);
  }
});
