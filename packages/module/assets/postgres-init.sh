#!/bin/sh
# El PostgreSQL local de un módulo (docker compose): la base del módulo, su propietario (migraciones) y su rol de
# ejecución (el que usa el módulo), con las contraseñas que genera `dvi-module up` en `.dvi/local.env`. Lo ejecuta la
# imagen oficial de postgres la primera vez que arranca (los datos van en memoria: cada `up` empieza de cero).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${MODULE_DB}_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${MODULE_OWNER_PASSWORD}';
CREATE ROLE ${MODULE_DB}_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${MODULE_RUNTIME_PASSWORD}';
CREATE DATABASE ${MODULE_DB} OWNER ${MODULE_DB}_owner;
REVOKE ALL ON DATABASE ${MODULE_DB} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${MODULE_DB} TO ${MODULE_DB}_runtime;
SQL
