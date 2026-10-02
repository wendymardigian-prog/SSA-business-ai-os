-- ============================================================
-- MIGRACION 00106 — se elimina response_templates (reemplazada por response_assets)
-- ============================================================
-- La 00105 de esta misma tanda crea `response_assets`, que reemplaza tanto a
-- `response_templates` (textos, Fase 1, vacia en produccion) como a la vieja
-- `audio_assets` (nunca aplicada). Esta migracion saca la tabla vieja de
-- textos y, en el mismo paso, redefine `purge_soft_deleted` para que
-- purgue `response_assets` en lugar de `response_templates`.
--
-- Por que las dos cosas van juntas, en esta migracion y no en la 00105: la
-- funcion nombra cada tabla a mano y plpgsql resuelve esos nombres en tiempo
-- de ejecucion.
--   - Si la 00105 sacara `response_templates` de la funcion, la tabla
--     dejaria de purgarse en la ventana entre las dos migraciones.
--   - Si la 00105 sumara `response_assets` sin sacar la otra, el DROP TABLE
--     de esta migracion dejaria la funcion apuntando a una tabla
--     inexistente y el cron de las 4 AM empezaria a fallar.
-- Haciendo las dos cosas en la misma transaccion, cada punto intermedio
-- queda consistente.
--
-- La guarda de abajo comprueba que no haya NINGUNA fila (ni siquiera
-- borrada logicamente) antes de dropear. Verificado el 1/10/2026 contra
-- produccion: 0 filas, activas y borradas. Si alguna vez hubiera datos, esta
-- migracion ABORTA y no los toca -- la decision de que hacer con ellos no es
-- de una migracion.
--
-- ── Para revertir: esto es exactamente lo que se dropea ──────────────────
--
-- La tabla (00023_crm_tables.sql:109-138):
--
--   CREATE TABLE IF NOT EXISTS public.response_templates (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
--     name text NOT NULL,
--     content text NOT NULL,
--     shortcut text,
--     created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
--     created_at timestamptz NOT NULL DEFAULT now(),
--     updated_at timestamptz NOT NULL DEFAULT now(),
--     deleted_at timestamptz
--   );
--
--   CREATE INDEX IF NOT EXISTS idx_response_templates_workspace
--     ON public.response_templates(workspace_id, name) WHERE deleted_at IS NULL;
--   CREATE INDEX IF NOT EXISTS idx_response_templates_deleted_at
--     ON public.response_templates(deleted_at) WHERE deleted_at IS NOT NULL;
--
--   DROP TRIGGER IF EXISTS set_updated_at ON public.response_templates;
--   CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.response_templates
--     FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
--
-- Los 3 CHECKs y el UNIQUE parcial (00026_response_templates_shortcut.sql:61-109):
--
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_shortcut_format
--     CHECK (shortcut IS NULL OR shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$');
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_name_not_blank
--     CHECK (length(btrim(name)) > 0);
--   ALTER TABLE public.response_templates
--     ADD CONSTRAINT response_templates_content_not_blank
--     CHECK (length(btrim(content)) > 0);
--
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_response_templates_shortcut
--     ON public.response_templates(workspace_id, shortcut)
--     WHERE deleted_at IS NULL AND shortcut IS NOT NULL;
--
-- Las policies (00023_crm_tables.sql:220-239):
--
--   ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "response_templates_select" ON public.response_templates
--     FOR SELECT USING (deleted_at IS NULL AND public.is_workspace_member(workspace_id));
--   CREATE POLICY "response_templates_insert" ON public.response_templates
--     FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
--   CREATE POLICY "response_templates_update" ON public.response_templates
--     FOR UPDATE USING (public.is_workspace_admin(workspace_id))
--     WITH CHECK (public.is_workspace_admin(workspace_id));
--   CREATE POLICY "response_templates_delete" ON public.response_templates
--     FOR DELETE USING (public.is_workspace_admin(workspace_id));
--
-- Para revertir: recrear lo de arriba y despues volver a poner
-- `response_templates`/`v_templates` en `purge_soft_deleted` (ver la version
-- de la 00098_event_types.sql como base).
-- ============================================================

-- ------------------------------------------------------------
-- 1. La guarda: no se borra ningun dato
-- ------------------------------------------------------------

DO $$
DECLARE v_pendientes integer;
BEGIN
  -- count(*) SIN filtrar deleted_at: una fila borrada logicamente sigue
  -- siendo un dato de alguien. Si hay algo adentro, esta migracion NO lo
  -- borra: aborta y lo dice.
  SELECT count(*) INTO v_pendientes FROM public.response_templates;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION
      'response_templates tiene % fila(s) y esta migracion no borra datos. Pasalas a response_assets con kind = ''text'' (name, content, shortcut, created_by, created_at se copian tal cual) y volve a correrla.',
      v_pendientes;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Se dropea la tabla vieja
-- ------------------------------------------------------------
-- Ninguna FK apunta a response_templates, asi que esto no arrastra nada. Las
-- filas de audit_log con entity_type = 'response_template' sobreviven: esa
-- columna es texto libre sin FK (00023_crm_tables.sql:79-85), y la historia
-- es historia.

DROP TABLE IF EXISTS public.response_templates;

-- ------------------------------------------------------------
-- 3. purge_soft_deleted pasa a purgar response_assets
-- ------------------------------------------------------------
-- Copia completa de la definicion vigente (00098_event_types.sql:173-235),
-- con dos cambios: sale v_templates (y su DELETE sobre response_templates),
-- entra v_assets (y su DELETE sobre response_assets), y la clave del jsonb
-- cambia de nombre junto con la variable. El resto -- incluida la condicion
-- de event_types contra bookings -- queda textual.

CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_assets     integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_assets = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta
  -- al evento. (bookings llega en la 00099; antes de eso la condicion de
  -- existencia da falso y se purgan todos los borrados.)
  IF to_regclass('public.bookings') IS NULL THEN
    DELETE FROM public.event_types WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  ELSE
    EXECUTE '
      DELETE FROM public.event_types e
      WHERE e.deleted_at IS NOT NULL AND e.deleted_at < $1
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id)
    ' USING v_cutoff;
  END IF;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_assets', v_assets,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_soft_deleted(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_soft_deleted(integer) TO service_role;
