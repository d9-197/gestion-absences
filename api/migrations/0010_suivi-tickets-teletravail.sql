-- Up Migration

-- Tickets restaurant retirés et jours de télétravail déclarés, par collaborateur et par jour.
-- Comme les demandes, c'est un journal en ajout seul : on n'efface jamais une saisie, on en ajoute une qui l'annule.
-- L'état d'un jour est celui du dernier événement. Le droit au ticket (jour travaillé, sans absence) n'est pas stocké :
-- il se calcule à partir du calendrier et des absences ; seul le retrait par le collaborateur est enregistré.
CREATE TABLE suivi_evenements (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collaborateur_id  bigint NOT NULL REFERENCES collaborateurs (id),
  jour              date NOT NULL,
  objet             text NOT NULL CHECK (objet IN ('ticket', 'teletravail')),
  action            text NOT NULL CHECK (action IN ('retrait', 'retablissement', 'declaration', 'annulation')),
  motif             text CHECK (char_length(motif) <= 300),
  auteur_id         bigint NOT NULL REFERENCES collaborateurs (id),
  cree_le           timestamptz NOT NULL DEFAULT now(),
  CHECK ((objet = 'ticket' AND action IN ('retrait', 'retablissement'))
      OR (objet = 'teletravail' AND action IN ('declaration', 'annulation')))
);
CREATE INDEX suivi_evenements_dernier_idx ON suivi_evenements (collaborateur_id, objet, jour, id DESC);

CREATE TRIGGER suivi_evenements_inalterables
  BEFORE UPDATE OR DELETE ON suivi_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER suivi_evenements_sans_troncature
  BEFORE TRUNCATE ON suivi_evenements
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();

-- État courant : le dernier événement de chaque (collaborateur, objet, jour).
CREATE VIEW suivi_actuel AS
SELECT DISTINCT ON (collaborateur_id, objet, jour)
       collaborateur_id, objet, jour, action, motif, auteur_id, cree_le
FROM suivi_evenements
ORDER BY collaborateur_id, objet, jour, id DESC;

GRANT SELECT, INSERT ON suivi_evenements TO absences_api;
GRANT SELECT ON suivi_actuel TO absences_api;

-- La purge de conservation emporte aussi les saisies antérieures à la date limite.
CREATE OR REPLACE FUNCTION purger_demandes(p_avant date) RETURNS integer
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
  DELETE FROM suivi_evenements WHERE jour < p_avant;
  PERFORM set_config('absences.purge', 'off', true);
  RETURN nombre;
END $$;

-- Down Migration

CREATE OR REPLACE FUNCTION purger_demandes(p_avant date) RETURNS integer
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

DROP VIEW suivi_actuel;
DROP TABLE suivi_evenements;
