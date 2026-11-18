-- Up Migration

-- Une demande en attente se « modifie » en la retirant et en la remplaçant par une nouvelle : la nouvelle porte la
-- référence de celle qu'elle remplace, pour que l'historique des deux reste lisible.
-- Pas de clé étrangère : la purge supprime une demande ancienne sans devoir toucher à celle qui la remplace.
ALTER TABLE demandes ADD COLUMN remplace_id bigint CHECK (remplace_id IS NULL OR remplace_id <> id);

CREATE OR REPLACE FUNCTION verifier_demande() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  origine demandes%ROWTYPE;
  remplacee demandes%ROWTYPE;
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
  IF NEW.remplace_id IS NOT NULL THEN
    SELECT * INTO remplacee FROM demandes WHERE id = NEW.remplace_id;
    IF NEW.nature <> 'absence' OR NOT FOUND OR remplacee.nature <> 'absence'
       OR remplacee.collaborateur_id <> NEW.collaborateur_id THEN
      RAISE EXCEPTION 'Une demande d''absence ne peut en remplacer qu''une autre, du même collaborateur'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- La vue reprend les colonnes de la table au moment de sa création : il faut la recréer pour y voir la nouvelle.
DROP VIEW demandes_avec_statut;
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
GRANT SELECT ON demandes_avec_statut TO absences_api;

-- Down Migration

DROP VIEW demandes_avec_statut;
ALTER TABLE demandes DROP COLUMN remplace_id;
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
GRANT SELECT ON demandes_avec_statut TO absences_api;

CREATE OR REPLACE FUNCTION verifier_demande() RETURNS trigger
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
