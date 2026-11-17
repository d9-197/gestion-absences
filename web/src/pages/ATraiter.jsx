import { useState } from 'react';
import { appeler } from '../api.js';
import { useDonnees, notifierChangement } from '../donnees.js';
import { STATUTS, formatDuree, formatPeriode, nomComplet } from '../format.js';
import Cadre from '../composants/Cadre.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';
import Statut from '../composants/Statut.jsx';

export default function ATraiter() {
  const [filtre, setFiltre] = useState('en_attente');
  const demandes = useDonnees(`/demandes?portee=gerees${filtre ? `&statut=${filtre}` : ''}`);
  const [detail, setDetail] = useState(null); // { id, mode }
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

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

  const fermer = () => setDetail(null);

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Demandes à traiter</h1>
        <div>
          <label htmlFor="filtre" className="etiquette-filtre">Afficher</label>
          <select id="filtre" className="selecteur" value={filtre} onChange={(e) => { setFiltre(e.target.value); setInfo(''); setErreur(''); }}>
            <option value="en_attente">Les demandes en attente</option>
            {Object.entries(STATUTS).filter(([valeur]) => valeur !== 'en_attente').map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>{libelle}s</option>
            ))}
            <option value="">Toutes les demandes</option>
          </select>
        </div>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      {!demandes.donnees ? (
        <p className={demandes.erreur ? 'message erreur' : 'chargement'}>{demandes.erreur || 'Chargement…'}</p>
      ) : (
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr><th>Collaborateur</th><th>Période</th><th>Type</th><th>Durée</th><th>Statut</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {demandes.donnees.map((d) => (
                <tr key={d.id}>
                  <td>{nomComplet(d.collaborateur)}<span className="sous-texte">{d.equipe.nom}</span></td>
                  <td>{formatPeriode(d)}</td>
                  <td>
                    {d.nature === 'annulation' && <span className="pastille">Annulation</span>} {d.type.libelle}
                    {d.avertissements.length > 0 && (
                      <span className="pastille pastille-alerte">{d.avertissements.length} avertissement{d.avertissements.length > 1 ? 's' : ''}</span>
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
              {demandes.donnees.length === 0 && (
                <tr><td colSpan={6} className="vide">{filtre === 'en_attente' ? 'Aucune demande en attente.' : 'Aucune demande.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
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
