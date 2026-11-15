-- Up Migration

-- Le rôle absences_api est le groupe du compte applicatif (créé par db/init/01-roles.sh).
-- Tous les droits de l'API passent par lui, ce qui rend indépendant du nom du compte de connexion.

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------

CREATE TABLE equipes (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nom             text NOT NULL CHECK (btrim(nom) <> ''),
  parent_id       bigint REFERENCES equipes (id) ON DELETE RESTRICT,
  responsable_id  bigint,
  actif           boolean NOT NULL DEFAULT true,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX equipes_nom_unique ON equipes (lower(nom));
CREATE INDEX equipes_parent_idx ON equipes (parent_id);

CREATE TABLE collaborateurs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email              text NOT NULL CHECK (position('@' in email) > 1),
  nom                text NOT NULL CHECK (btrim(nom) <> ''),
  prenom             text NOT NULL CHECK (btrim(prenom) <> ''),
  equipe_id          bigint NOT NULL REFERENCES equipes (id) ON DELETE RESTRICT,
  role               text NOT NULL DEFAULT 'collaborateur'
                     CHECK (role IN ('collaborateur', 'responsable', 'directeur')),
  -- Authentification : compte Microsoft, mot de passe propre à l'outil, ou les deux.
  microsoft_oid      text UNIQUE,
  mot_de_passe_hash  text,
  actif              boolean NOT NULL DEFAULT true,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX collaborateurs_email_unique ON collaborateurs (lower(email));
CREATE INDEX collaborateurs_equipe_idx ON collaborateurs (equipe_id);

ALTER TABLE equipes
  ADD CONSTRAINT equipes_responsable_fk
  FOREIGN KEY (responsable_id) REFERENCES collaborateurs (id) ON DELETE RESTRICT;

-- Un délégué valide à la place du responsable de l'équipe.
CREATE TABLE delegations (
  equipe_id   bigint NOT NULL REFERENCES equipes (id) ON DELETE CASCADE,
  delegue_id  bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE CASCADE,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (equipe_id, delegue_id)
);

-- Interdit les boucles dans l'arborescence des équipes.
CREATE FUNCTION verifier_arborescence_equipes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancetres AS (
      SELECT id, parent_id FROM equipes WHERE id = NEW.parent_id
      UNION ALL
      SELECT e.id, e.parent_id FROM equipes e JOIN ancetres a ON e.id = a.parent_id
    )
    SELECT 1 FROM ancetres WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Une équipe ne peut pas être rattachée à l''une de ses sous-équipes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER equipes_arborescence
  BEFORE INSERT OR UPDATE OF parent_id ON equipes
  FOR EACH ROW EXECUTE FUNCTION verifier_arborescence_equipes();

-- Renvoie l'équipe donnée et toutes ses sous-équipes, à tous les niveaux.
CREATE FUNCTION sous_equipes(p_equipe bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE arbre AS (
    SELECT id FROM equipes WHERE id = p_equipe
    UNION ALL
    SELECT e.id FROM equipes e JOIN arbre a ON e.parent_id = a.id
  )
  SELECT id FROM arbre
$$;

-- ---------------------------------------------------------------------------
-- Paramétrage
-- ---------------------------------------------------------------------------

CREATE TABLE types_absence (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  libelle                 text NOT NULL CHECK (btrim(libelle) <> ''),
  approbation_requise     boolean NOT NULL DEFAULT true,
  confidentiel            boolean NOT NULL DEFAULT false,
  -- Nombre de jours entre la soumission et le début de l'absence ; NULL = pas de contrôle.
  delai_prevenance_jours  integer CHECK (delai_prevenance_jours >= 0),
  actif                   boolean NOT NULL DEFAULT true,
  ordre                   integer NOT NULL DEFAULT 0,
  cree_le                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX types_absence_libelle_unique ON types_absence (lower(libelle));

CREATE TABLE jours_feries (
  jour     date PRIMARY KEY,
  libelle  text NOT NULL
);

-- Jours non travaillés imposés (pont, fermeture). equipe_id NULL = toute l'entreprise ;
-- sinon le jour vaut pour l'équipe et ses sous-équipes.
CREATE TABLE jours_imposes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jour           date NOT NULL,
  libelle        text NOT NULL,
  equipe_id      bigint REFERENCES equipes (id) ON DELETE CASCADE,
  avec_decompte  boolean NOT NULL,
  cree_le        timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (jour, equipe_id)
);

CREATE TABLE parametres (
  cle         text PRIMARY KEY,
  valeur      jsonb NOT NULL,
  modifie_le  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Demandes et journal
-- ---------------------------------------------------------------------------

-- Une demande est figée dès son insertion : aucune colonne ne change ensuite.
-- Son statut n'est pas stocké ici, il découle du dernier événement du journal.
CREATE TABLE demandes (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nature               text NOT NULL DEFAULT 'absence' CHECK (nature IN ('absence', 'annulation')),
  -- Renseigné uniquement pour une demande d'annulation.
  demande_annulee_id   bigint REFERENCES demandes (id) ON DELETE CASCADE,
  collaborateur_id     bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE RESTRICT,
  -- Équipe du collaborateur au moment de la soumission.
  equipe_id            bigint NOT NULL REFERENCES equipes (id) ON DELETE RESTRICT,
  type_id              bigint NOT NULL REFERENCES types_absence (id) ON DELETE RESTRICT,
  date_debut           date NOT NULL,
  debut_demi_journee   text NOT NULL DEFAULT 'matin' CHECK (debut_demi_journee IN ('matin', 'apres_midi')),
  date_fin             date NOT NULL,
  fin_demi_journee     text NOT NULL DEFAULT 'apres_midi' CHECK (fin_demi_journee IN ('matin', 'apres_midi')),
  -- Durée en demi-journées ouvrées, calculée à la soumission et jamais recalculée.
  duree_demi_journees  integer NOT NULL CHECK (duree_demi_journees >= 0),
  commentaire          text,
  -- Avertissements affichés à la saisie (chevauchement, délai, etc.).
  avertissements       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(avertissements) = 'array'),
  saisie_par_id        bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE RESTRICT,
  soumise_le           timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut),
  CHECK (date_fin > date_debut OR NOT (debut_demi_journee = 'apres_midi' AND fin_demi_journee = 'matin')),
  CHECK ((nature = 'annulation') = (demande_annulee_id IS NOT NULL))
);
CREATE INDEX demandes_collaborateur_idx ON demandes (collaborateur_id, date_debut);
CREATE INDEX demandes_equipe_idx ON demandes (equipe_id, date_debut);
CREATE INDEX demandes_periode_idx ON demandes (date_debut, date_fin);
CREATE INDEX demandes_annulee_idx ON demandes (demande_annulee_id) WHERE demande_annulee_id IS NOT NULL;

-- Journal : une ligne par action sur une demande. On n'y fait qu'ajouter.
CREATE TABLE evenements_demande (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demande_id  bigint NOT NULL REFERENCES demandes (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN
              ('soumission', 'enregistrement', 'approbation', 'refus', 'retrait', 'annulation')),
  auteur_id   bigint NOT NULL REFERENCES collaborateurs (id) ON DELETE RESTRICT,
  motif       text,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  -- Le motif est obligatoire en cas de refus.
  CHECK (type <> 'refus' OR btrim(coalesce(motif, '')) <> '')
);
CREATE INDEX evenements_demande_idx ON evenements_demande (demande_id, id);

-- Horodatage imposé par le serveur et cohérence d'une demande d'annulation.
CREATE FUNCTION verifier_demande() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origine demandes%ROWTYPE;
BEGIN
  NEW.soumise_le := now();
  IF NEW.nature = 'annulation' THEN
    SELECT * INTO origine FROM demandes WHERE id = NEW.demande_annulee_id;
    IF origine.nature <> 'absence' THEN
      RAISE EXCEPTION 'Une demande d''annulation ne peut viser qu''une demande d''absence'
        USING ERRCODE = 'check_violation';
    END IF;
    IF origine.collaborateur_id <> NEW.collaborateur_id OR origine.type_id <> NEW.type_id THEN
      RAISE EXCEPTION 'La demande d''annulation doit reprendre le collaborateur et le type de la demande d''origine'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER demandes_verification
  BEFORE INSERT ON demandes
  FOR EACH ROW EXECUTE FUNCTION verifier_demande();

-- Enchaînements autorisés :
--   (aucun)                      -> soumission (type avec approbation) | enregistrement (type sans)
--   soumission                   -> approbation | refus | retrait
--   approbation, enregistrement  -> annulation
--   refus, retrait, annulation   -> (rien)
CREATE FUNCTION verifier_evenement_demande() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  dernier     text;
  approbation boolean;
  autorise    boolean;
BEGIN
  -- Sérialise les décisions concurrentes sur une même demande.
  PERFORM pg_advisory_xact_lock(NEW.demande_id);

  SELECT type INTO dernier
  FROM evenements_demande WHERE demande_id = NEW.demande_id
  ORDER BY id DESC LIMIT 1;

  IF dernier IS NULL THEN
    SELECT t.approbation_requise INTO approbation
    FROM demandes d JOIN types_absence t ON t.id = d.type_id
    WHERE d.id = NEW.demande_id;
    autorise := (approbation AND NEW.type = 'soumission')
             OR (NOT approbation AND NEW.type = 'enregistrement');
  ELSIF dernier = 'soumission' THEN
    autorise := NEW.type IN ('approbation', 'refus', 'retrait');
  ELSIF dernier IN ('approbation', 'enregistrement') THEN
    autorise := NEW.type = 'annulation';
  ELSE
    autorise := false;
  END IF;

  IF NOT coalesce(autorise, false) THEN
    RAISE EXCEPTION 'Événement « % » impossible sur la demande % (dernier événement : %)',
      NEW.type, NEW.demande_id, coalesce(dernier, 'aucun')
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.cree_le := now();
  RETURN NEW;
END $$;

CREATE TRIGGER evenements_demande_verification
  BEFORE INSERT ON evenements_demande
  FOR EACH ROW EXECUTE FUNCTION verifier_evenement_demande();

-- Quand une demande d'annulation est approuvée ou enregistrée, la demande d'origine passe à « annulée ».
CREATE FUNCTION propager_annulation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origine_id bigint;
BEGIN
  IF NEW.type IN ('approbation', 'enregistrement') THEN
    SELECT demande_annulee_id INTO origine_id
    FROM demandes WHERE id = NEW.demande_id AND nature = 'annulation';
    IF origine_id IS NOT NULL THEN
      INSERT INTO evenements_demande (demande_id, type, auteur_id)
      VALUES (origine_id, 'annulation', NEW.auteur_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER evenements_demande_annulation
  AFTER INSERT ON evenements_demande
  FOR EACH ROW EXECUTE FUNCTION propager_annulation();

-- Une demande doit avoir son premier événement dans la même transaction.
CREATE FUNCTION verifier_demande_journalisee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM evenements_demande WHERE demande_id = NEW.id) THEN
    RAISE EXCEPTION 'La demande % n''a aucun événement dans le journal', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER demandes_journalisees
  AFTER INSERT ON demandes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verifier_demande_journalisee();

-- Inaltérabilité : toute modification ou suppression est refusée, quel que soit le compte,
-- sauf pendant la purge de conservation (fonction purger_demandes).
CREATE FUNCTION refuser_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('absences.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La table % est en ajout seul : % refusé', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER demandes_inalterables
  BEFORE UPDATE OR DELETE ON demandes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER demandes_sans_troncature
  BEFORE TRUNCATE ON demandes
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER evenements_demande_inalterables
  BEFORE UPDATE OR DELETE ON evenements_demande
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER evenements_demande_sans_troncature
  BEFORE TRUNCATE ON evenements_demande
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();

-- Statut courant de chaque demande, déduit du dernier événement.
CREATE VIEW demandes_avec_statut AS
SELECT
  d.*,
  CASE e.type
    WHEN 'soumission'     THEN 'en_attente'
    WHEN 'enregistrement' THEN 'enregistree'
    WHEN 'approbation'    THEN 'approuvee'
    WHEN 'refus'          THEN 'refusee'
    WHEN 'retrait'        THEN 'retiree'
    WHEN 'annulation'     THEN 'annulee'
  END            AS statut,
  e.auteur_id    AS statut_par_id,
  e.cree_le      AS statut_le,
  e.motif        AS statut_motif
FROM demandes d
LEFT JOIN LATERAL (
  SELECT type, auteur_id, cree_le, motif
  FROM evenements_demande
  WHERE demande_id = d.id
  ORDER BY id DESC
  LIMIT 1
) e ON true;

-- Suivi des e-mails (notifications et PDF), pour signaler et relancer les échecs.
CREATE TABLE envois_email (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  demande_id       bigint REFERENCES demandes (id) ON DELETE CASCADE,
  evenement_id     bigint REFERENCES evenements_demande (id) ON DELETE CASCADE,
  destinataire     text NOT NULL,
  sujet            text NOT NULL,
  avec_pdf         boolean NOT NULL DEFAULT false,
  statut           text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'envoye', 'echec')),
  tentatives       integer NOT NULL DEFAULT 0,
  derniere_erreur  text,
  cree_le          timestamptz NOT NULL DEFAULT now(),
  envoye_le        timestamptz
);
CREATE INDEX envois_email_statut_idx ON envois_email (statut) WHERE statut <> 'envoye';
CREATE INDEX envois_email_demande_idx ON envois_email (demande_id);

-- Purge de conservation : seule suppression possible de demandes.
-- Supprime les demandes terminées avant la date donnée, avec leur journal et leurs envois.
CREATE FUNCTION purger_demandes(p_avant date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  nombre integer;
BEGIN
  IF p_avant IS NULL OR p_avant > current_date THEN
    RAISE EXCEPTION 'La date limite de purge doit être passée' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('absences.purge', 'on', true);
  DELETE FROM demandes WHERE date_fin < p_avant;
  GET DIAGNOSTICS nombre = ROW_COUNT;
  PERFORM set_config('absences.purge', 'off', true);
  RETURN nombre;
END $$;
REVOKE ALL ON FUNCTION purger_demandes(date) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Droits du compte applicatif
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON equipes, delegations, types_absence, jours_feries, jours_imposes, parametres, envois_email
  TO absences_api;
-- Un collaborateur se désactive, il ne se supprime pas.
GRANT SELECT, INSERT, UPDATE ON collaborateurs TO absences_api;
-- Demandes et journal : lecture et ajout seulement.
GRANT SELECT, INSERT ON demandes, evenements_demande TO absences_api;
GRANT SELECT ON demandes_avec_statut TO absences_api;
GRANT EXECUTE ON FUNCTION purger_demandes(date) TO absences_api;

-- ---------------------------------------------------------------------------
-- Données de départ
-- ---------------------------------------------------------------------------

INSERT INTO types_absence (libelle, approbation_requise, confidentiel, ordre) VALUES
  ('Congés payés',                      true,  false, 10),
  ('RTT',                               true,  false, 20),
  ('Congés spéciaux',                   true,  false, 30),
  ('Sans solde',                        true,  false, 40),
  ('Maladie',                           false, true,  50),
  ('Jour non travaillé (temps partiel)', false, false, 60);

INSERT INTO parametres (cle, valeur) VALUES
  ('conservation_passe_mois', '12'),
  ('horizon_futur_mois',      '12'),
  ('pdf_raison_sociale',      '""'),
  ('pdf_mentions',            '""');

-- Down Migration

DROP VIEW demandes_avec_statut;
DROP TABLE envois_email, evenements_demande, demandes, parametres, jours_imposes, jours_feries,
           types_absence, delegations;
ALTER TABLE equipes DROP CONSTRAINT equipes_responsable_fk;
DROP TABLE collaborateurs, equipes;
DROP FUNCTION purger_demandes(date), refuser_modification(), verifier_demande_journalisee(),
              propager_annulation(), verifier_evenement_demande(), verifier_demande(),
              sous_equipes(bigint), verifier_arborescence_equipes();
