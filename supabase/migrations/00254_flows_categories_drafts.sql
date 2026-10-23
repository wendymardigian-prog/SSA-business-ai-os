-- ============================================================
-- 00254_flows_categories_drafts
-- ============================================================
-- Auditoria de automatizaciones (octubre 2026). Tres cosas en la tabla
-- `flows`, sin tablas nuevas:
--
--   categories        text[]  Las categorias de la automatizacion: palabras o
--                             frases libres, varias por flujo, que el
--                             buscador de la lista filtra. La lista de
--                             sugerencias sale de las que ya usan los demas
--                             flujos (no hay catalogo aparte). Vacio = sin
--                             categoria.
--   draft_nodes       jsonb   Los cambios SIN PUBLICAR de una automatizacion
--   draft_edges       jsonb   que ya esta publicada. Lo que corre sigue
--   draft_updated_at  tstz    siendo `nodes`/`edges`; "Publicar cambios" copia
--                             el borrador encima y lo vacia. NULL = no hay
--                             cambios pendientes. Un flujo en borrador (que
--                             no corre) sigue guardando directo en `nodes`.
--
-- La descripcion ya existia (`flows.description`, 00001): solo faltaba
-- mostrarla y editarla.
--
-- Por que columnas y no correr desde `flow_versions`: el motor, las sesiones
-- en curso y los editores de Formularios, Agenda, EOD y Cobranza siguen
-- leyendo y escribiendo `flows.nodes` exactamente igual que antes.
--
-- Aditiva: nada lee estas columnas hasta desplegar el codigo nuevo, y el
-- codigo nuevo las necesita, asi que se aplica ANTES de desplegar.
-- Las columnas nuevas heredan la RLS de `flows` (00214: leer flows.view,
-- escribir flows.edit) y los permisos de la tabla.
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_flows_categories;
--   ALTER TABLE public.flows DROP COLUMN IF EXISTS draft_updated_at,
--                            DROP COLUMN IF EXISTS draft_edges,
--                            DROP COLUMN IF EXISTS draft_nodes,
--                            DROP COLUMN IF EXISTS categories;
--
-- Idempotente: IF NOT EXISTS y un DO para el CHECK.
-- ============================================================

ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS draft_nodes jsonb;
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS draft_edges jsonb;
ALTER TABLE public.flows
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;

-- Hasta 10 categorias por flujo (la app normaliza y recorta; esto es la red).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flows_categories_max'
  ) THEN
    ALTER TABLE public.flows
      ADD CONSTRAINT flows_categories_max CHECK (cardinality(categories) <= 10);
  END IF;
END $$;

-- El filtro de la lista: "flujos con esta categoria" (`categories @> array[...]`).
CREATE INDEX IF NOT EXISTS idx_flows_categories
  ON public.flows USING gin (categories);

COMMENT ON COLUMN public.flows.categories IS
  'Categorias libres de la automatizacion (varias). Las sugerencias salen de las que usan los demas flujos.';
COMMENT ON COLUMN public.flows.draft_nodes IS
  'Cambios sin publicar de una automatizacion publicada. NULL = no hay. Publicar los copia a nodes.';
