-- db/init/01-create-gis.sql
CREATE DATABASE gis;
\c gis
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS hstore;
