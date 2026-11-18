import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { appeler } from '../api.js';
import { notifierChangement, useDonnees } from '../donnees.js';
import { aujourdhui } from '../dates.js';
import { formatDuree, formatPeriode } from '../format.js';
import Cadre from '../composants/Cadre.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';
import FormulaireDemande, { initialePourModification } from '../composants/FormulaireDemande.jsx';
import Statut from '../composants/Statut.jsx';
import Soldes from '../composants/Soldes.jsx';

// Ce qui est terminé et sans suite : refusées, retirées, annulées, et les annulations déjà décidées.
const estHistorique = (d) => ['refusee', 'retiree', 'annulee'].includes(d.statut) || (d.nature === 'annulation' && d.statut !== 'en_attente');
const estModifiable = (d) => d.nature === 'absence' && d.statut === 'en_attente' && d.actions.retirer;

export default function MesDemandes() {
  const demandes = useDonnees('/demandes?portee=mes');
  const soldes = useDonnees('/compteurs');
  const rechargerSoldes = soldes.recharger;
  useEffect(() => { rechargerSoldes(); }, [demandes.donnees, rechargerSoldes]); // une demande décidée ou posée change le solde
  const [parametres, setParametres] = useSearchParams();
  const [nouvelle, setNouvelle] = useState(parametres.get('nouvelle') === '1');
  const [detail, setDetail] = useState(null); // { id, mode }
  const [modification, setModification] = useState(null); // la demande en attente qu'on remplace
  const [avecHistorique, setAvecHistorique] = useState(false);
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  const jour = aujourdhui();
  // À venir : celles qui ne sont pas terminées, la plus proche en premier. Passées : les plus récentes en premier.
  const { aVenir, passees, nbHistorique } = useMemo(() => {
    const toutes = demandes.donnees ?? [];
    const visibles = toutes.filter((d) => avecHistorique || !estHistorique(d));
    const parDebut = (a, b) => a.dateDebut.localeCompare(b.dateDebut) || a.id - b.id;
    return {
      aVenir: visibles.filter((d) => d.dateFin >= jour).sort(parDebut),
      passees: visibles.filter((d) => d.dateFin < jour).sort((a, b) => parDebut(b, a)),
      nbHistorique: toutes.filter(estHistorique).length,
    };
  }, [demandes.donnees, avecHistorique, jour]);

  if (!demandes.donnees) {
    return <Cadre><p className={demandes.erreur ? 'message erreur' : 'chargement'}>{demandes.erreur || 'Chargement…'}</p></Cadre>;
  }

  const fermerNouvelle = () => { setNouvelle(false); if (parametres.has('nouvelle')) setParametres({}, { replace: true }); };
  const apres = (message) => { setInfo(message); setErreur(''); demandes.recharger(); };

  async function retirer(d) {
    setInfo('');
    setErreur('');
    if (!window.confirm('Retirer cette demande ?')) return;
    try {
      await appeler(`/demandes/${d.id}/retrait`, { methode: 'POST' });
      notifierChangement();
      apres('La demande est retirée.');
    } catch (e) {
      setErreur(e.message);
      demandes.recharger();
    }
  }

  const ligne = (d) => (
    <tr key={d.id} className={estHistorique(d) ? 'inactif' : undefined}>
      <td>{formatPeriode(d)}</td>
      <td>{d.nature === 'annulation' && <span className="pastille">Annulation</span>} {d.type.libelle}</td>
      <td>{formatDuree(d.dureeDemiJournees)}</td>
      <td><Statut statut={d.statut} /></td>
      <td className="actions-ligne">
        <button className="bouton lien" type="button" onClick={() => setDetail({ id: d.id, mode: null })}
          aria-label={`Détail de la demande du ${d.dateDebut}`}>Détail</button>
        {estModifiable(d) && (
          <button className="bouton lien" type="button" onClick={() => setModification(d)}
            aria-label={`Modifier la demande du ${d.dateDebut}`}>Modifier</button>
        )}
        {d.actions.retirer && (
          <button className="bouton lien" type="button" onClick={() => retirer(d)}
            aria-label={`Retirer la demande du ${d.dateDebut}`}>Retirer</button>
        )}
        {d.actions.annuler && (
          <button className="bouton lien" type="button" onClick={() => setDetail({ id: d.id, mode: 'annulation' })}
            aria-label={`Demander l'annulation de l'absence du ${d.dateDebut}`}>Demander l'annulation</button>
        )}
      </td>
    </tr>
  );

  const groupes = [['À venir', aVenir], ['Passées', passees]].filter(([, liste]) => liste.length > 0);

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Mes demandes</h1>
        <button className="bouton compact" type="button" onClick={() => { setInfo(''); setNouvelle(true); }}>Nouvelle demande</button>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <Soldes donnees={soldes.donnees} peutRecaler onChange={soldes.recharger} />
      {nbHistorique > 0 && (
        <label className="case">
          <input type="checkbox" checked={avecHistorique} onChange={(e) => setAvecHistorique(e.target.checked)} />
          Afficher les demandes refusées, retirées et annulées ({nbHistorique})
        </label>
      )}
      <div className="tableau-defilant">
        <table>
          <thead>
            <tr><th>Période</th><th>Type</th><th>Durée</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {groupes.flatMap(([titre, liste]) => [
              <tr key={`groupe-${titre}`} className="ligne-groupe">
                <th colSpan={5} scope="colgroup">{titre} ({liste.length})</th>
              </tr>,
              ...liste.map(ligne),
            ])}
            {groupes.length === 0 && (
              <tr><td colSpan={5} className="vide">
                {nbHistorique > 0 ? 'Aucune demande en cours.' : 'Aucune demande. Utilisez « Nouvelle demande » pour en créer une.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {nouvelle && (
        <FormulaireDemande onFermer={fermerNouvelle} onEnregistre={(message) => { fermerNouvelle(); apres(message); }} />
      )}
      {modification && (
        <FormulaireDemande
          remplace={modification.id}
          initiale={initialePourModification(modification)}
          onFermer={() => setModification(null)}
          onEnregistre={(message) => { setModification(null); apres(message); }}
        />
      )}
      {detail && (
        <DetailDemande
          id={detail.id}
          modeInitial={detail.mode}
          onFermer={() => setDetail(null)}
          onChange={(message) => { setDetail(null); apres(message); }}
          onModifier={(demande) => { setDetail(null); setModification(demande); }}
        />
      )}
    </Cadre>
  );
}
