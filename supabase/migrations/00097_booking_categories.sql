-- ============================================================================
-- 00097 — Categorias de agenda (Etapa 4, Bloque 3, F50)
-- ============================================================================
-- Una sola tabla con dos niveles: `parent_id` null = AREA; con `parent_id` =
-- TIPO dentro de esa area. Un trigger impide el tercer nivel.
--
-- Precarga por workspace (trigger + backfill): areas Ventas y Servicio
-- (`is_system`: se renombran, no se archivan) con sus tipos.
--
-- No hay borrado: se archiva (`archived_at`). La policy de DELETE no existe.
--
-- Idempotente y aditiva.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- null = area; con valor = tipo dentro de esa area.
  parent_id    uuid REFERENCES public.booking_categories(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Solo las areas tienen color.
  color        text,
  position     integer NOT NULL DEFAULT 0,
  -- Ventas y Servicio: se renombran, no se archivan.
  is_system    boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.booking_categories IS
  'Areas (parent_id null) y tipos (con parent_id) con los que se clasifican eventos y agendas. Maximo dos niveles.';
COMMENT ON COLUMN public.booking_categories.is_system IS
  'Ventas y Servicio vienen precargadas: se renombran pero no se archivan.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_categories_name_check') THEN
    ALTER TABLE public.booking_categories ADD CONSTRAINT booking_categories_name_check
      CHECK (char_length(btrim(name)) BETWEEN 1 AND 40);
  END IF;
END $$;

-- Unico por nivel, sin distinguir mayusculas, entre los NO archivados. El
-- coalesce evita areas duplicadas: en Postgres dos NULL no chocan entre si.
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_categories_name
  ON public.booking_categories (
    workspace_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_categories_ws
  ON public.booking_categories (workspace_id, parent_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON public.booking_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.booking_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Maximo dos niveles: el padre tiene que ser un area
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.booking_categories_two_levels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_grandparent uuid; v_parent_ws uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT parent_id, workspace_id INTO v_grandparent, v_parent_ws
  FROM public.booking_categories WHERE id = NEW.parent_id;

  IF v_parent_ws IS NULL THEN
    RAISE EXCEPTION 'la categoria padre no existe';
  END IF;
  IF v_parent_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'la categoria padre es de otro negocio';
  END IF;
  IF v_grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'solo hay dos niveles: un tipo no puede tener tipos adentro';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_categories_two_levels ON public.booking_categories;
CREATE TRIGGER booking_categories_two_levels
  BEFORE INSERT OR UPDATE OF parent_id ON public.booking_categories
  FOR EACH ROW EXECUTE FUNCTION public.booking_categories_two_levels();

-- ------------------------------------------------------------
-- Precarga por workspace
-- ------------------------------------------------------------
-- Las mismas areas y tipos que SYSTEM_AREAS en lib/scheduling/categories.ts
-- (hay un test que compara las dos listas).

CREATE OR REPLACE FUNCTION public.seed_booking_categories()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_ventas uuid; v_servicio uuid;
BEGIN
  INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
  VALUES (NEW.id, 'Ventas', '#2563eb', 0, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_ventas;

  INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
  VALUES (NEW.id, 'Servicio', '#0d9488', 1, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_servicio;

  IF v_ventas IS NOT NULL THEN
    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (NEW.id, v_ventas, 'Triaje', 0, true),
           (NEW.id, v_ventas, 'Cierre', 1, true),
           (NEW.id, v_ventas, 'Seguimiento', 2, true)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_servicio IS NOT NULL THEN
    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (NEW.id, v_servicio, 'Onboarding', 0, true),
           (NEW.id, v_servicio, 'Uno a uno', 1, true)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_booking_categories ON public.workspaces;
CREATE TRIGGER seed_booking_categories AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_booking_categories();

-- Backfill para los workspaces que ya existen.
DO $$
DECLARE r record; v_ventas uuid; v_servicio uuid;
BEGIN
  FOR r IN SELECT id FROM public.workspaces LOOP
    IF EXISTS (SELECT 1 FROM public.booking_categories WHERE workspace_id = r.id) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (r.id, 'Ventas', '#2563eb', 0, true) RETURNING id INTO v_ventas;
    INSERT INTO public.booking_categories (workspace_id, name, color, position, is_system)
    VALUES (r.id, 'Servicio', '#0d9488', 1, true) RETURNING id INTO v_servicio;

    INSERT INTO public.booking_categories (workspace_id, parent_id, name, position, is_system)
    VALUES (r.id, v_ventas, 'Triaje', 0, true),
           (r.id, v_ventas, 'Cierre', 1, true),
           (r.id, v_ventas, 'Seguimiento', 2, true),
           (r.id, v_servicio, 'Onboarding', 0, true),
           (r.id, v_servicio, 'Uno a uno', 1, true);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- Lectura: todos los miembros (hace falta para elegir y para filtrar).
-- Escritura: `scheduling.manage_categories`, o admin (has_permission devuelve
-- false para el rol Member de sistema, que efectivamente no lo tiene).
-- DELETE: nadie. Se archiva.

ALTER TABLE public.booking_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "booking_categories_select" ON public.booking_categories;
CREATE POLICY "booking_categories_select" ON public.booking_categories
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "booking_categories_insert" ON public.booking_categories;
CREATE POLICY "booking_categories_insert" ON public.booking_categories
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  );

DROP POLICY IF EXISTS "booking_categories_update" ON public.booking_categories;
CREATE POLICY "booking_categories_update" ON public.booking_categories
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'scheduling.manage_categories')
  );
