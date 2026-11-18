import { useEffect, useState } from 'react';
import { appeler, enregistrerFichier, telecharger } from '../api.js';
import { moisCourant } from '../dates.js';
import { useDonnees, useEnvoi } from '../donnees.js';
import { nomComplet } from '../format.js';
import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';

const nombre = (n) => n.toLocaleString('fr-FR');
const texteMois = ({ annee, mois }) => `${annee}-${String(mois + 1).padStart(2, "0")}`;
const libelleMois = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Fiche RH mensuelle : compteurs à l'écran, PDF avec le calendrier du mois, pour soi ou, en masse, pour ses collaborateurs.
export default function FichesRh() {
  const { utilisateur } = useSession();
  const valideur = utilisateur.role !== 'collaborateur';
  const personnes = useDonnees(valideur ? '/demandes/collaborateurs' : '/auth/moi');
  const [mois, setMois] = useState(texteMois(moisCourant()));
  const [collaborateurId, setCollaborateurId] = useState(utilisateur.id);
  const [fiche, setFiche] = useState(null);
  const [erreurFiche, setErreurFiche] = useState('');
  const [info, setInfo] = useState('');
  const [versionCloture, setVersionCloture] = useState(0);
  const { enCours, erreur, envoyer } = useEnvoi();

  useEffect(() => {
    let annule = false;
    setFiche(null);
    setErreurFiche('');
    appeler(`/fiches-rh?mois=${mois}&collaborateurId=${collaborateurId}`)
      .then((f) => { if (!annule) setFiche(f); })
      .catch((e) => { if (!annule) setErreurFiche(e.message); });
    return () => { annule = true; };
  }, [mois, collaborateurId, versionCloture]);

  const directeur = utilisateur.role === 'directeur';
  const [cloture, setCloture] = useState(undefined); // undefined : inconnu ; null : mois ouvert
  useEffect(() => {
    if (!directeur) return undefined;
    let annule = false;
    setCloture(undefined);
    appeler(`/fiches-rh/cloture?mois=${mois}`).then((r) => { if (!annule) setCloture(r.cloture); }).catch(() => {});
    return () => { annule = true; };
  }, [mois, directeur, versionCloture]);
  const moisTermine = mois < texteMois(moisCourant());
  const actualiser = () => { setVersionCloture((v) => v + 1); };

  const cloturer = () => envoyer(async () => {
    setInfo('');
    let confirmer = false;
    try {
      await appeler('/fiches-rh/cloture', { methode: 'POST', corps: { mois } });
    } catch (e) {
      if (e.statut !== 409 || !/en attente/.test(e.message) || !window.confirm(`${e.message}.`)) throw e;
      confirmer = true;
    }
    if (confirmer) await appeler('/fiches-rh/cloture', { methode: 'POST', corps: { mois, confirmerProvisoire: true } });
    setInfo(`${libelleMois(mois)} est clôturé : les fiches sont figées.`);
    actualiser();
  });
  const rouvrir = () => {
    if (!window.confirm(`Rouvrir ${libelleMois(mois)} ? Les fiches seront de nouveau recalculées et les saisies TT/TR redeviennent possibles.`)) return;
    envoyer(async () => {
      setInfo('');
      await appeler('/fiches-rh/reouverture', { methode: 'POST', corps: { mois } });
      setInfo(`${libelleMois(mois)} est rouvert.`);
      actualiser();
    });
  };

  const liste = valideur ? (personnes.donnees ?? []) : [];
  const pdf = (ids) => envoyer(async () => {
    setInfo('');
    const fichier = await telecharger(`/fiches-rh/pdf?mois=${mois}&collaborateurIds=${ids.join(',')}`);
    enregistrerFichier(fichier);
    setInfo(`${ids.length > 1 ? `${ids.length} fiches` : 'La fiche'} de ${libelleMois(mois)} ${ids.length > 1 ? 'sont téléchargées' : 'est téléchargée'} dans ${fichier.nom}.`);
  });

  const c = fiche?.compteurs;
  return (
    <Cadre>
      <div className="entete-page"><h1>Fiche RH du mois</h1></div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}
      <div className="barre-outils">
        <div>
          <label htmlFor="fiche-mois">Mois</label>
          <input id="fiche-mois" type="month" required value={mois} onChange={(e) => e.target.value && setMois(e.target.value)} />
        </div>
        {valideur && (
          <div>
            <label htmlFor="fiche-personne">Salarié</label>
            <select id="fiche-personne" value={collaborateurId} onChange={(e) => setCollaborateurId(Number(e.target.value))}>
              {liste.map((p) => <option key={p.id} value={p.id}>{nomComplet(p)}{p.moi ? ' (moi)' : ''}</option>)}
            </select>
          </div>
        )}
        <button className="bouton compact" type="button" disabled={enCours} onClick={() => pdf([collaborateurId])}>Télécharger la fiche (PDF)</button>
        {valideur && liste.length > 1 && (
          <button className="bouton secondaire compact" type="button" disabled={enCours} onClick={() => pdf(liste.map((p) => p.id))}>
            Télécharger les {liste.length} fiches (PDF)
          </button>
        )}
      </div>
      {directeur && cloture !== undefined && (
        <p className={cloture ? 'message succes' : 'aide'}>
          {cloture
            ? <>Mois clôturé le {new Date(cloture.le).toLocaleString('fr-FR')} par {cloture.par} : les fiches sont figées et les saisies TT/TR sont bloquées. </>
            : <>Mois ouvert : les fiches sont recalculées à chaque consultation. </>}
          {cloture
            ? <button className="bouton secondaire compact" type="button" disabled={enCours} onClick={rouvrir}>Rouvrir le mois</button>
            : moisTermine
              ? <button className="bouton compact" type="button" disabled={enCours} onClick={cloturer}>Clôturer le mois</button>
              : <em>(clôture possible une fois le mois terminé)</em>}
        </p>
      )}
      <p className="aide">
        Le PDF contient le calendrier du mois (absences, TT télétravail, TR tickets restaurant) et les compteurs. Les données ne sont conservées que pendant la durée
        de conservation réglée par la direction : téléchargez la fiche d'un mois avant qu'il n'en sorte, si vous devez la garder.
      </p>
      {erreurFiche && <p className="message erreur" role="alert">{erreurFiche}</p>}
      {!fiche && !erreurFiche && <p className="chargement">Chargement…</p>}
      {fiche && (
        <section aria-labelledby="titre-fiche">
          <h2 id="titre-fiche">{nomComplet(fiche.collaborateur)} · {libelleMois(fiche.mois)}</h2>
          {fiche.figee && <p className="message succes">Fiche figée à la clôture du mois, le {new Date(fiche.figee.le).toLocaleString('fr-FR')} par {fiche.figee.par}.</p>}
          {c.provisoire && (
            <p className="message alerte">
              Fiche provisoire : {nombre(c.absencesEnAttente)} jour(s) d'absence attendent une décision et ne sont comptés ni comme travaillés ni comme absents.
            </p>
          )}
          <div className="cartes">
            <table>
              <caption className="visuellement-cache">Jours et tickets</caption>
              <tbody>
                <tr><th scope="row">Jours ouvrés du mois</th><td className="nombre">{nombre(c.joursOuvres)}</td></tr>
                <tr><th scope="row">Jours travaillés</th><td className="nombre"><strong>{nombre(c.joursTravailles)}</strong></td></tr>
                <tr><th scope="row">dont en télétravail (TT)</th><td className="nombre">{nombre(c.teletravail)}</td></tr>
                <tr><th scope="row">dont sur site</th><td className="nombre">{nombre(c.surSite)}</td></tr>
                <tr><th scope="row">Tickets restaurant (TR)</th><td className="nombre"><strong>{c.tickets}</strong></td></tr>
                <tr><th scope="row">TR retirés par le salarié</th><td className="nombre">{c.ticketsRetires}</td></tr>
              </tbody>
            </table>
            <table>
              <caption className="visuellement-cache">Absences confirmées</caption>
              <tbody>
                {c.absences.map((a) => <tr key={a.typeId}><th scope="row">{a.libelle}</th><td className="nombre">{nombre(a.jours)}</td></tr>)}
                {c.absencesEnAttente > 0 && <tr><th scope="row">Demandes en attente (non comptées)</th><td className="nombre">{nombre(c.absencesEnAttente)}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Cadre>
  );
}
