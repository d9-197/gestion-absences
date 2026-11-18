import { useState } from 'react';
import { enregistrerFichier, telecharger } from '../api.js';
import { useDonnees, useEnvoi } from '../donnees.js';
import { joursDuMois, moisCourant, moisSuivant } from '../dates.js';
import { useSession } from '../session.jsx';
import { STATUTS, nomComplet } from '../format.js';
import Cadre from '../composants/Cadre.jsx';

const STATUTS_PAR_DEFAUT = ['approuvee', 'enregistree']; // les absences valables

// Périodes types, relatives à aujourd'hui : « le mois précédent » reste vrai d'un mois à l'autre (clôture de paie).
const PERIODES = {
  mois: ['Mois en cours', () => bornesDuMois(moisCourant())],
  precedent: ['Mois précédent', () => bornesDuMois(moisSuivant(moisCourant(), -1))],
  annee: ['Année en cours', () => [`${moisCourant().annee}-01-01`, `${moisCourant().annee}-12-31`]],
};
function bornesDuMois(m) {
  const jours = joursDuMois(m.annee, m.mois);
  return [jours[0], jours[jours.length - 1]];
}

// Modèles d'export : critères mémorisés dans ce navigateur, par utilisateur.
const cleModeles = (id) => `absences:${id}:modeles-export`;
function lireModeles(id) {
  try { const m = JSON.parse(window.localStorage.getItem(cleModeles(id))); return Array.isArray(m) ? m : []; } catch { return []; }
}
function ecrireModeles(id, modeles) {
  try { window.localStorage.setItem(cleModeles(id), JSON.stringify(modeles)); } catch { /* stockage indisponible */ }
}

export default function Export() {
  const options = useDonnees('/export/options');
  const { utilisateur } = useSession();
  const [champs, setChamps] = useState(() => {
    const [debut, fin] = PERIODES.mois[1]();
    return { debut, fin, equipeId: '', collaborateurId: '', typeId: '', format: 'xlsx' };
  });
  const [periode, setPeriode] = useState('mois'); // « mois », « precedent », « annee » ou « libre »
  const [modeles, setModeles] = useState(() => lireModeles(utilisateur.id));
  const [nomModele, setNomModele] = useState('');
  const [modeleChoisi, setModeleChoisi] = useState('');
  const [statuts, setStatuts] = useState(new Set(STATUTS_PAR_DEFAUT));
  const [info, setInfo] = useState('');
  const { enCours, erreur, envoyer } = useEnvoi();

  if (!options.donnees) {
    return <Cadre><p className={options.erreur ? 'message erreur' : 'chargement'}>{options.erreur || 'Chargement…'}</p></Cadre>;
  }

  const modifier = (champ) => (e) => {
    if (champ === 'debut' || champ === 'fin') setPeriode('libre');
    setChamps({ ...champs, [champ]: e.target.value });
  };
  const choisirPeriode = (cle) => {
    setPeriode(cle);
    if (cle !== 'libre') { const [debut, fin] = PERIODES[cle][1](); setChamps({ ...champs, debut, fin }); }
  };
  // Un modèle ne garde que ce qui existe encore : une équipe supprimée depuis est ignorée.
  const appliquerModele = () => {
    const m = modeles.find((x) => x.nom === modeleChoisi);
    if (!m) return;
    const existe = (liste, id) => (id && liste.some((x) => String(x.id) === String(id)) ? String(id) : '');
    const [debut, fin] = m.periode !== 'libre' && PERIODES[m.periode] ? PERIODES[m.periode][1]() : [m.debut ?? champs.debut, m.fin ?? champs.fin];
    setPeriode(PERIODES[m.periode] ? m.periode : 'libre');
    setStatuts(new Set(m.statuts?.length ? m.statuts : STATUTS_PAR_DEFAUT));
    setChamps({
      debut, fin, format: m.format === 'csv' ? 'csv' : 'xlsx',
      equipeId: existe(options.donnees.equipes, m.equipeId),
      collaborateurId: existe(options.donnees.collaborateurs, m.collaborateurId),
      typeId: existe(options.donnees.types, m.typeId),
    });
    setInfo(`Modèle « ${m.nom} » appliqué.`);
  };
  const enregistrerModele = () => {
    const nom = nomModele.trim();
    if (!nom) return;
    const modele = { nom, periode, debut: champs.debut, fin: champs.fin, equipeId: champs.equipeId, collaborateurId: champs.collaborateurId, typeId: champs.typeId, format: champs.format, statuts: [...statuts] };
    const suivants = [...modeles.filter((m) => m.nom !== nom), modele].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    setModeles(suivants);
    ecrireModeles(utilisateur.id, suivants);
    setModeleChoisi(nom);
    setNomModele('');
    setInfo(`Modèle « ${nom} » enregistré dans ce navigateur.`);
  };
  const supprimerModele = () => {
    const suivants = modeles.filter((m) => m.nom !== modeleChoisi);
    setModeles(suivants);
    ecrireModeles(utilisateur.id, suivants);
    setModeleChoisi('');
    setInfo('Modèle supprimé.');
  };
  const basculer = (statut) => {
    const suivants = new Set(statuts);
    if (suivants.has(statut)) suivants.delete(statut); else suivants.add(statut);
    setStatuts(suivants);
  };

  async function soumettre(evenement) {
    evenement.preventDefault();
    setInfo('');
    const parametres = new URLSearchParams({
      debut: champs.debut, fin: champs.fin, format: champs.format, statut: [...statuts].join(','),
    });
    for (const cle of ['equipeId', 'collaborateurId', 'typeId']) if (champs[cle]) parametres.set(cle, champs[cle]);

    await envoyer(async () => {
      const fichier = await telecharger(`/export/absences?${parametres}`);
      if (fichier.lignes === 0) {
        setInfo('Aucune absence ne correspond à ces critères : aucun fichier n\'a été téléchargé.');
        return;
      }
      enregistrerFichier(fichier);
      setInfo(`${fichier.lignes} ligne${fichier.lignes > 1 ? 's' : ''} exportée${fichier.lignes > 1 ? 's' : ''} dans ${fichier.nom}.`);
    });
  }

  return (
    <Cadre>
      <div className="entete-page"><h1>Export des absences</h1></div>
      {info && <p className="message succes" role="status">{info}</p>}
      {erreur && <p className="message erreur" role="alert">{erreur}</p>}

      <form onSubmit={soumettre} className="formulaire-large">
        <p className="aide">
          Le fichier liste les absences qui touchent la période, parmi celles que vous avez le droit de voir.
          Il contient des données personnelles, dont les absences pour maladie : conservez-le avec précaution.
        </p>
        {modeles.length > 0 && (
          <div className="barre-outils">
            <div>
              <label htmlFor="x-modele">Modèle</label>
              <select id="x-modele" value={modeleChoisi} onChange={(e) => setModeleChoisi(e.target.value)}>
                <option value="">Choisir un modèle…</option>
                {modeles.map((m) => <option key={m.nom} value={m.nom}>{m.nom}</option>)}
              </select>
            </div>
            <button className="bouton secondaire compact" type="button" disabled={!modeleChoisi} onClick={appliquerModele}>Appliquer</button>
            <button className="bouton secondaire compact" type="button" disabled={!modeleChoisi} onClick={supprimerModele}>Supprimer</button>
          </div>
        )}
        <label htmlFor="x-periode">Période</label>
        <select id="x-periode" value={periode} onChange={(e) => choisirPeriode(e.target.value)}>
          {Object.entries(PERIODES).map(([cle, [libelle]]) => <option key={cle} value={cle}>{libelle}</option>)}
          <option value="libre">Dates personnalisées</option>
        </select>
        <div className="ligne-champs">
          <div>
            <label htmlFor="x-debut">Du</label>
            <input id="x-debut" type="date" required value={champs.debut} onChange={modifier('debut')} />
          </div>
          <div>
            <label htmlFor="x-fin">Au</label>
            <input id="x-fin" type="date" required min={champs.debut} value={champs.fin} onChange={modifier('fin')} />
          </div>
        </div>

        <label htmlFor="x-equipe">Équipe</label>
        <select id="x-equipe" value={champs.equipeId} onChange={modifier('equipeId')}>
          <option value="">Toutes les équipes</option>
          {options.donnees.equipes.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <label htmlFor="x-collaborateur">Collaborateur</label>
        <select id="x-collaborateur" value={champs.collaborateurId} onChange={modifier('collaborateurId')}>
          <option value="">Tous les collaborateurs</option>
          {options.donnees.collaborateurs.map((c) => (
            <option key={c.id} value={c.id}>{nomComplet(c)}{c.actif ? '' : ' (désactivé)'}</option>
          ))}
        </select>
        <label htmlFor="x-type">Type d'absence</label>
        <select id="x-type" value={champs.typeId} onChange={modifier('typeId')}>
          <option value="">Tous les types</option>
          {options.donnees.types.map((t) => <option key={t.id} value={t.id}>{t.libelle}{t.actif ? '' : ' (désactivé)'}</option>)}
        </select>

        <fieldset>
          <legend>Statuts</legend>
          {Object.entries(STATUTS).map(([valeur, libelle]) => (
            <label className="case" key={valeur}>
              <input type="checkbox" checked={statuts.has(valeur)} onChange={() => basculer(valeur)} />
              {libelle}
            </label>
          ))}
          <p className="aide">Par défaut : les absences valables, approuvées ou enregistrées.</p>
        </fieldset>

        <fieldset>
          <legend>Format</legend>
          <label className="case">
            <input type="radio" name="format" value="xlsx" checked={champs.format === 'xlsx'} onChange={modifier('format')} />
            Excel (.xlsx)
          </label>
          <label className="case">
            <input type="radio" name="format" value="csv" checked={champs.format === 'csv'} onChange={modifier('format')} />
            CSV (séparateur point-virgule, UTF-8, ouvrable directement avec Excel)
          </label>
        </fieldset>

        <div className="barre-outils">
          <div>
            <label htmlFor="x-nom-modele">Enregistrer ces critères comme modèle</label>
            <input id="x-nom-modele" maxLength={60} placeholder="Paie : mois précédent" value={nomModele} onChange={(e) => setNomModele(e.target.value)} />
          </div>
          <button className="bouton secondaire compact" type="button" disabled={!nomModele.trim()} onClick={enregistrerModele}>Enregistrer le modèle</button>
        </div>
        <div className="actions">
          <button className="bouton" type="submit" disabled={enCours || statuts.size === 0}>
            {enCours ? 'Préparation…' : 'Télécharger'}
          </button>
        </div>
        {statuts.size === 0 && <p className="aide">Choisissez au moins un statut.</p>}
      </form>
    </Cadre>
  );
}
