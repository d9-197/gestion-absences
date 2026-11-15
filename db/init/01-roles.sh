#!/bin/sh
# Exécuté une seule fois, à la création du volume de données.
# Crée le compte applicatif : il peut se connecter, mais ne possède aucun objet.
# Ses droits lui viennent du groupe absences_api, auquel les migrations accordent
# les droits table par table (lecture et ajout seulement sur les demandes et le journal).
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" -v POSTGRES_DB="$POSTGRES_DB" <<'SQL'
CREATE ROLE absences_api NOLOGIN;
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' IN ROLE absences_api;
REVOKE ALL ON DATABASE :"POSTGRES_DB" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"POSTGRES_DB" TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO absences_api;
SQL
