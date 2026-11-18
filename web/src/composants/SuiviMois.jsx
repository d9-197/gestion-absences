import { useEffect, useRef, useState } from 'react';
import { appeler } from '../api.js';
import { aujourdhui, estWeekEnd, joursDuMois } from '../dates.js';
import { jourCourt, nomComplet } from '../format.js';
import { useEnvoi } from '../donnees.js';
import Dialogue from './Dialogue.jsx';

// Une personne est modifiable, pour un jour, selon ce que l'API a annoncé : « tout » (directeur) ou, pour soi-même,
// le mois en cours et les suivants. L'API refuse de toute façon ce qui sort du cadre.
export const jourModifiable = (modifiable, jour, moisClotures = []) =>
  !moisClotures.includes(jour.slice(0, 7)) && (modifiable === 'tout' || (modifiable === 'mois_courant' && jour >= `${aujourdhui().slice(0, 7)}-01`));

// Télétravail (TT) et ticket restaurant (TR) d'une personne, jour par jour pour un mois : deux cases par jour, enregistrées
// à chaque coche. Un TR décoché est un ticket retiré. Une case n'existe que si elle a un sens ce jour-là.
export default function SuiviMois({ personne, mois, joursFeries, joursImposes, moisClotures = [], jourCible = null, onFermer, onChange }) {
  const { suivi } = personne;
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();
  const cible = useRef(null);
  const jours = joursDuMois(mois.annee, mois.mois);
  const retires = new Map(suivi.ticketsRetires.map((t) => [t.jour, t.motif]));
  const possibles = new Set([...suivi.tickets, ...retires.keys()]); // jours où un TR existe, coché ou non
  // Les coches suivent le clic tout de suite ; elles se recalent sur le serveur à chaque rechargement (et reviennent si l'API refuse).
  const [teletravail, setTeletravail] = useState(() => new Set(suivi.teletravail));
  const [tickets, setTickets] = useState(() => new Set(suivi.tickets));
  useEffect(() => { setTeletravail(new Set(suivi.teletravail)); setTickets(new Set(suivi.tickets)); }, [suivi]);
  const changer = (ensemble, jour, coche) => { const n = new Set(ensemble); if (coche) n.add(jour); else n.delete(jour); return n; };
  const feries = new Map(joursFeries.map((j) => [j.jour, j.libelle]));
  const imposes = new Map(joursImposes.map((j) => [j.jour, j.libelle]));
  const absences = (jour) => personne.absences.filter((a) => a.dateDebut <= jour && a.dateFin >= jour);
  // Absent toute la journée : une absence couvre le matin et une absence couvre l'après-midi.
  const absentTout = (jour) => {
    const couvre = (demi) => absences(jour).some((a) => (a.dateDebut < jour || demi === 'apres_midi' || a.debutDemiJournee === 'matin')
      && (a.dateFin > jour || demi === 'matin' || a.finDemiJournee === 'apres_midi'));
    return couvre('matin') && couvre('apres_midi');
  };

  useEffect(() => { cible.current?.scrollIntoView({ block: 'center' }); }, []);

  const agir = async (chemin, corps, message) => {
    const reussi = await envoyer(async () => {
      await appeler(chemin, { methode: 'PUT', corps: { collaborateurId: personne.id, ...corps } });
      setRetour(message);
      onChange();
    });
    if (!reussi) { setTeletravail(new Set(suivi.teletravail)); setTickets(new Set(suivi.tickets)); } // refusé : la coche revient
  };
  const basculerTT = (jour, coche) => { setTeletravail((e) => changer(e, jour, coche)); return agir('/suivi/teletravail', { jours: [jour], teletravail: coche },
    `TT ${coche ? 'déclaré' : 'annulé'} le ${jourCourt(jour)}.`); };
  const basculerTR = (jour, coche) => { setTickets((e) => changer(e, jour, coche)); return agir('/suivi/tickets', { jours: [jour], retire: !coche, ...(coche ? {} : { motif }) },
    `TR ${coche ? 'rétabli' : 'retiré'} le ${jourCourt(jour)}.`); };

  const ligne = (jour) => {
    const raison = estWeekEnd(jour) ? 'Week-end' : feries.get(jour) ?? imposes.get(jour);
    const editable = jourModifiable(suivi.modifiable, jour, moisClotures);
    const ttPossible = !raison && !absentTout(jour);
    const trPossible = possibles.has(jour);
    const remarque = raison ?? (absences(jour).length && !trPossible ? 'Absence' : retires.get(jour) ? `TR retiré : ${retires.get(jour)}` : '');
    return (
      <tr key={jour} ref={jour === jourCible ? cible : undefined} className={jour === jourCible ? 'ligne-cible' : raison ? 'inactif' : undefined}>
        <th scope="row">{jourCourt(jour)}</th>
        <td className="colonne-case">
          {ttPossible && (
            <input type="checkbox" checked={teletravail.has(jour)} disabled={!editable || enCours}
              aria-label={`TT, télétravail le ${jourCourt(jour)}`} onChange={(e) => basculerTT(jour, e.target.checked)} />
          )}
        </td>
        <td className="colonne-case">
          {trPossible && (
            <input type="checkbox" checked={tickets.has(jour)} disabled={!editable || enCours}
              aria-label={`TR, ticket restaurant le ${jourCourt(jour)}`} onChange={(e) => basculerTR(jour, e.target.checked)} />
          )}
        </td>
        <td className="sous-texte-ligne">{remarque}</td>
      </tr>
    );
  };

  const modifiable = suivi.modifiable !== null;
  return (
    <Dialogue titre={`TT et TR : ${nomComplet(personne)}`} onFermer={onFermer}>
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {retour && !erreur && <p className="message succes" role="status">{retour}</p>}
      {modifiable ? (
        <>
          <p className="aide">
            Cochez <strong>TT</strong> les jours de télétravail ; <strong>TR</strong> est coché quand le ticket restaurant est dû : décochez-le pour le retirer
            (repas pris en charge, note de frais…). Chaque coche est enregistrée aussitôt.
            {suivi.modifiable === 'tout'
              ? ' En tant que directeur, vous pouvez corriger n\'importe quel jour, y compris dans un mois clos.'
              : ' Vous pouvez modifier le mois en cours (jusqu\'à son dernier jour) et les mois à venir ; après, seul un directeur peut corriger.'}
          </p>
          <label htmlFor="suivi-motif">Motif des TR décochés (facultatif)</label>
          <input id="suivi-motif" maxLength={300} placeholder="Repas offert, note de frais…" value={motif} onChange={(e) => setMotif(e.target.value)} />
        </>
      ) : <p className="aide">Consultation seule : seul le collaborateur, ou un directeur, peut modifier ces informations.</p>}
      <div className="tableau-defilant tableau-suivi">
        <table>
          <thead><tr><th>Jour</th><th className="colonne-case">TT</th><th className="colonne-case">TR</th><th>Remarque</th></tr></thead>
          <tbody>{jours.map(ligne)}</tbody>
        </table>
      </div>
      <div className="actions"><button className="bouton secondaire" type="button" onClick={onFermer}>Fermer</button></div>
    </Dialogue>
  );
}

const JOURS_SEMAINE = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi']];

// Préremplissage : « en télétravail tous les mardis jusqu'au … ». Chaque jour reste modifiable ensuite.
export function SerieTeletravail({ onFermer, onChange }) {
  const [champs, setChamps] = useState({ jours: new Set([2]), debut: aujourdhui(), fin: '', teletravail: true });
  const { enCours, erreur, envoyer } = useEnvoi();
  const basculer = (n) => {
    const suivants = new Set(champs.jours);
    if (suivants.has(n)) suivants.delete(n); else suivants.add(n);
    setChamps({ ...champs, jours: suivants });
  };

  async function soumettre(evenement) {
    evenement.preventDefault();
    let r;
    const reussi = await envoyer(async () => {
      r = await appeler('/suivi/teletravail/serie', {
        methode: 'POST',
        corps: { joursSemaine: [...champs.jours].sort(), debut: champs.debut, fin: champs.fin, teletravail: champs.teletravail },
      });
    });
    if (!reussi) return;
    const e = r.ecartes;
    const details = [e.nonTravailles && `${e.nonTravailles} jour${e.nonTravailles > 1 ? 's' : ''} non travaillé${e.nonTravailles > 1 ? 's' : ''}`,
      e.absence && `${e.absence} jour${e.absence > 1 ? 's' : ''} d'absence`, e.dejaFait && `${e.dejaFait} déjà à jour`].filter(Boolean);
    onChange(`${r.modifies} jour${r.modifies > 1 ? 's' : ''} de TT ${champs.teletravail ? 'déclaré' : 'annulé'}${r.modifies > 1 ? 's' : ''}`
      + (details.length ? ` (écartés : ${details.join(', ')})` : '')
      + (r.debutEffectif !== r.debutDemande ? `. La série démarre au ${jourCourt(r.debutEffectif)} : les jours antérieurs au mois en cours ne sont modifiables que par un directeur` : '') + '.');
  }

  return (
    <Dialogue titre="Télétravail (TT) en série" onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <fieldset>
          <legend>Action</legend>
          <label className="case"><input type="radio" name="serie-action" checked={champs.teletravail} onChange={() => setChamps({ ...champs, teletravail: true })} /> Déclarer du TT</label>
          <label className="case"><input type="radio" name="serie-action" checked={!champs.teletravail} onChange={() => setChamps({ ...champs, teletravail: false })} /> Annuler du TT déjà déclaré</label>
        </fieldset>
        <fieldset>
          <legend>Tous les…</legend>
          {JOURS_SEMAINE.map(([n, nom]) => (
            <label className="case" key={n}><input type="checkbox" checked={champs.jours.has(n)} onChange={() => basculer(n)} /> {nom}</label>
          ))}
        </fieldset>
        <div className="ligne-champs">
          <div><label htmlFor="serie-debut">À partir du</label><input id="serie-debut" type="date" required value={champs.debut} onChange={(e) => setChamps({ ...champs, debut: e.target.value })} /></div>
          <div><label htmlFor="serie-fin">Jusqu'au (inclus)</label><input id="serie-fin" type="date" required min={champs.debut} value={champs.fin} onChange={(e) => setChamps({ ...champs, fin: e.target.value })} /></div>
        </div>
        <p className="aide">
          Les jours fériés, jours imposés et jours d'absence sont écartés. Ensuite, chaque jour se modifie à l'unité depuis le planning.
        </p>
        <div className="actions">
          <button className="bouton secondaire" type="button" onClick={onFermer}>Annuler</button>
          <button className="bouton" type="submit" disabled={enCours || champs.jours.size === 0}>{enCours ? 'Enregistrement…' : champs.teletravail ? 'Déclarer' : 'Annuler la série'}</button>
        </div>
      </form>
    </Dialogue>
  );
}
