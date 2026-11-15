import { useState } from 'react';
import { appeler } from '../../api.js';
import { useDonnees, useEnvoi } from '../../donnees.js';
import Cadre from '../../composants/Cadre.jsx';
import Dialogue, { ActionsDialogue } from '../../composants/Dialogue.jsx';

const formatJour = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
const estWeekEnd = (iso) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());

function FormulaireFerie({ ferie, annee, onFermer, onEnregistre }) {
  const creation = !ferie;
  const [jour, setJour] = useState(ferie?.jour ?? `${annee}-01-01`);
  const [libelle, setLibelle] = useState(ferie?.libelle ?? '');
  const { enCours, erreur, envoyer } = useEnvoi();

  async function soumettre(evenement) {
    evenement.preventDefault();
    const reussi = await envoyer(() => (creation
      ? appeler('/admin/jours-feries', { methode: 'POST', corps: { jour, libelle } })
      : appeler(`/admin/jours-feries/${ferie.jour}`, { methode: 'PATCH', corps: { libelle } })));
    if (reussi) onEnregistre(`Le jour férié « ${libelle.trim()} » est ${creation ? 'ajouté' : 'modifié'}.`);
  }

  return (
    <Dialogue titre={creation ? 'Ajouter un jour férié' : 'Modifier le jour férié'} onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <label htmlFor="f-jour">Date</label>
        <input id="f-jour" type="date" required value={jour} disabled={!creation}
          onChange={(e) => setJour(e.target.value)} />
        <label htmlFor="f-libelle">Libellé</label>
        <input id="f-libelle" required maxLength={100} value={libelle} onChange={(e) => setLibelle(e.target.value)} />
        <ActionsDialogue onFermer={onFermer} enCours={enCours} />
      </form>
    </Dialogue>
  );
}

function FormulaireImpose({ impose, annee, equipes, onFermer, onEnregistre }) {
  const creation = !impose;
  const [champs, setChamps] = useState({
    jour: impose?.jour ?? `${annee}-01-01`,
    libelle: impose?.libelle ?? '',
    equipeId: impose?.equipeId ?? '',
    avecDecompte: impose?.avecDecompte ?? true,
  });
  const { enCours, erreur, envoyer } = useEnvoi();

  async function soumettre(evenement) {
    evenement.preventDefault();
    const corps = { ...champs, equipeId: champs.equipeId === '' ? null : Number(champs.equipeId) };
    const reussi = await envoyer(() => (creation
      ? appeler('/admin/jours-imposes', { methode: 'POST', corps })
      : appeler(`/admin/jours-imposes/${impose.id}`, { methode: 'PATCH', corps })));
    if (reussi) onEnregistre(`Le jour « ${champs.libelle.trim()} » est ${creation ? 'ajouté' : 'modifié'}.`);
  }

  return (
    <Dialogue titre={creation ? 'Ajouter un jour imposé' : 'Modifier le jour imposé'} onFermer={onFermer}>
      <form onSubmit={soumettre}>
        {erreur && <p className="message erreur" role="alert">{erreur}</p>}
        <label htmlFor="i-jour">Date</label>
        <input id="i-jour" type="date" required value={champs.jour}
          onChange={(e) => setChamps({ ...champs, jour: e.target.value })} />
        <label htmlFor="i-libelle">Libellé</label>
        <input id="i-libelle" required maxLength={100} placeholder="Pont de l'Ascension" value={champs.libelle}
          onChange={(e) => setChamps({ ...champs, libelle: e.target.value })} />
        <label htmlFor="i-equipe">Concerne</label>
        <select id="i-equipe" value={champs.equipeId} onChange={(e) => setChamps({ ...champs, equipeId: e.target.value })}>
          <option value="">Toute l'entreprise</option>
          {equipes.map((e) => <option key={e.id} value={e.id}>Équipe « {e.nom} » et ses sous-équipes</option>)}
        </select>
        <label className="case">
          <input type="checkbox" checked={champs.avecDecompte}
            onChange={(e) => setChamps({ ...champs, avecDecompte: e.target.checked })} />
          Décompté des congés
        </label>
        <p className="aide">
          Le décompte sur les soldes ne s'appliquera qu'avec la gestion des compteurs.
          Dans tous les cas, ce jour n'est pas compté dans la durée d'une absence.
        </p>
        <ActionsDialogue onFermer={onFermer} enCours={enCours} />
      </form>
    </Dialogue>
  );
}

export default function Calendrier() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const calendrier = useDonnees(`/admin/calendrier?annee=${annee}`);
  const equipes = useDonnees('/admin/equipes');
  const [edition, setEdition] = useState(null); // { sorte: 'ferie' | 'impose', element: objet | null }
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  if (!calendrier.donnees || !equipes.donnees) {
    return <Cadre><p className={calendrier.erreur ? 'message erreur' : 'chargement'}>{calendrier.erreur || equipes.erreur || 'Chargement…'}</p></Cadre>;
  }
  const { joursFeries, joursImposes } = calendrier.donnees;
  const nomEquipe = Object.fromEntries(equipes.donnees.map((e) => [e.id, e.nom]));

  const changerAnnee = (valeur) => { setAnnee(valeur); setInfo(''); setErreur(''); };

  async function action(fonction, message) {
    setInfo('');
    setErreur('');
    try {
      const resultat = await fonction();
      setInfo(typeof message === 'function' ? message(resultat) : message);
      calendrier.recharger();
    } catch (e) {
      setErreur(e.message);
    }
  }

  const supprimerFerie = (f) => window.confirm(`Supprimer le jour férié « ${f.libelle} » ?`)
    && action(() => appeler(`/admin/jours-feries/${f.jour}`, { methode: 'DELETE' }), `« ${f.libelle} » n'est plus férié.`);
  const supprimerImpose = (j) => window.confirm(`Supprimer le jour imposé « ${j.libelle} » ?`)
    && action(() => appeler(`/admin/jours-imposes/${j.id}`, { methode: 'DELETE' }), `« ${j.libelle} » est supprimé.`);
  const retablir = () => action(
    () => appeler('/admin/jours-feries/retablir', { methode: 'POST', corps: { annee } }),
    ({ ajoutes }) => (ajoutes ? `${ajoutes} jour${ajoutes > 1 ? 's' : ''} férié${ajoutes > 1 ? 's' : ''} légal${ajoutes > 1 ? 'aux' : ''} rétabli${ajoutes > 1 ? 's' : ''}.` : 'Tous les jours fériés légaux sont déjà présents.'),
  );

  return (
    <Cadre>
      <div className="entete-page">
        <h1>Calendrier</h1>
        <div className="selecteur-annee">
          <button className="bouton secondaire compact" type="button" onClick={() => changerAnnee(annee - 1)}
            aria-label={`Année ${annee - 1}`}>←</button>
          <strong aria-live="polite">{annee}</strong>
          <button className="bouton secondaire compact" type="button" onClick={() => changerAnnee(annee + 1)}
            aria-label={`Année ${annee + 1}`}>→</button>
        </div>
      </div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      <section aria-labelledby="titre-feries">
        <div className="entete-page">
          <h2 id="titre-feries">Jours fériés</h2>
          <span className="groupe-boutons">
            <button className="bouton secondaire compact" type="button" onClick={retablir}>Rétablir les jours légaux</button>
            <button className="bouton compact" type="button" onClick={() => setEdition({ sorte: 'ferie', element: null })}>Ajouter</button>
          </span>
        </div>
        <p className="aide">Les jours fériés légaux de France métropolitaine sont préremplis. Un jour supprimé n'est pas recréé de lui-même.</p>
        <div className="tableau-defilant">
          <table>
            <thead><tr><th>Date</th><th>Libellé</th><th>Actions</th></tr></thead>
            <tbody>
              {joursFeries.map((f) => (
                <tr key={f.jour}>
                  <td>
                    <span className="majuscule">{formatJour(f.jour)}</span>
                    {estWeekEnd(f.jour) && <span className="pastille">Week-end</span>}
                  </td>
                  <td>{f.libelle}</td>
                  <td className="actions-ligne">
                    <button className="bouton lien" type="button" onClick={() => setEdition({ sorte: 'ferie', element: f })}
                      aria-label={`Modifier le jour férié ${f.libelle}`}>Modifier</button>
                    <button className="bouton lien" type="button" onClick={() => supprimerFerie(f)}
                      aria-label={`Supprimer le jour férié ${f.libelle}`}>Supprimer</button>
                  </td>
                </tr>
              ))}
              {joursFeries.length === 0 && <tr><td colSpan={3} className="vide">Aucun jour férié cette année.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="titre-imposes" className="section-suivante">
        <div className="entete-page">
          <h2 id="titre-imposes">Jours non travaillés imposés</h2>
          <button className="bouton compact" type="button" onClick={() => setEdition({ sorte: 'impose', element: null })}>Ajouter</button>
        </div>
        <p className="aide">Ponts et fermetures, pour toute l'entreprise ou pour une équipe et ses sous-équipes.</p>
        <div className="tableau-defilant">
          <table>
            <thead><tr><th>Date</th><th>Libellé</th><th>Concerne</th><th>Décompté des congés</th><th>Actions</th></tr></thead>
            <tbody>
              {joursImposes.map((j) => (
                <tr key={j.id}>
                  <td><span className="majuscule">{formatJour(j.jour)}</span></td>
                  <td>{j.libelle}</td>
                  <td>{j.equipeId === null ? "Toute l'entreprise" : `${nomEquipe[j.equipeId]} et ses sous-équipes`}</td>
                  <td>{j.avecDecompte ? 'Oui' : 'Non'}</td>
                  <td className="actions-ligne">
                    <button className="bouton lien" type="button" onClick={() => setEdition({ sorte: 'impose', element: j })}
                      aria-label={`Modifier le jour imposé ${j.libelle}`}>Modifier</button>
                    <button className="bouton lien" type="button" onClick={() => supprimerImpose(j)}
                      aria-label={`Supprimer le jour imposé ${j.libelle}`}>Supprimer</button>
                  </td>
                </tr>
              ))}
              {joursImposes.length === 0 && <tr><td colSpan={5} className="vide">Aucun jour imposé cette année.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {edition?.sorte === 'ferie' && (
        <FormulaireFerie ferie={edition.element} annee={annee} onFermer={() => setEdition(null)}
          onEnregistre={(message) => { setEdition(null); setErreur(''); setInfo(message); calendrier.recharger(); }} />
      )}
      {edition?.sorte === 'impose' && (
        <FormulaireImpose impose={edition.element} annee={annee} equipes={equipes.donnees.filter((e) => e.actif)}
          onFermer={() => setEdition(null)}
          onEnregistre={(message) => { setEdition(null); setErreur(''); setInfo(message); calendrier.recharger(); }} />
      )}
    </Cadre>
  );
}
