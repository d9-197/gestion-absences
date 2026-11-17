import { useEffect, useMemo, useRef, useState } from 'react';
import { useDonnees } from '../donnees.js';
import { aujourdhui, estWeekEnd, initialeJour, joursDuMois, libelleMois, moisCourant, moisSuivant, numeroDemiJournee } from '../dates.js';
import { formatPeriode, jourCourt, nomComplet } from '../format.js';
import { useSession } from '../session.jsx';
import Cadre from '../composants/Cadre.jsx';
import DetailDemande from '../composants/DetailDemande.jsx';

const NOMBRE_COULEURS = 8;
const STATUTS = { confirmee: 'Confirmée', en_attente: 'En attente' };

// Pour chaque demi-journée du mois, l'absence qui l'occupe (la confirmée l'emporte sur celle en attente).
function creneauxDe(personne, premier, nombre) {
  const creneaux = new Array(nombre).fill(null);
  const ordre = [...personne.absences].sort((a, b) => (a.statut === 'en_attente' ? 0 : 1) - (b.statut === 'en_attente' ? 0 : 1));
  for (const absence of ordre) {
    const debut = Math.max(numeroDemiJournee(absence.dateDebut, absence.debutDemiJournee) - premier, 0);
    const fin = Math.min(numeroDemiJournee(absence.dateFin, absence.finDemiJournee) - premier, nombre - 1);
    for (let i = debut; i <= fin; i++) creneaux[i] = absence;
  }
  return creneaux;
}

const classeCouleur = (absence, types) => {
  if (!absence.type) return 'type-cache';
  return `type-${Math.max(types.findIndex((t) => t.id === absence.type.id), 0) % NOMBRE_COULEURS}`;
};

export default function Planning() {
  const { utilisateur } = useSession();
  const [mois, setMois] = useState(moisCourant);
  const [vue, setVue] = useState('calendrier');
  const [equipe, setEquipe] = useState('');
  const [detail, setDetail] = useState(null);
  const [info, setInfo] = useState('');

  const jours = useMemo(() => joursDuMois(mois.annee, mois.mois), [mois]);
  const debut = jours[0];
  const fin = jours[jours.length - 1];
  const planning = useDonnees(`/planning?debut=${debut}&fin=${fin}`);
  const aujourdhuiIso = aujourdhui();
  const defilement = useRef(null);
  const donnees = planning.donnees?.debut === debut ? planning.donnees : null; // pas de données d'un autre mois

  const lignes = useMemo(() => {
    if (!donnees) return [];
    const premier = numeroDemiJournee(debut, 'matin');
    return donnees.personnes
      .filter((p) => !equipe || p.equipeId === Number(equipe))
      .map((p) => ({ personne: p, creneaux: creneauxDe(p, premier, jours.length * 2) }));
  }, [donnees, equipe, debut, jours]);

  // Sur un petit écran, la grille s'ouvre sur aujourd'hui plutôt que sur le 1er du mois.
  useEffect(() => {
    const conteneur = defilement.current;
    if (!conteneur) return;
    const colonne = conteneur.querySelector('th.aujourdhui');
    conteneur.scrollLeft = colonne ? Math.max(0, colonne.offsetLeft - conteneur.clientWidth / 2) : 0;
  }, [donnees, vue]);

  const seul = utilisateur.role === 'collaborateur';
  const titre = seul ? 'Mon planning' : 'Planning';
  const changerMois = (pas) => { setMois(moisSuivant(mois, pas)); setInfo(''); };

  function libelleAbsence(personne, absence, jour, moitie) {
    const type = absence.type ? absence.type.libelle : 'Absent';
    return `${nomComplet(personne)} : ${type}, ${jourCourt(jour)} ${moitie === 0 ? 'matin' : 'après-midi'}, ${STATUTS[absence.statut].toLowerCase()}`;
  }

  const ferie = new Map((donnees?.joursFeries ?? []).map((j) => [j.jour, j.libelle]));
  const nomEquipe = Object.fromEntries((donnees?.equipes ?? []).map((e) => [e.id, e.nom]));

  const grille = donnees && (
    <div className="planning-defilant" ref={defilement}>
      <table className="planning">
        <caption className="visuellement-cache">{`${titre}, ${libelleMois(mois)}`}</caption>
        <thead>
          <tr>
            <th className="nom" scope="col"><span className="visuellement-cache">Collaborateur</span></th>
            {jours.map((jour) => (
              <th key={jour} colSpan={2} scope="col"
                className={`jour${estWeekEnd(jour) ? ' we' : ''}${ferie.has(jour) ? ' ferie' : ''}${jour === aujourdhuiIso ? ' aujourdhui' : ''}`}
                title={ferie.get(jour) ? `${jourCourt(jour)} : ${ferie.get(jour)}` : jourCourt(jour)}>
                <span className="jour-sem" aria-hidden="true">{initialeJour(jour)}</span>
                <span className="jour-num">{Number(jour.slice(8))}</span>
                {ferie.has(jour) && <span className="visuellement-cache"> (férié : {ferie.get(jour)})</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map(({ personne, creneaux }, indice) => {
            const imposes = new Map((donnees.imposesParEquipe[personne.equipeId] ?? []).map((j) => [j.jour, j.libelle]));
            const nouvelleEquipe = indice === 0 || lignes[indice - 1].personne.equipeId !== personne.equipeId;
            return [
              nouvelleEquipe && !seul && (
                <tr key={`equipe-${personne.equipeId}-${personne.id}`} className="ligne-equipe">
                  <th scope="row" className="nom nom-equipe">{nomEquipe[personne.equipeId]}</th>
                  <td colSpan={jours.length * 2} />
                </tr>
              ),
              <tr key={personne.id} className={personne.actif ? undefined : 'inactif'}>
                <th scope="row" className="nom" title={nomComplet(personne)}>
                  {nomComplet(personne)}{!personne.actif && <span className="pastille">Désactivé</span>}
                </th>
                {jours.flatMap((jour, i) => [0, 1].map((moitie) => {
                  const absence = creneaux[i * 2 + moitie];
                  const classes = ['cellule', moitie === 0 ? 'debut-jour' : '',
                    estWeekEnd(jour) ? 'we' : '', ferie.has(jour) ? 'ferie' : '', imposes.has(jour) ? 'impose' : '',
                    jour === aujourdhuiIso ? 'aujourdhui' : ''].filter(Boolean).join(' ');
                  const raison = ferie.get(jour) ?? imposes.get(jour);
                  if (!absence) return <td key={`${jour}-${moitie}`} className={classes} title={raison} />;
                  const etiquette = libelleAbsence(personne, absence, jour, moitie);
                  const apparence = `abs ${classeCouleur(absence, donnees.types)}${absence.statut === 'en_attente' ? ' attente' : ''}`;
                  return (
                    <td key={`${jour}-${moitie}`} className={classes}>
                      {absence.demandeId ? (
                        <button type="button" className={apparence} title={etiquette} aria-label={etiquette}
                          onClick={() => setDetail(absence.demandeId)} />
                      ) : (
                        <span className={apparence} title={etiquette} role="img" aria-label={etiquette} />
                      )}
                    </td>
                  );
                })).flat()}
              </tr>,
            ];
          })}
          {lignes.length === 0 && <tr><td colSpan={jours.length * 2 + 1} className="vide">Aucun collaborateur à afficher.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  // Vue en liste : les mêmes absences, sous forme de tableau.
  const liste = donnees && (
    <div className="tableau-defilant">
      <table>
        <thead><tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>
          {lignes.flatMap(({ personne }) => personne.absences.map((a, i) => (
            <tr key={`${personne.id}-${i}`}>
              <td>{nomComplet(personne)}{!seul && <span className="sous-texte">{nomEquipe[personne.equipeId]}</span>}</td>
              <td>{a.type ? a.type.libelle : 'Absent'}</td>
              <td>{formatPeriode(a)}</td>
              <td><span className={`statut ${a.statut === 'en_attente' ? 'statut-en_attente' : 'statut-approuvee'}`}>{STATUTS[a.statut]}</span></td>
              <td className="actions-ligne">
                {a.demandeId && (
                  <button className="bouton lien" type="button" onClick={() => setDetail(a.demandeId)}
                    aria-label={`Détail de l'absence de ${nomComplet(personne)} du ${a.dateDebut}`}>Détail</button>
                )}
              </td>
            </tr>
          )))}
          {lignes.every(({ personne }) => personne.absences.length === 0) && (
            <tr><td colSpan={5} className="vide">Aucune absence ce mois-ci.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <Cadre large>
      <div className="entete-page">
        <h1>{titre}</h1>
        <div className="navigation-mois">
          <button className="bouton secondaire compact" type="button" onClick={() => changerMois(-1)}
            aria-label={`Mois précédent, ${libelleMois(moisSuivant(mois, -1))}`}>←</button>
          <h2 aria-live="polite">{libelleMois(mois)}</h2>
          <button className="bouton secondaire compact" type="button" onClick={() => changerMois(1)}
            aria-label={`Mois suivant, ${libelleMois(moisSuivant(mois, 1))}`}>→</button>
          <button className="bouton secondaire compact" type="button" onClick={() => { setMois(moisCourant()); setInfo(''); }}>Aujourd'hui</button>
        </div>
      </div>

      <div className="barre-planning">
        {donnees && donnees.equipes.length > 1 && (
          <div>
            <label htmlFor="filtre-equipe" className="etiquette-filtre">Équipe</label>
            <select id="filtre-equipe" className="selecteur" value={equipe} onChange={(e) => setEquipe(e.target.value)}>
              <option value="">Toutes les équipes</option>
              {donnees.equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select>
          </div>
        )}
        <div className="choix-vue" role="group" aria-label="Affichage">
          {[['calendrier', 'Calendrier'], ['liste', 'Liste']].map(([valeur, libelle]) => (
            <button key={valeur} type="button" className={`bouton secondaire compact${vue === valeur ? ' actif' : ''}`}
              aria-pressed={vue === valeur} onClick={() => setVue(valeur)}>{libelle}</button>
          ))}
        </div>
      </div>

      {info && <p className="message succes" role="status">{info}</p>}
      {!donnees ? (
        <p className={planning.erreur ? 'message erreur' : 'chargement'}>{planning.erreur || 'Chargement…'}</p>
      ) : (
        <>
          {vue === 'calendrier' ? grille : liste}
          <ul className="legende" aria-label="Légende">
            {donnees.types.map((t, i) => (
              <li key={t.id}><span className={`echantillon abs type-${i % NOMBRE_COULEURS}`} aria-hidden="true" /> {t.libelle}</li>
            ))}
            <li><span className="echantillon abs type-0 attente" aria-hidden="true" /> Demande en attente (hachurée)</li>
            <li><span className="echantillon cellule we" aria-hidden="true" /> Week-end</li>
            <li><span className="echantillon cellule ferie" aria-hidden="true" /> Jour férié</li>
            <li><span className="echantillon cellule impose" aria-hidden="true" /> Jour non travaillé imposé</li>
          </ul>
        </>
      )}

      {detail && (
        <DetailDemande
          id={detail}
          onFermer={() => setDetail(null)}
          onChange={(message) => { setDetail(null); setInfo(message); planning.recharger(); }}
        />
      )}
    </Cadre>
  );
}
