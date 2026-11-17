-- Up Migration

-- Personnes qui peuvent traiter les demandes d'un collaborateur.
--
--   * le responsable de son équipe et de chaque équipe parente, et leurs délégués ;
--   * tous les directeurs ;
--   * jamais le collaborateur lui-même.
--
-- Le responsable d'une équipe n'est pas validé par sa propre équipe : sa demande remonte au responsable
-- de l'équipe parente (et à ses délégués), à défaut aux directeurs.
-- Seules les personnes actives ayant le rôle responsable ou directeur sont retenues.
CREATE FUNCTION valideurs_de(p_collaborateur bigint) RETURNS SETOF bigint
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

-- Down Migration

DROP FUNCTION valideurs_de(bigint);
