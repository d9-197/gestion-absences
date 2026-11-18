import { useState } from 'react';
import { appeler, BASE } from '../../api.js';
import { useDonnees, useEnvoi, notifierChangement } from '../../donnees.js';
import { formatDateHeure } from '../../format.js';
import Cadre from '../../composants/Cadre.jsx';

const STATUTS = { echec: 'En échec', en_attente: 'En attente', envoye: 'Envoyés' };

function ReglagePdf({ parametres, onEnregistre }) {
  const [raisonSociale, setRaisonSociale] = useState(parametres.raisonSociale);
  const [mentions, setMentions] = useState(parametres.mentions);
  const { enCours, erreur, envoyer } = useEnvoi();

  async function soumettre(evenement) {
    evenement.preventDefault();
    const reussi = await envoyer(() => appeler('/admin/parametres-pdf', { methode: 'PUT', corps: { raisonSociale, mentions } }));
    if (reussi) onEnregistre('Les mentions du PDF sont enregistrées. Elles s\'appliqueront aux prochains envois.');
  }

  return (
    <form onSubmit={soumettre} className="formulaire-large">
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <label htmlFor="pdf-raison">Raison sociale (en-tête du PDF)</label>
      <input id="pdf-raison" maxLength={150} value={raisonSociale} onChange={(e) => setRaisonSociale(e.target.value)} />
      <label htmlFor="pdf-mentions">Mentions (en bas du PDF)</label>
      <textarea id="pdf-mentions" rows={4} maxLength={2000} value={mentions} aria-describedby="aide-mentions"
        onChange={(e) => setMentions(e.target.value)} />
      <p id="aide-mentions" className="aide">Adresse, mentions légales, durée de conservation… Communes à tous les types d'absence.</p>
      <div className="actions">
        <a className="bouton secondaire" href={`${BASE}/api/admin/parametres-pdf/apercu`} target="_blank" rel="noopener">
          Voir un exemple de PDF
        </a>
        <button className="bouton" type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </form>
  );
}

function ReglageNotifications({ reglages, onEnregistre }) {
  const [mode, setMode] = useState(reglages.mode);
  const [relance, setRelance] = useState(reglages.relanceJours);
  const { enCours, erreur, envoyer } = useEnvoi();

  async function soumettre(evenement) {
    evenement.preventDefault();
    const reussi = await envoyer(() => appeler('/admin/notifications', { methode: 'PUT', corps: { mode, relanceJours: Number(relance) } }));
    if (reussi) onEnregistre('Les réglages de notification sont enregistrés.');
  }

  return (
    <form onSubmit={soumettre} className="formulaire-large">
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <fieldset>
        <legend>Demandes à traiter</legend>
        <label className="case">
          <input type="radio" name="mode" checked={mode === 'immediat'} onChange={() => setMode('immediat')} />
          Un e-mail à chaque demande
        </label>
        <label className="case">
          <input type="radio" name="mode" checked={mode === 'quotidien'} onChange={() => setMode('quotidien')} />
          Un résumé par jour ouvré, vers 7 h (heure de Paris), au lieu d'un e-mail par demande
        </label>
      </fieldset>
      <label htmlFor="relance-jours">Relancer après (jours, 0 = jamais)</label>
      <input id="relance-jours" type="number" min={0} max={reglages.relanceJoursMax} value={relance} onChange={(e) => setRelance(e.target.value)} />
      <p className="aide">
        Une demande sans décision après ce délai est rappelée au valideur concerné, dans le résumé du matin. Après le double de ce délai,
        les valideurs de l'échelon supérieur et les directeurs sont relancés aussi. Les e-mails de décision et leurs PDF partent toujours aussitôt.
      </p>
      <div className="actions"><button className="bouton" type="submit" disabled={enCours}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </form>
  );
}

export default function Emails() {
  const notifications = useDonnees('/admin/notifications');
  const parametres = useDonnees('/admin/parametres-pdf');
  const [statut, setStatut] = useState('echec');
  const envois = useDonnees(`/admin/envois-email?statut=${statut}`);
  const [info, setInfo] = useState('');
  const [erreur, setErreur] = useState('');

  if (!parametres.donnees || !notifications.donnees) {
    return <Cadre><p className={parametres.erreur || notifications.erreur ? 'message erreur' : 'chargement'}>{parametres.erreur || notifications.erreur || 'Chargement…'}</p></Cadre>;
  }

  async function relancer(chemin, message) {
    setInfo('');
    setErreur('');
    try {
      const resultat = await appeler(chemin, { methode: 'POST' });
      setInfo(typeof message === 'function' ? message(resultat) : message);
      notifierChangement();
    } catch (e) {
      setErreur(e.message);
    }
    envois.recharger();
  }

  const relancerTout = () => relancer(
    '/admin/envois-email/relancer',
    ({ relances }) => `${relances} envoi${relances > 1 ? 's' : ''} remis en file : ${relances > 1 ? 'ils partiront' : 'il partira'} dans les secondes qui viennent.`,
  );

  return (
    <Cadre>
      <div className="entete-page"><h1>E-mails et PDF</h1></div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      <section aria-labelledby="titre-notifications">
        <h2 id="titre-notifications">Notifications aux valideurs</h2>
        <ReglageNotifications reglages={notifications.donnees} onEnregistre={(message) => { setErreur(''); setInfo(message); }} />
      </section>

      <section aria-labelledby="titre-pdf" className="section-suivante">
        <h2 id="titre-pdf">Contenu du PDF de décision</h2>
        <p className="aide">
          À chaque décision, un PDF récapitulatif part par e-mail au collaborateur, au valideur et aux directeurs :
          c'est la copie de référence, hors de l'outil.
        </p>
        <ReglagePdf parametres={parametres.donnees} onEnregistre={(message) => { setErreur(''); setInfo(message); }} />
      </section>

      <section aria-labelledby="titre-envois" className="section-suivante">
        <div className="entete-page">
          <h2 id="titre-envois">Envois d'e-mails</h2>
          <div>
            <label htmlFor="filtre-envois" className="etiquette-filtre">Afficher</label>
            <select id="filtre-envois" className="selecteur" value={statut}
              onChange={(e) => { setStatut(e.target.value); setInfo(''); setErreur(''); }}>
              {Object.entries(STATUTS).map(([valeur, libelle]) => <option key={valeur} value={valeur}>{libelle}</option>)}
            </select>
          </div>
        </div>
        {statut === 'echec' && envois.donnees?.length > 0 && (
          <p><button className="bouton compact" type="button" onClick={relancerTout}>Relancer tous les envois en échec</button></p>
        )}
        {!envois.donnees ? (
          <p className={envois.erreur ? 'message erreur' : 'chargement'}>{envois.erreur || 'Chargement…'}</p>
        ) : (
          <div className="tableau-defilant">
            <table>
              <thead>
                <tr>
                  <th>{statut === 'envoye' ? 'Envoyé le' : 'Créé le'}</th><th>Destinataire</th><th>Objet</th>
                  <th>{statut === 'envoye' ? 'PDF' : 'Tentatives'}</th>{statut !== 'envoye' && <th>Dernière erreur</th>}
                  {statut === 'echec' && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {envois.donnees.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateHeure(statut === 'envoye' ? e.envoyeLe : e.creeLe)}</td>
                    <td>{e.destinataire}</td>
                    <td>{e.sujet}</td>
                    <td>{statut === 'envoye' ? (e.avecPdf ? 'Joint' : '—') : e.tentatives}</td>
                    {statut !== 'envoye' && <td>{e.derniereErreur ?? '—'}</td>}
                    {statut === 'echec' && (
                      <td className="actions-ligne">
                        <button className="bouton lien" type="button"
                          onClick={() => relancer(`/admin/envois-email/${e.id}/relancer`, "L'envoi est remis en file.")}
                          aria-label={`Relancer l'envoi à ${e.destinataire}`}>Relancer</button>
                      </td>
                    )}
                  </tr>
                ))}
                {envois.donnees.length === 0 && (
                  <tr><td colSpan={6} className="vide">
                    {statut === 'echec' ? 'Aucun envoi en échec.' : statut === 'en_attente' ? 'Aucun envoi en attente.' : 'Aucun envoi.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Cadre>
  );
}
