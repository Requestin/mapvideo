-- Zoom-adaptive tile sources for Martin (balanced profile).
-- Target DB: ${POSTGRES_GIS_DB} (usually "gis").

CREATE INDEX IF NOT EXISTS idx_planet_osm_line_highway
  ON public.planet_osm_line ("highway")
  WHERE "highway" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_line_way_highway
  ON public.planet_osm_line USING GIST ("way")
  WHERE "highway" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way_water
  ON public.planet_osm_polygon USING GIST ("way")
  WHERE "natural" = 'water' OR "waterway" = 'riverbank' OR "water" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way_landuse
  ON public.planet_osm_polygon USING GIST ("way")
  WHERE "landuse" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_water_area
  ON public.planet_osm_polygon ((abs("way_area")))
  WHERE "natural" = 'water' OR "waterway" = 'riverbank' OR "water" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_landuse_area
  ON public.planet_osm_polygon ((abs("way_area")))
  WHERE "landuse" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mv_roads(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  mvt bytea;
BEGIN
  SELECT INTO mvt ST_AsMVT(tile, 'roads', 4096, 'geom')
  FROM (
    SELECT
      ST_AsMVTGeom(
        CASE
          WHEN z <= 4 THEN ST_SimplifyPreserveTopology("way", 1200)
          WHEN z <= 6 THEN ST_SimplifyPreserveTopology("way", 400)
          WHEN z <= 8 THEN ST_SimplifyPreserveTopology("way", 120)
          WHEN z <= 10 THEN ST_SimplifyPreserveTopology("way", 40)
          ELSE "way"
        END,
        ST_TileEnvelope(z, x, y),
        4096,
        64,
        true
      ) AS geom,
      "highway" AS highway
    FROM public.planet_osm_line
    WHERE "way" && ST_TileEnvelope(z, x, y)
      AND ST_Intersects("way", ST_TileEnvelope(z, x, y))
      AND "highway" IS NOT NULL
      AND (
        (z <= 5 AND "highway" IN ('motorway', 'trunk', 'primary')) OR
        (z BETWEEN 6 AND 8 AND "highway" IN ('motorway', 'trunk', 'primary', 'secondary')) OR
        (z BETWEEN 9 AND 11 AND "highway" IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')) OR
        (z >= 12 AND "highway" IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'))
      )
  ) AS tile
  WHERE geom IS NOT NULL;

  RETURN mvt;
END
$$;

CREATE OR REPLACE FUNCTION public.mv_water(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  mvt bytea;
BEGIN
  SELECT INTO mvt ST_AsMVT(tile, 'water', 4096, 'geom')
  FROM (
    SELECT
      ST_AsMVTGeom(
        CASE
          WHEN z <= 4 THEN ST_SimplifyPreserveTopology("way", 1500)
          WHEN z <= 6 THEN ST_SimplifyPreserveTopology("way", 500)
          WHEN z <= 8 THEN ST_SimplifyPreserveTopology("way", 160)
          WHEN z <= 10 THEN ST_SimplifyPreserveTopology("way", 60)
          ELSE "way"
        END,
        ST_TileEnvelope(z, x, y),
        4096,
        64,
        true
      ) AS geom
    FROM public.planet_osm_polygon
    WHERE "way" && ST_TileEnvelope(z, x, y)
      AND ST_Intersects("way", ST_TileEnvelope(z, x, y))
      AND ("natural" = 'water' OR "waterway" = 'riverbank' OR "water" IS NOT NULL)
      AND (
        (z <= 4 AND abs(COALESCE("way_area", 0)) >= 200000000) OR
        (z BETWEEN 5 AND 6 AND abs(COALESCE("way_area", 0)) >= 30000000) OR
        (z BETWEEN 7 AND 8 AND abs(COALESCE("way_area", 0)) >= 5000000) OR
        (z >= 9)
      )
  ) AS tile
  WHERE geom IS NOT NULL;

  RETURN mvt;
END
$$;

CREATE OR REPLACE FUNCTION public.mv_landuse(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  mvt bytea;
BEGIN
  SELECT INTO mvt ST_AsMVT(tile, 'landuse', 4096, 'geom')
  FROM (
    SELECT
      ST_AsMVTGeom(
        CASE
          WHEN z <= 4 THEN ST_SimplifyPreserveTopology("way", 2000)
          WHEN z <= 6 THEN ST_SimplifyPreserveTopology("way", 700)
          WHEN z <= 8 THEN ST_SimplifyPreserveTopology("way", 220)
          WHEN z <= 10 THEN ST_SimplifyPreserveTopology("way", 80)
          ELSE "way"
        END,
        ST_TileEnvelope(z, x, y),
        4096,
        64,
        true
      ) AS geom
    FROM public.planet_osm_polygon
    WHERE "way" && ST_TileEnvelope(z, x, y)
      AND ST_Intersects("way", ST_TileEnvelope(z, x, y))
      AND "landuse" IS NOT NULL
      AND (
        (z <= 4 AND abs(COALESCE("way_area", 0)) >= 500000000) OR
        (z BETWEEN 5 AND 6 AND abs(COALESCE("way_area", 0)) >= 20000000) OR
        (z BETWEEN 7 AND 8 AND abs(COALESCE("way_area", 0)) >= 3000000) OR
        (z BETWEEN 9 AND 10 AND abs(COALESCE("way_area", 0)) >= 500000) OR
        (z >= 11)
      )
  ) AS tile
  WHERE geom IS NOT NULL;

  RETURN mvt;
END
$$;
