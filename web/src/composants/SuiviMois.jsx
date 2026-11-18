import { useEffect, useRef, useState } from 'react';
import { appeler } from '../api.js';
import { aujourdhui, estWeekEnd, joursDuMois } from '../dates.js';
import { jourCourt, nomComplet } from '../format.js';
import { useEnvoi } from '../donnees.js';
import Dialogue from './Dialogue.jsx';

// Une personne est modifiable, pour un jour, selon ce que l'API a annoncé : « tout » (directeur) ou, pour soi-même,
// le mois en cours et les suivants. L'API refuse de toute façon ce qui sort du cadre.
export const jourModifiable = (modifiable, jour) =>
  modifiable === 'tout' || (modifiable === 'mois_courant' && jour >= `${aujourdhui().slice(0, 7)}-01`);

// Ticket restaurant et télétravail d'une personne, jour par jour, pour un mois : le détail, et la saisie à l'unité.
export default function SuiviMois({ personne, mois, joursFeries, joursImposes, jourCible = null, onFermer, onChange }) {
  const { suivi } = personne;
  const [motif, setMotif] = useState('');
  const [retour, setRetour] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();
  const cible = useRef(null);
  const jours = joursDuMois(mois.annee, mois.mois);
  const tickets = new Set(suivi.tickets);
  const retires = new Map(suivi.ticketsRetires.map((t) => [t.jour, t.motif]));
  const teletravail = new Set(suivi.teletravail);
  const feries = new Map(joursFeries.map((j) => [j.jour, j.libelle]));
  const imposes = new Map(joursImposes.map((j) => [j.jour, j.libelle]));
  const absent = (jour) => personne.absences.some((a) => a.dateDebut <= jour && a.dateFin >= jour);

  useEffect(() => { cible.current?.scrollIntoView({ block: 'center' }); }, []);

  const agir = (chemin, corps, message) => envoyer(async () => {
    await appeler(chemin, { methode: 'PUT', corps: { collaborateurId: personne.id, ...corps } });
    setRetour(message);
    onChange();
  });

  const ligne = (jour) => {
    const raison = estWeekEnd(jour) ? 'Week-end' : feries.get(jour) ?? imposes.get(jour);
    const editable = jourModifiable(suivi.modifiable, jour);
    const peutTeletravailler = !raison && editable;
    return (
      <tr key={jour} ref={jour === jourCible ? cible : undefined} className={jour === jourCible ? 'ligne-cible' : raison ? 'inactif' : undefined}>
        <th scope="row">{jourCourt(jour)}</th>
        <td>
          {tickets.has(jour) && 'Dû'}
          {retires.has(jour) && <>Retiré{retires.get(jour) ? <span className="sous-texte">{retires.get(jour)}</span> : null}</>}
          {!tickets.has(jour) && !retires.has(jour) && <span className="manquant">{raison ?? (absent(jour) ? 'Absence' : '—')}</span>}
        </td>
        <td>{teletravail.has(jour) ? 'Télétravail' : '—'}</td>
        <td className="actions-ligne">
          {editable && tickets.has(jour) && (
            <button className="bouton lien" type="button" disabled={enCours} onClick={() => agir('/suivi/tickets', { jours: [jour], retire: true, motif }, `Ticket retiré le ${jourCourt(jour)}.`)}
              aria-label={`Retirer le ticket restaurant du ${jourCourt(jour)}`}>Retirer le ticket</button>
          )}
          {editable && retires.has(jour) && (
            <button className="bouton lien" type="button" disabled={enCours} onClick={() => agir('/suivi/tickets', { jours: [jour], retire: false }, `Ticket rétabli le ${jourCourt(jour)}.`)}
              aria-label={`Rétablir le ticket restaurant du ${jourCourt(jour)}`}>Rétablir</button>
          )}
          {editable && teletravail.has(jour) && (
            <button className="bouton lien" type="button" disabled={enCours} onClick={() => agir('/suivi/teletravail', { jours: [jour], teletravail: false }, `Télétravail annulé le ${jourCourt(jour)}.`)}
              aria-label={`Annuler le télétravail du ${jourCourt(jour)}`}>Annuler le télétravail</button>
          )}
          {peutTeletravailler && !teletravail.has(jour) && (
            <button className="bouton lien" type="button" disabled={enCours} onClick={() => agir('/suivi/teletravail', { jours: [jour], teletravail: true }, `Télétravail déclaré le ${jourCourt(jour)}.`)}
              aria-label={`Déclarer du télétravail le ${jourCourt(jour)}`}>Télétravail</button>
          )}
        </td>
      </tr>
    );
  };

  const modifiable = suivi.modifiable !== null;
  return (
    <Dialogue titre={`Tickets restaurant et télétravail : ${nomComplet(personne)}`} onFermer={onFermer}>
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {retour && !erreur && <p className="message succes" role="status">{retour}</p>}
      {modifiable ? (
        <>
          <label htmlFor="suivi-motif">Motif d'un retrait de ticket (facultatif)</label>
          <input id="suivi-motif" maxLength={300} placeholder="Repas pris en charge par l'entreprise, note de frais…" value={motif} onChange={(e) => setMotif(e.target.value)} />
          <p className="aide">
            {suivi.modifiable === 'tout'
              ? 'En tant que directeur, vous pouvez corriger n\'importe quel jour, y compris dans un mois clos.'
              : 'Vous pouvez modifier le mois en cours (jusqu\'à son dernier jour) et les mois à venir. Après, seul un directeur peut corriger.'}
          </p>
        </>
      ) : <p className="aide">Consultation seule : seul le collaborateur, ou un directeur, peut modifier ces informations.</p>}
      <div className="tableau-defilant tableau-suivi">
        <table>
          <thead><tr><th>Jour</th><th>Ticket restaurant</th><th>Télétravail</th><th>Actions</th></tr></thead>
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
    onChange(`${r.modifies} jour${r.modifies > 1 ? 's' : ''} ${champs.teletravail ? 'déclaré' : 'annulé'}${r.modifies > 1 ? 's' : ''} en télétravail`
      + (details.length ? ` (écartés : ${details.join(', ')})` : '')
      + (r.debutEffectif !== r.debutDemande ? `. La série démarre au ${jourCourt(r.debutEffectif)} : les jours antérieurs au mois en cours ne sont modifiables que par un directeur` : '') + '.');
  }

  return (
    <Dialogue titre="Télétravail en série" onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <fieldset>
          <legend>Action</legend>
          <label className="case"><input type="radio" name="serie-action" checked={champs.teletravail} onChange={() => setChamps({ ...champs, teletravail: true })} /> Déclarer du télétravail</label>
          <label className="case"><input type="radio" name="serie-action" checked={!champs.teletravail} onChange={() => setChamps({ ...champs, teletravail: false })} /> Annuler du télétravail déjà déclaré</label>
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
