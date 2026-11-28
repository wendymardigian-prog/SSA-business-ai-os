-- @plantilla-quitar(servicios)
-- ============================================================
-- 00538_program_resource_downloads.sql
-- ============================================================
-- Recursos descargables del portal (zip de un plugin, plantillas, proyectos): quien bajo que y cuando.
--
--   * El bucket privado `program-resources` pasa de 20 MB a 45 MB por archivo (el tope de las Server Actions es 51 MB).
--   * Tabla `app_servicio_portal.resource_downloads`: una fila por cada link de descarga que SSA firma para un
--     estudiante. Sin `contact_id` a proposito (la persona sale de la cuenta del portal y del servicio): asi
--     `merge_contacts` no la tiene que tocar.
--   * `app_servicio.portal_log_resource_download(sesion, clase, recurso)`: la llama SSA (`/api/portal/file`) DESPUES de
--     firmar el link. Solo `service_role`. NUNCA lanza: anotar nunca frena una descarga. Una sesion de vista previa
--     (`preview`, alguien del equipo mirando como estudiante) no se anota.
--   * `app_servicio.svc_resource_downloads(servicio)`: lo que ve la ficha del servicio. Quien llama tiene que poder ver
--     el servicio (`can_see_service_row`, mismo patron que la 00361).
--
-- El contrato con el portal NO cambia: el portal sigue pidiendo el archivo igual que siempre.
-- Aditiva. Puede ir antes o despues del codigo (sin ella, la descarga sale igual y la ficha no muestra «Descargas»).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS app_servicio.svc_resource_downloads(uuid);
--   DROP FUNCTION IF EXISTS app_servicio.portal_log_resource_download(text, uuid, text);
--   DROP TABLE IF EXISTS app_servicio_portal.resource_downloads;
--   UPDATE storage.buckets SET file_size_limit = 20971520 WHERE id = 'program-resources';
-- ============================================================

UPDATE storage.buckets SET file_size_limit = 47185920 WHERE id = 'program-resources';

CREATE TABLE IF NOT EXISTS app_servicio_portal.resource_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id uuid,
  account_id uuid NOT NULL,
  program_item_id uuid NOT NULL,
  resource_id text NOT NULL,
  resource_name text,
  downloaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_downloads_service_idx ON app_servicio_portal.resource_downloads (service_id, downloaded_at DESC);
CREATE INDEX IF NOT EXISTS resource_downloads_item_idx ON app_servicio_portal.resource_downloads (program_item_id, resource_id);
ALTER TABLE app_servicio_portal.resource_downloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.resource_downloads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_servicio_portal.resource_downloads TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.portal_log_resource_download(p_session text, p_item_id uuid, p_ref text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  sess jsonb;
  pf jsonb;
  i app_servicio.program_items;
  v_name text;
BEGIN
  sess := app_servicio_portal.session_resolve(p_session, false);
  IF sess ->> 'kind' IS DISTINCT FROM 'student' OR sess ->> 'account_id' IS NULL THEN RETURN; END IF;
  SELECT * INTO i FROM app_servicio.program_items WHERE id = p_item_id AND workspace_id = (sess ->> 'workspace_id')::uuid;
  IF i.id IS NULL THEN RETURN; END IF;
  SELECT r ->> 'name' INTO v_name FROM jsonb_array_elements(COALESCE(i.resources, '[]'::jsonb)) r
   WHERE r ->> 'id' = p_ref AND r ->> 'kind' = 'file' LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  BEGIN
    pf := app_servicio_portal.program_for(sess, i.product_id);
  EXCEPTION WHEN OTHERS THEN
    pf := NULL; -- sin servicio igual se anota (la ficha no la muestra, pero queda el registro)
  END;
  INSERT INTO app_servicio_portal.resource_downloads (workspace_id, service_id, account_id, program_item_id, resource_id, resource_name)
  VALUES (i.workspace_id, NULLIF(pf ->> 'service_id', '')::uuid, (sess ->> 'account_id')::uuid, i.id, p_ref, left(v_name, 200));
EXCEPTION WHEN OTHERS THEN
  -- Anotar nunca frena una descarga.
  RETURN;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.portal_log_resource_download(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_log_resource_download(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION app_servicio.svc_resource_downloads(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', d.id, 'resource_name', d.resource_name, 'lesson_title', i.title, 'downloaded_at', d.downloaded_at)
                     ORDER BY d.downloaded_at DESC)
      FROM (SELECT * FROM app_servicio_portal.resource_downloads
             WHERE service_id = s.id AND workspace_id = s.workspace_id
             ORDER BY downloaded_at DESC LIMIT 100) d
      LEFT JOIN app_servicio.program_items i ON i.id = d.program_item_id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_resource_downloads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_resource_downloads(uuid) TO authenticated, service_role;
