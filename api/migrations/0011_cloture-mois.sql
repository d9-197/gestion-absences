-- Up Migration

-- Clôture d'un mois par un directeur : les fiches RH du mois sont figées (instantané des compteurs et du calendrier de chaque
-- salarié). Journal en ajout seul : on ne modifie jamais une clôture, on ajoute une réouverture, ce qui laisse une trace.
-- L'état d'un mois est celui de son dernier événement.
CREATE TABLE clotures_mois (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mois       date NOT NULL CHECK (extract(day FROM mois) = 1),
  action     text NOT NULL CHECK (action IN ('cloture', 'reouverture')),
  fiches     jsonb,
  auteur_id  bigint NOT NULL REFERENCES collaborateurs (id),
  cree_le    timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'cloture') = (fiches IS NOT NULL))
);
CREATE INDEX clotures_mois_dernier_idx ON clotures_mois (mois, id DESC);

CREATE TRIGGER clotures_mois_inalterables
  BEFORE UPDATE OR DELETE ON clotures_mois
  FOR EACH ROW EXECUTE FUNCTION refuser_modification();
CREATE TRIGGER clotures_mois_sans_troncature
  BEFORE TRUNCATE ON clotures_mois
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification();

CREATE VIEW clotures_actuelles AS
SELECT DISTINCT ON (mois) id, mois, action, fiches, auteur_id, cree_le
FROM clotures_mois
ORDER BY mois, id DESC;

GRANT SELECT, INSERT ON clotures_mois TO absences_api;
GRANT SELECT ON clotures_actuelles TO absences_api;

-- La purge de conservation emporte aussi les clôtures des mois entièrement antérieurs à la date limite.
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
  DELETE FROM clotures_mois WHERE (mois + interval '1 month')::date <= p_avant;
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
  DELETE FROM suivi_evenements WHERE jour < p_avant;
  PERFORM set_config('absences.purge', 'off', true);
  RETURN nombre;
END $$;

DROP VIEW clotures_actuelles;
DROP TABLE clotures_mois;
