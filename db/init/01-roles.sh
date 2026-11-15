#!/bin/sh
# Exécuté une seule fois, à la création du volume de données.
# Crée le compte applicatif : il peut se connecter, mais ne possède aucun objet.
# Ses droits table par table seront accordés par les migrations, ce qui permettra
# de lui interdire la modification et la suppression des lignes du journal.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" -v POSTGRES_DB="$POSTGRES_DB" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password';
REVOKE ALL ON DATABASE :"POSTGRES_DB" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"POSTGRES_DB" TO :"app_user";
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";
SQL
