import { useState } from 'react';
import { appeler } from '../api.js';
import { useDonnees, useEnvoi, notifierChangement } from '../donnees.js';
import { EVENEMENTS, formatDateHeure, formatDuree, formatPeriode, jourCourt, nomComplet } from '../format.js';
import Couverture from './Couverture.jsx';
import Dialogue from './Dialogue.jsx';
import Statut from './Statut.jsx';

// Détail d'une demande, son journal, et les actions possibles pour la personne connectée.
// `mode` ouvre directement le panneau de refus ou d'annulation.
export default function DetailDemande({ id, modeInitial = null, onFermer, onChange, onModifier = null }) {
  const detail = useDonnees(`/demandes/${id}`);
  const [mode, setMode] = useState(modeInitial); // null | 'refus' | 'annulation'
  const [texte, setTexte] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();
  const demande = detail.donnees;

  async function agir(chemin, corps, message) {
    const reussi = await envoyer(() => appeler(`/demandes/${id}/${chemin}`, { methode: 'POST', corps }));
    if (reussi) { notifierChangement(); onChange(message); }
  }

  const approuver = () => window.confirm('Approuver cette demande ? Cette décision ne pourra pas être modifiée.')
    && agir('decision', { decision: 'approbation' }, 'La demande est approuvée.');
  const retirer = () => window.confirm('Retirer cette demande ?')
    && agir('retrait', undefined, 'La demande est retirée.');

  function confirmer(evenement) {
    evenement.preventDefault();
    if (mode === 'refus') agir('decision', { decision: 'refus', motif: texte }, 'La demande est refusée.');
    else agir('annulation', texte.trim() ? { commentaire: texte } : {}, "La demande d'annulation est envoyée.");
  }

  return (
    <Dialogue titre={demande?.nature === 'annulation' ? "Demande d'annulation" : "Demande d'absence"} onFermer={onFermer}>
      {!demande ? (
        <p className={detail.erreur ? 'message erreur' : 'chargement'}>{detail.erreur || 'Chargement…'}</p>
      ) : (
        <>
          {erreur && <p className="message erreur" role="alert">{erreur}</p>}
          <dl className="fiche fiche-demande">
            <dt>Collaborateur</dt><dd>{nomComplet(demande.collaborateur)} · {demande.equipe.nom}</dd>
            <dt>Type</dt><dd>{demande.type.libelle}</dd>
            <dt>Période</dt><dd>{formatPeriode(demande)}</dd>
            <dt>Durée</dt><dd>{formatDuree(demande.dureeDemiJournees)}</dd>
            <dt>Statut</dt>
            <dd>
              <Statut statut={demande.statut} />
              {demande.statutPar && ` par ${nomComplet(demande.statutPar)}`}
              {demande.annulationEnCours && <span className="pastille">Annulation en cours</span>}
            </dd>
            {demande.motif && (<><dt>Motif du refus</dt><dd>{demande.motif}</dd></>)}
            {demande.commentaire && (<><dt>Commentaire</dt><dd>{demande.commentaire}</dd></>)}
            {demande.demandeAnnuleeId && (<><dt>Concerne</dt><dd>Demande n° {demande.demandeAnnuleeId}</dd></>)}
            {demande.remplaceId && (<><dt>Remplace</dt><dd>Demande n° {demande.remplaceId}, retirée par son auteur</dd></>)}
            {demande.saisiePar.id !== demande.collaborateur.id && (
              <><dt>Saisie par</dt><dd>{nomComplet(demande.saisiePar)}</dd></>
            )}
          </dl>
          {demande.avertissements.length > 0 && (
            <div>
              <h3>Avertissements à la saisie</h3>
              {demande.avertissements.map((a, i) => <p key={i} className="message alerte">{a.message}</p>)}
            </div>
          )}
          {demande.actions.decider && demande.statut === 'en_attente' && <Couverture demandeId={demande.id} />}
          <h3>Historique</h3>
          <ol className="journal">
            {demande.journal.map((e) => (
              <li key={e.id}>
                <span>{EVENEMENTS[e.type]}</span> par {nomComplet(e.auteur)}
                <span className="date-journal"> · {formatDateHeure(e.le)}</span>
                {e.motif && <span className="motif-journal">Motif : {e.motif}</span>}
              </li>
            ))}
          </ol>

          {mode ? (
            <form onSubmit={confirmer}>
              <label htmlFor="d-texte">{mode === 'refus' ? 'Motif du refus (obligatoire)' : 'Commentaire (facultatif)'}</label>
              <textarea id="d-texte" rows={3} maxLength={1000} required={mode === 'refus'} autoFocus
                value={texte} onChange={(e) => setTexte(e.target.value)} />
              {mode === 'annulation' && (
                <p className="aide">
                  L'annulation du {jourCourt(demande.dateDebut)} suivra le même circuit de validation que la demande.
                </p>
              )}
              <div className="actions">
                <button className="bouton secondaire" type="button" onClick={() => { setMode(null); setTexte(''); }}>Retour</button>
                <button className="bouton" type="submit" disabled={enCours}>
                  {mode === 'refus' ? 'Confirmer le refus' : "Demander l'annulation"}
                </button>
              </div>
            </form>
          ) : (
            <div className="actions">
              {onModifier && demande.actions.retirer && demande.statut === 'en_attente' && demande.nature === 'absence' && (
                <button className="bouton secondaire" type="button" onClick={() => onModifier(demande)}>Modifier</button>
              )}
              {demande.actions.retirer && <button className="bouton secondaire" type="button" onClick={retirer} disabled={enCours}>Retirer la demande</button>}
              {demande.actions.annuler && <button className="bouton secondaire" type="button" onClick={() => setMode('annulation')}>Demander l'annulation</button>}
              {demande.actions.decider && <button className="bouton secondaire" type="button" onClick={() => setMode('refus')}>Refuser</button>}
              {demande.actions.decider && <button className="bouton" type="button" onClick={approuver} disabled={enCours}>Approuver</button>}
              <button className="bouton secondaire" type="button" onClick={onFermer}>Fermer</button>
            </div>
          )}
        </>
      )}
    </Dialogue>
  );
}
