import { useMemo, useState } from 'react';
import { appeler } from '../api.js';
import { useDonnees, useEnvoi, notifierChangement } from '../donnees.js';
import { STATUTS, formatDuree, formatPeriode, nomComplet } from '../format.js';
import Cadre from '../composants/Cadre.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';
import Dialogue from '../composants/Dialogue.jsx';
import Statut from '../composants/Statut.jsx';

const TRIS = {
  urgence: ['Début le plus proche', (a, b) => a.dateDebut.localeCompare(b.dateDebut) || a.id - b.id],
  ancienne: ['Reçues depuis le plus longtemps', (a, b) => a.soumiseLe.localeCompare(b.soumiseLe) || a.id - b.id],
  recente: ['Reçues le plus récemment', (a, b) => b.soumiseLe.localeCompare(a.soumiseLe) || b.id - a.id],
};
const ordre = new Intl.Collator('fr', { sensitivity: 'base' });
// Approuvable en lot : une demande à traiter qui ne porte aucun avertissement.
const approuvableEnLot = (d) => d.actions.decider && d.statut === 'en_attente' && d.avertissements.length === 0;

export default function ATraiter() {
  const [filtre, setFiltre] = useState('en_attente');
  const demandes = useDonnees(`/demandes?portee=gerees${filtre ? `&statut=${filtre}` : ''}`);
  const [tri, setTri] = useState('urgence');
  const [equipe, setEquipe] = useState('');
  const [personne, setPersonne] = useState('');
  const [selection, setSelection] = useState(() => new Set());
  const [confirmationLot, setConfirmationLot] = useState(false);
  const [detail, setDetail] = useState(null); // { id, mode }
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');
  const lot = useEnvoi();

  const toutes = demandes.donnees ?? [];
  const equipes = useMemo(() => [...new Map(toutes.map((d) => [d.equipe.id, d.equipe.nom]))].sort((a, b) => ordre.compare(a[1], b[1])), [toutes]);
  const personnes = useMemo(
    () => [...new Map(toutes.filter((d) => !equipe || d.equipe.id === Number(equipe)).map((d) => [d.collaborateur.id, nomComplet(d.collaborateur)]))]
      .sort((a, b) => ordre.compare(a[1], b[1])),
    [toutes, equipe],
  );
  const visibles = useMemo(
    () => toutes
      .filter((d) => (!equipe || d.equipe.id === Number(equipe)) && (!personne || d.collaborateur.id === Number(personne)))
      .sort(TRIS[tri][1]),
    [toutes, equipe, personne, tri],
  );
  const selectionnables = visibles.filter(approuvableEnLot);
  // La sélection ne garde que ce qui est encore visible et approuvable (un filtre ou un rechargement peut en retirer).
  const choisies = selectionnables.filter((d) => selection.has(d.id));

  async function approuver(d) {
    setInfo('');
    setErreur('');
    if (!window.confirm(`Approuver la demande de ${nomComplet(d.collaborateur)} ? Cette décision ne pourra pas être modifiée.`)) return;
    try {
      await appeler(`/demandes/${d.id}/decision`, { methode: 'POST', corps: { decision: 'approbation' } });
      setInfo(`La demande de ${nomComplet(d.collaborateur)} est approuvée.`);
      notifierChangement();
    } catch (e) {
      setErreur(e.message);
    }
    demandes.recharger();
  }

  async function approuverLot() {
    setInfo('');
    setErreur('');
    const reussi = await lot.envoyer(async () => {
      const r = await appeler('/demandes/decision-lot', { methode: 'POST', corps: { ids: choisies.map((d) => d.id) } });
      setInfo(`${r.approuvees.length} demande${r.approuvees.length > 1 ? 's approuvées' : ' approuvée'}.`
        + (r.ignorees.length ? ` ${r.ignorees.length} non traitée${r.ignorees.length > 1 ? 's' : ''} : ${r.ignorees.map((i) => `n° ${i.id} (${i.raison.toLowerCase()})`).join(', ')}.` : ''));
    });
    setConfirmationLot(false);
    setSelection(new Set());
    if (reussi) notifierChangement();
    demandes.recharger();
  }

  const basculer = (id) => setSelection((avant) => { const n = new Set(avant); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toutBasculer = () => setSelection(choisies.length === selectionnables.length ? new Set() : new Set(selectionnables.map((d) => d.id)));
  const fermer = () => setDetail(null);
  const enAttente = filtre === 'en_attente';

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Demandes à traiter</h1>
      </div>
      <div className="barre-outils">
        <div>
          <label htmlFor="filtre" className="etiquette-filtre">Afficher</label>
          <select id="filtre" className="selecteur" value={filtre} onChange={(e) => { setFiltre(e.target.value); setSelection(new Set()); setInfo(''); setErreur(''); }}>
            <option value="en_attente">Les demandes en attente</option>
            {Object.entries(STATUTS).filter(([valeur]) => valeur !== 'en_attente').map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>{libelle}s</option>
            ))}
            <option value="">Toutes les demandes</option>
          </select>
        </div>
        <div>
          <label htmlFor="tri" className="etiquette-filtre">Trier par</label>
          <select id="tri" className="selecteur" value={tri} onChange={(e) => setTri(e.target.value)}>
            {Object.entries(TRIS).map(([cle, [libelle]]) => <option key={cle} value={cle}>{libelle}</option>)}
          </select>
        </div>
        {equipes.length > 1 && (
          <div>
            <label htmlFor="filtre-equipe" className="etiquette-filtre">Équipe</label>
            <select id="filtre-equipe" className="selecteur" value={equipe} onChange={(e) => { setEquipe(e.target.value); setPersonne(''); }}>
              <option value="">Toutes les équipes</option>
              {equipes.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
            </select>
          </div>
        )}
        {personnes.length > 1 && (
          <div>
            <label htmlFor="filtre-personne" className="etiquette-filtre">Personne</label>
            <select id="filtre-personne" className="selecteur" value={personne} onChange={(e) => setPersonne(e.target.value)}>
              <option value="">Toutes les personnes</option>
              {personnes.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
            </select>
          </div>
        )}
        {enAttente && selectionnables.length > 0 && (
          <button className="bouton compact" type="button" disabled={choisies.length === 0} onClick={() => setConfirmationLot(true)}>
            Approuver la sélection ({choisies.length})
          </button>
        )}
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {!demandes.donnees ? (
        <p className={demandes.erreur ? 'message erreur' : 'chargement'}>{demandes.erreur || 'Chargement…'}</p>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                <th className="colonne-case">
                  {enAttente && selectionnables.length > 0 && (
                    <input type="checkbox" aria-label="Sélectionner toutes les demandes sans avertissement"
                      checked={choisies.length === selectionnables.length} onChange={toutBasculer} />
                  )}
                </th>
                <th>Collaborateur</th><th>Période</th><th>Type</th><th>Durée</th><th>Statut</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => (
                <tr key={d.id}>
                  <td className="colonne-case">
                    {approuvableEnLot(d) && (
                      <input type="checkbox" checked={selection.has(d.id)} onChange={() => basculer(d.id)}
                        aria-label={`Sélectionner la demande de ${nomComplet(d.collaborateur)} du ${d.dateDebut}`} />
                    )}
                  </td>
                  <td>{nomComplet(d.collaborateur)}<span className="sous-texte">{d.equipe.nom}</span></td>
                  <td>{formatPeriode(d)}</td>
                  <td>
                    {d.nature === 'annulation' && <span className="pastille">Annulation</span>} {d.type.libelle}
                    {d.avertissements.length > 0 && (
                      <span className="pastille pastille-alerte">{d.avertissements.length} avertissement{d.avertissements.length > 1 ? 's' : ''}</span>
                    )}
                    {d.collegueAbsents > 0 && (
                      <span className="pastille pastille-alerte">{d.collegueAbsents} collègue{d.collegueAbsents > 1 ? 's' : ''} déjà absent{d.collegueAbsents > 1 ? 's' : ''}</span>
                    )}
                  </td>
                  <td>{formatDuree(d.dureeDemiJournees)}</td>
                  <td><Statut statut={d.statut} /></td>
                  <td className="actions-ligne">
                    {d.actions.decider && (
                      <>
                        <button className="bouton lien" type="button" onClick={() => approuver(d)}
                          aria-label={`Approuver la demande de ${nomComplet(d.collaborateur)}`}>Approuver</button>
                        <button className="bouton lien" type="button" onClick={() => setDetail({ id: d.id, mode: 'refus' })}
                          aria-label={`Refuser la demande de ${nomComplet(d.collaborateur)}`}>Refuser</button>
                      </>
                    )}
                    <button className="bouton lien" type="button" onClick={() => setDetail({ id: d.id, mode: null })}
                      aria-label={`Détail de la demande de ${nomComplet(d.collaborateur)}`}>Détail</button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr><td colSpan={7} className="vide">{enAttente ? 'Aucune demande en attente.' : 'Aucune demande.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {confirmationLot && (
        <Dialogue titre={`Approuver ${choisies.length} demande${choisies.length > 1 ? 's' : ''}`} onFermer={() => setConfirmationLot(false)}>
          <p>Ces décisions ne pourront pas être modifiées. Seules des demandes sans avertissement sont comprises dans la sélection.</p>
          <ul className="liste-simple">
            {choisies.map((d) => <li key={d.id}>{nomComplet(d.collaborateur)} : {formatPeriode(d)}, {d.type.libelle}, {formatDuree(d.dureeDemiJournees)}</li>)}
          </ul>
          {lot.erreur && <p className="message erreur" role="alert">{lot.erreur}</p>}
          <div className="actions">
            <button className="bouton secondaire" type="button" onClick={() => setConfirmationLot(false)}>Retour</button>
            <button className="bouton" type="button" onClick={approuverLot} disabled={lot.enCours}>Confirmer l'approbation</button>
          </div>
        </Dialogue>
      )}
      {detail && (
        <DetailDemande
          id={detail.id}
          modeInitial={detail.mode}
          onFermer={fermer}
          onChange={(message) => { fermer(); setInfo(message); setErreur(''); demandes.recharger(); }}
        />
      )}
    </Cadre>
  );
}
