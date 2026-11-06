-- 00300_calls_catalog_classification (6/11/2026)
--
-- Las grabaciones se clasifican con la MISMA lista de areas y tipos que la agenda
-- (`booking_categories`), y una grabacion vinculada a una reunion hereda su area y su tipo.
--
--   1. `booking_categories.description`: opcional, le dice a la IA que significa cada tipo.
--   2. `booking_categories.system_key`: una clave que NO cambia aunque se renombre el area o
--      el tipo. Con ella el codigo sabe que "Comercial" sigue siendo el area de ventas.
--   3. `calls`: `area_id`, `category_id` (el tipo o, si no hay, el area), `category_snapshot`
--      (la misma forma que en `bookings`), `classification_source`, `no_show` y
--      `analyzed_category_id` (con que clasificacion se analizo, para ofrecer regenerar).
--   4. Conversion de lo que ya existe: los tipos propios de cada negocio pasan a la lista,
--      bajo Otros, y cada grabacion toma su area y su tipo.
--
-- `call_type` NO se borra: queda como valor derivado hasta la Etapa 3, porque de el dependen el
-- resumen, Conocimiento y los puntajes. Sale de `legacyCallTypeFor` (lib/calls/catalog.ts).
--
-- Aditiva: va ANTES de desplegar el codigo (la clasificacion y la lista leen estas columnas).
--
-- Para volver atras (borra lo clasificado con esto; `call_type` queda como estaba o derivado):
--   DROP TRIGGER IF EXISTS booking_categories_system_key ON public.booking_categories;
--   DROP FUNCTION IF EXISTS private.booking_category_system_key();
--   DROP INDEX IF EXISTS public.uq_booking_categories_system_key;
--   DROP INDEX IF EXISTS public.idx_calls_area;
--   DROP INDEX IF EXISTS public.idx_calls_category;
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS analyzed_category_id, DROP COLUMN IF EXISTS no_show,
--     DROP COLUMN IF EXISTS classification_source, DROP COLUMN IF EXISTS category_snapshot,
--     DROP COLUMN IF EXISTS category_id, DROP COLUMN IF EXISTS area_id;
--   ALTER TABLE public.booking_categories DROP COLUMN IF EXISTS system_key, DROP COLUMN IF EXISTS description;

-- ── La lista: descripcion y clave estable ────────────────────────────────

ALTER TABLE public.booking_categories ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.booking_categories ADD COLUMN IF NOT EXISTS system_key text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_categories_description_check') THEN
    ALTER TABLE public.booking_categories ADD CONSTRAINT booking_categories_description_check
      CHECK (description IS NULL OR char_length(description) <= 400);
  END IF;
END $$;

COMMENT ON COLUMN public.booking_categories.description IS
  'Opcional: cuando se usa este tipo. Lo lee la IA al clasificar una grabacion.';
COMMENT ON COLUMN public.booking_categories.system_key IS
  'Clave estable de las areas y tipos que el codigo reconoce (ventas, ventas.cierre, servicio, equipo, otros). No cambia al renombrar.';

UPDATE public.booking_categories
   SET system_key = lower(name)
 WHERE system_key IS NULL AND parent_id IS NULL AND archived_at IS NULL
   AND lower(name) IN ('ventas', 'servicio', 'equipo', 'otros');

UPDATE public.booking_categories t
   SET system_key = 'ventas.' || lower(t.name)
  FROM public.booking_categories a
 WHERE t.system_key IS NULL AND t.parent_id = a.id AND a.system_key = 'ventas' AND t.archived_at IS NULL
   AND lower(t.name) IN ('triaje', 'cierre', 'seguimiento');

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_categories_system_key
  ON public.booking_categories (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND archived_at IS NULL;

-- Un negocio nuevo recibe las claves al precargarse sus areas y tipos. Si la clave ya la tiene
-- otra fila (se renombro y se creo una nueva con ese nombre), la nueva queda sin clave.
CREATE OR REPLACE FUNCTION private.booking_category_system_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_parent_key text;
BEGIN
  IF NEW.system_key IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.parent_id IS NULL THEN
    IF lower(NEW.name) IN ('ventas', 'servicio', 'equipo', 'otros') THEN v_key := lower(NEW.name); END IF;
  ELSE
    SELECT system_key INTO v_parent_key FROM public.booking_categories WHERE id = NEW.parent_id;
    IF v_parent_key = 'ventas' AND lower(NEW.name) IN ('triaje', 'cierre', 'seguimiento') THEN
      v_key := 'ventas.' || lower(NEW.name);
    END IF;
  END IF;
  IF v_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.booking_categories
     WHERE workspace_id = NEW.workspace_id AND system_key = v_key AND archived_at IS NULL
  ) THEN
    NEW.system_key := v_key;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.booking_category_system_key() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS booking_categories_system_key ON public.booking_categories;
CREATE TRIGGER booking_categories_system_key BEFORE INSERT ON public.booking_categories
  FOR EACH ROW EXECUTE FUNCTION private.booking_category_system_key();

-- ── Las grabaciones ──────────────────────────────────────────────────────

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS area_id uuid REFERENCES public.booking_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.booking_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS classification_source text,
  ADD COLUMN IF NOT EXISTS no_show boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analyzed_category_id uuid REFERENCES public.booking_categories(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_classification_source_check') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_classification_source_check
      CHECK (classification_source IS NULL OR classification_source IN ('human', 'booking', 'rule', 'connection', 'ai'));
  END IF;
END $$;

COMMENT ON COLUMN public.calls.area_id IS 'El area de la grabacion. null = Sin clasificar.';
COMMENT ON COLUMN public.calls.category_id IS 'El tipo de reunion o, si solo se sabe el area, el area.';
COMMENT ON COLUMN public.calls.category_snapshot IS 'Area y tipo con sus nombres, con la misma forma que bookings.category_snapshot.';
COMMENT ON COLUMN public.calls.classification_source IS 'Quien decidio: human, booking, rule, connection o ai. Lo elegido a mano nunca se pisa.';
COMMENT ON COLUMN public.calls.no_show IS 'Nadie se presento. Es una marca y no un tipo: una llamada de ventas sigue siendo de ventas. Evita el analisis y el resumen.';
COMMENT ON COLUMN public.calls.analyzed_category_id IS 'Con que clasificacion se hizo el ultimo analisis: si cambio despues, la ficha ofrece regenerarlo.';

CREATE INDEX IF NOT EXISTS idx_calls_area ON public.calls (workspace_id, area_id, recorded_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calls_category ON public.calls (workspace_id, category_id, recorded_at DESC) WHERE archived_at IS NULL;

-- ── Conversion de lo que ya existe ───────────────────────────────────────

-- Los tipos propios de cada negocio pasan a la lista, bajo Otros. Si ya hay uno con ese nombre, queda el que hay.
INSERT INTO public.booking_categories (workspace_id, parent_id, name, description, position)
SELECT w.id, a.id, left(btrim(t->>'nombre'), 40), nullif(left(t->>'descripcion', 400), ''), 100
  FROM public.workspaces w
  JOIN public.booking_categories a ON a.workspace_id = w.id AND a.system_key = 'otros'
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(w.ai_background_settings->'call_classification'->'custom_types') = 'array'
        THEN w.ai_background_settings->'call_classification'->'custom_types' ELSE '[]'::jsonb END
 ) AS t
 WHERE btrim(coalesce(t->>'nombre', '')) <> '' AND coalesce((t->>'archivado')::boolean, false) = false
ON CONFLICT DO NOTHING;

-- No show deja de ser un tipo.
UPDATE public.calls SET no_show = true WHERE call_type = 'no_show' AND no_show = false;

-- Primero el vinculo: lo no elegido a mano hereda el area y el tipo de su reunion.
UPDATE public.calls c
   SET area_id = (b.category_snapshot->>'area_id')::uuid,
       category_id = coalesce(b.category_snapshot->>'type_id', b.category_snapshot->>'area_id')::uuid,
       category_snapshot = b.category_snapshot,
       classification_source = 'booking'
  FROM public.bookings b
 WHERE c.booking_id = b.id AND c.area_id IS NULL AND coalesce(c.call_type_source, '') <> 'human'
   AND b.category_snapshot->>'area_id' IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.booking_categories x WHERE x.id = (b.category_snapshot->>'area_id')::uuid);

-- El resto, por su tipo viejo. `no_show` no dice nada del area, y lo que no se puede convertir queda Sin clasificar.
WITH target AS (
  SELECT c.id AS call_id, t.id AS target_id, t.parent_id, t.name AS target_name, c.call_type_source
    FROM public.calls c
    JOIN public.booking_categories t
      ON t.workspace_id = c.workspace_id AND t.archived_at IS NULL
     AND t.system_key = CASE c.call_type
       WHEN 'cierre' THEN 'ventas.cierre'
       WHEN 'venta' THEN 'ventas.cierre'
       WHEN 'seguimiento' THEN 'ventas.seguimiento'
       WHEN 'triaje' THEN 'ventas.triaje'
       WHEN 'equipo' THEN 'equipo'
       WHEN 'cliente' THEN 'servicio'
       WHEN 'clase' THEN 'servicio'
       WHEN 'otra' THEN 'otros'
     END
   WHERE c.area_id IS NULL
)
UPDATE public.calls c
   SET area_id = coalesce(x.parent_id, x.target_id),
       category_id = x.target_id,
       category_snapshot = jsonb_build_object(
         'area_id', coalesce(x.parent_id, x.target_id),
         'area_name', coalesce(a.name, x.target_name),
         'type_id', CASE WHEN x.parent_id IS NULL THEN NULL ELSE x.target_id END,
         'type_name', CASE WHEN x.parent_id IS NULL THEN NULL ELSE x.target_name END
       ),
       classification_source = CASE x.call_type_source WHEN 'human' THEN 'human' WHEN 'ai' THEN 'ai' WHEN 'rule' THEN 'rule' END
  FROM target x
  LEFT JOIN public.booking_categories a ON a.id = x.parent_id
 WHERE c.id = x.call_id;

-- Los tipos propios, por su nombre bajo Otros.
WITH custom AS (
  SELECT c.id AS call_id, t.id AS type_id, t.name AS type_name, a.id AS area_id, a.name AS area_name, c.call_type_source
    FROM public.calls c
    JOIN public.workspaces w ON w.id = c.workspace_id
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE WHEN jsonb_typeof(w.ai_background_settings->'call_classification'->'custom_types') = 'array'
          THEN w.ai_background_settings->'call_classification'->'custom_types' ELSE '[]'::jsonb END
   ) AS ct
    JOIN public.booking_categories a ON a.workspace_id = c.workspace_id AND a.system_key = 'otros'
    JOIN public.booking_categories t ON t.parent_id = a.id AND t.archived_at IS NULL
     AND lower(t.name) = lower(left(btrim(ct->>'nombre'), 40))
   WHERE c.area_id IS NULL AND c.call_type = ct->>'clave'
)
UPDATE public.calls c
   SET area_id = x.area_id,
       category_id = x.type_id,
       category_snapshot = jsonb_build_object('area_id', x.area_id, 'area_name', x.area_name, 'type_id', x.type_id, 'type_name', x.type_name),
       classification_source = CASE x.call_type_source WHEN 'human' THEN 'human' WHEN 'ai' THEN 'ai' WHEN 'rule' THEN 'rule' END
  FROM custom x
 WHERE c.id = x.call_id;

-- `call_type` derivado de lo heredado: una reunion de Servicio ya no queda como Cierre.
WITH derived AS (
  SELECT c.id AS call_id,
         CASE
           WHEN c.no_show THEN 'no_show'
           WHEN t.system_key IN ('ventas.cierre', 'ventas.seguimiento', 'ventas.triaje') THEN substring(t.system_key FROM 8)
           WHEN a.system_key = 'ventas' THEN 'cierre'
           WHEN a.system_key = 'servicio' THEN 'cliente'
           WHEN a.system_key = 'equipo' THEN 'equipo'
           ELSE 'otra'
         END AS legacy
    FROM public.calls c
    JOIN public.booking_categories a ON a.id = c.area_id
    LEFT JOIN public.booking_categories t ON t.id = c.category_id AND t.parent_id IS NOT NULL
   WHERE c.classification_source = 'booking'
)
UPDATE public.calls c
   SET call_type = d.legacy, call_type_rule = 'reunión vinculada', call_type_source = 'rule'
  FROM derived d
 WHERE c.id = d.call_id;
