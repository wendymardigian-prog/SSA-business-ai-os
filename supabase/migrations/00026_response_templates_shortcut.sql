-- ============================================================
-- MIGRACION 00026 — ATAJOS UNICOS EN LOS TEMPLATES (F17)
-- ============================================================
-- La tabla response_templates y su RLS ya estan completas desde la 00023, que
-- la creo vacia para que el borrado logico de F15 la cubriera. Lo unico que le
-- falta para el Bloque 4 es lo que aparece recien cuando la tabla se usa: que
-- el atajo sirva para elegir un template sin ambiguedad.
--
-- Dos reglas, las dos por el mismo motivo:
--
-- 1. Formato fijo (barra + minusculas, numeros, guiones). En la bandeja el
--    atajo se escribe atras de "/", asi que un atajo con espacios o mayusculas
--    es un atajo que nadie va a poder tipear.
-- 2. Unico por workspace. Con dos "/precio" el selector tiene que elegir uno y
--    la persona no tiene forma de saber cual le va a tocar.
--
-- Los dos son restricciones sobre datos que ya podrian existir (este proyecto
-- se clona), asi que antes de restringir se normaliza: los atajos se pasan a
-- minusculas, los que no entran en el formato se dejan en NULL y de los
-- repetidos sobrevive el mas viejo. Anular un atajo no pierde el template: el
-- nombre sigue estando y se sigue pudiendo buscar por ahi.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Normalizar lo que pueda haber
-- ------------------------------------------------------------

UPDATE public.response_templates
SET shortcut = lower(btrim(shortcut))
WHERE shortcut IS NOT NULL AND shortcut <> lower(btrim(shortcut));

-- Lo que no entra en el formato se queda sin atajo en vez de bloquear la
-- migracion. La barra inicial se agrega sola si falta, que es el error tipico.
UPDATE public.response_templates
SET shortcut = '/' || shortcut
WHERE shortcut IS NOT NULL
  AND shortcut !~ '^/'
  AND ('/' || shortcut) ~ '^/[a-z0-9][a-z0-9_-]{0,29}$';

UPDATE public.response_templates
SET shortcut = NULL
WHERE shortcut IS NOT NULL AND shortcut !~ '^/[a-z0-9][a-z0-9_-]{0,29}$';

-- De los repetidos dentro de un workspace sobrevive el primero que se creo.
UPDATE public.response_templates t
SET shortcut = NULL
WHERE t.shortcut IS NOT NULL
  AND t.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.response_templates otro
    WHERE otro.workspace_id = t.workspace_id
      AND otro.shortcut = t.shortcut
      AND otro.deleted_at IS NULL
      AND (otro.created_at, otro.id) < (t.created_at, t.id)
  );

-- ------------------------------------------------------------
-- 2. Formato del atajo
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_shortcut_format'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_shortcut_format
      CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
  END IF;
END;
$$;

-- El nombre tampoco puede quedar vacio: es lo que se ve en el selector.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_name_not_blank'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'response_templates_content_not_blank'
  ) THEN
    ALTER TABLE public.response_templates
      ADD CONSTRAINT response_templates_content_not_blank
      CHECK (length(btrim(content)) > 0);
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 3. Un atajo por workspace
-- ------------------------------------------------------------
-- Parcial sobre los vivos: un template borrado no tiene que reservar su atajo,
-- porque a los 30 dias lo purga el cron de F15 y mientras tanto nadie lo ve.

CREATE UNIQUE INDEX IF NOT EXISTS idx_response_templates_shortcut
  ON public.response_templates(workspace_id, shortcut)
  WHERE deleted_at IS NULL AND shortcut IS NOT NULL;

COMMENT ON COLUMN public.response_templates.shortcut IS
  'Atajo para elegir el template escribiendo "/" en la bandeja. Formato /minusculas-numeros, unico entre los templates vivos del workspace. NULL = el template se busca solo por nombre.';
