-- Up Migration

-- --- Délégations avec dates --------------------------------------------------
-- Une délégation peut être limitée dans le temps (absence du responsable). Sans date, elle est permanente.
-- Les dates sont des jours inclus, dans le fuseau de l'entreprise.
ALTER TABLE delegations
  ADD COLUMN date_debut date,
  ADD COLUMN date_fin date,
  ADD CONSTRAINT delegations_dates_coherentes CHECK (date_debut IS NULL OR date_fin IS NULL OR date_fin >= date_debut);

CREATE FUNCTION jour_entreprise() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Europe/Paris')::date $$;

CREATE FUNCTION delegation_active(p_debut date, p_fin date) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT (p_debut IS NULL OR p_debut <= jour_entreprise()) AND (p_fin IS NULL OR p_fin >= jour_entreprise())
$$;

CREATE OR REPLACE FUNCTION valideurs_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id
    FROM equipes p JOIN chaine ON p.id = chaine.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  )
  SELECT p.id FROM collaborateurs p
  WHERE p.actif
    AND p.role IN ('responsable', 'directeur')
    AND p.id <> p_collaborateur
    AND (
      p.role = 'directeur'
      OR p.id IN (SELECT responsable_id FROM concernees WHERE responsable_id IS NOT NULL)
      OR p.id IN (SELECT d.delegue_id FROM delegations d JOIN concernees c ON c.id = d.equipe_id
                  WHERE delegation_active(d.date_debut, d.date_fin))
    )
$$;

CREATE OR REPLACE FUNCTION valideurs_proches_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id, 0 AS niveau
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id, ch.niveau + 1
    FROM equipes p JOIN chaine ch ON p.id = ch.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id, niveau FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  ),
  candidats AS (
    SELECT c.niveau, p.id
    FROM concernees c JOIN collaborateurs p ON p.id = c.responsable_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
    UNION
    SELECT c.niveau, p.id
    FROM concernees c
      JOIN delegations d ON d.equipe_id = c.id AND delegation_active(d.date_debut, d.date_fin)
      JOIN collaborateurs p ON p.id = d.delegue_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
  )
  SELECT id FROM candidats WHERE niveau = (SELECT min(niveau) FROM candidats)
  UNION
  SELECT p.id FROM collaborateurs p
  WHERE p.actif AND p.role = 'directeur' AND p.id <> p_collaborateur
    AND NOT EXISTS (SELECT 1 FROM candidats)
$$;

-- --- Journal des modifications d'administration ------------------------------
-- Une ligne par modification faite par un directeur. On n'y fait qu'ajouter.
CREATE TABLE journal_admin (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  auteur_id   bigint REFERENCES collaborateurs (id) ON DELETE SET NULL,
  auteur_nom  text NOT NULL,
  action      text NOT NULL,
  cible       text,
  details     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX journal_admin_date_idx ON journal_admin (cree_le DESC, id DESC);
CREATE TRIGGER journal_admin_inalterable
  BEFORE UPDATE OR DELETE ON journal_admin
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER journal_admin_sans_troncature
  BEFORE TRUNCATE ON journal_admin
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();
GRANT SELECT, INSERT ON journal_admin TO absences_api;

-- --- Résumé quotidien et relances --------------------------------------------
-- Les résumés sont des e-mails sans demande ni événement : leur texte est enregistré avec l'envoi.
ALTER TABLE envois_email DROP CONSTRAINT envois_email_modele_check;
ALTER TABLE envois_email
  ADD CONSTRAINT envois_email_modele_check CHECK (modele IN ('a_traiter', 'declaration', 'decision', 'resume')),
  ADD COLUMN corps text,
  ADD CONSTRAINT envois_email_resume_corps CHECK ((modele = 'resume') = (corps IS NOT NULL));

-- Un seul résumé par jour, même avec plusieurs processus.
CREATE TABLE resumes_quotidiens (
  jour       date PRIMARY KEY,
  envoyes    integer NOT NULL CHECK (envoyes >= 0),
  cree_le    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON resumes_quotidiens TO absences_api;

INSERT INTO parametres (cle, valeur) VALUES
  ('notification_a_traiter', '"immediat"'),  -- ou "quotidien" : un résumé par jour au lieu d'un e-mail par demande
  ('relance_jours', '0');                    -- 0 : pas de relance ; N : relance après N jours, échelon supérieur après 2 N

-- Down Migration

DELETE FROM parametres WHERE cle IN ('notification_a_traiter', 'relance_jours');
DROP TABLE resumes_quotidiens;
DELETE FROM envois_email WHERE modele = 'resume';
ALTER TABLE envois_email DROP CONSTRAINT envois_email_resume_corps, DROP COLUMN corps, DROP CONSTRAINT envois_email_modele_check;
ALTER TABLE envois_email ADD CONSTRAINT envois_email_modele_check CHECK (modele IN ('a_traiter', 'declaration', 'decision'));
DROP TABLE journal_admin;

CREATE OR REPLACE FUNCTION valideurs_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id
    FROM equipes p JOIN chaine ON p.id = chaine.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  )
  SELECT p.id FROM collaborateurs p
  WHERE p.actif
    AND p.role IN ('responsable', 'directeur')
    AND p.id <> p_collaborateur
    AND (
      p.role = 'directeur'
      OR p.id IN (SELECT responsable_id FROM concernees WHERE responsable_id IS NOT NULL)
      OR p.id IN (SELECT d.delegue_id FROM delegations d JOIN concernees c ON c.id = d.equipe_id)
    )
$$;

CREATE OR REPLACE FUNCTION valideurs_proches_de(p_collaborateur bigint) RETURNS SETOF bigint
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE cible AS (
    SELECT equipe_id FROM collaborateurs WHERE id = p_collaborateur
  ),
  chaine AS (
    SELECT e.id, e.parent_id, e.responsable_id, 0 AS niveau
    FROM equipes e JOIN cible ON e.id = cible.equipe_id
    UNION ALL
    SELECT p.id, p.parent_id, p.responsable_id, ch.niveau + 1
    FROM equipes p JOIN chaine ch ON p.id = ch.parent_id
  ),
  concernees AS (
    SELECT id, responsable_id, niveau FROM chaine
    WHERE responsable_id IS DISTINCT FROM p_collaborateur
  ),
  candidats AS (
    SELECT c.niveau, p.id
    FROM concernees c JOIN collaborateurs p ON p.id = c.responsable_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
    UNION
    SELECT c.niveau, p.id
    FROM concernees c
      JOIN delegations d ON d.equipe_id = c.id
      JOIN collaborateurs p ON p.id = d.delegue_id
    WHERE p.actif AND p.role IN ('responsable', 'directeur') AND p.id <> p_collaborateur
  )
  SELECT id FROM candidats WHERE niveau = (SELECT min(niveau) FROM candidats)
  UNION
  SELECT p.id FROM collaborateurs p
  WHERE p.actif AND p.role = 'directeur' AND p.id <> p_collaborateur
    AND NOT EXISTS (SELECT 1 FROM candidats)
$$;

DROP FUNCTION delegation_active(date, date), jour_entreprise();
ALTER TABLE delegations DROP COLUMN date_fin, DROP COLUMN date_debut;
