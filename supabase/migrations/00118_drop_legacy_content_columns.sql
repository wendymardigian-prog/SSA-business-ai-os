-- 00118: borra las columnas y la funcion que la v3 dejo sin uso (Contenido v3,
-- B12).
--
-- *** DESTRUCTIVA. NO SE APLICA CON EL RESTO DE LA TANDA. ***
-- Esta migracion esta escrita y anotada en docs/PENDIENTE.md, pero a
-- proposito NO se aplico: borra datos. Se aplica a mano, DESPUES de:
--   1. Haber visto la v3 funcionando en produccion con piezas reales.
--   2. Haber verificado que ninguna idea o pieza tiene texto SOLO en las
--      columnas viejas (la consulta de abajo tiene que dar 0 en las dos).
--   3. Tener un backup (supabase db dump) o la confirmacion de la duena del negocio.
--
-- Comprobacion previa (las dos tienen que devolver 0):
--   SELECT count(*) FROM public.content_ideas
--    WHERE content IS NULL
--      AND (nullif(btrim(hook), '') IS NOT NULL
--        OR nullif(btrim(angle), '') IS NOT NULL
--        OR nullif(btrim(notes), '') IS NOT NULL);
--   SELECT count(*) FROM public.content_posts
--    WHERE script IS NULL AND recording_notes IS NULL
--      AND copy <> '{}'::jsonb;
--
-- Las versiones viejas del historial (content_post_versions.snapshot) guardan
-- `copy` DENTRO del jsonb, no como columna: no se tocan, y el codigo las sigue
-- leyendo (lib/content/versions.ts normaliza al restaurar y al comparar).
--
-- Para volver atras esta migracion no alcanza con una inversa: las columnas se
-- recrean vacias. Por eso la comprobacion previa es obligatoria.

-- La funcion vieja recibe el copy por parametro y escribe content_posts.copy.
DROP FUNCTION IF EXISTS public.approve_content_idea(uuid, text, text, jsonb);

ALTER TABLE public.content_ideas
  DROP COLUMN IF EXISTS hook,
  DROP COLUMN IF EXISTS angle,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS pillar;

ALTER TABLE public.content_posts
  DROP COLUMN IF EXISTS copy;
