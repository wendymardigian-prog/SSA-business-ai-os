-- ============================================================================
-- 00180 — Reportes de fin de dia: la tabla `eod_reports` y quien ve que
-- ============================================================================
-- Una fila por persona, formulario y dia. Mientras se completa esta en 'draft' (el borrador
-- que se guarda solo todo el dia); al enviar pasa a 'submitted'. La persona que reporta sale
-- SIEMPRE de la sesion (lo hace cumplir el servidor, que es el unico que escribe).
--
-- - La unicidad (form_id, user_id, report_date) la da un indice unico, no una consulta previa:
--   doble clic o dos pestanas enviando a la vez = un solo reporte.
-- - `rev` es la revision del borrador: el guardado solo acepta el que viene de la vigente.
-- - `pending_edit` es la copia de trabajo de un reporte YA enviado que se esta corrigiendo
--   (modo "se puede corregir"): lo enviado no cambia hasta el proximo "Enviar". Esa columna NO
--   se le da a leer a `authenticated` (privilegio por columna, mismo patron que los costos de
--   `agents` en la 00060): quien ve los reportes enviados de todos no ve una correccion a medio
--   hacer. El duenio la lee desde el servidor.
-- - RLS: cada uno ve los suyos (enviados y borradores); Owner, Admin y un rol con
--   `eod.view_all` ven los ENVIADOS de todos. Los borradores ajenos no los ve nadie.
-- - Escribe solo el servidor (Server Actions con el cliente de servicio). Nadie borra.
--
-- Como volver atras (no hay datos de otras tablas que dependan de esta):
--   DROP TABLE IF EXISTS public.eod_reports;
--   DROP FUNCTION IF EXISTS public.can_view_eod_all(uuid);
-- Riesgo: bajo (aditiva).
-- ============================================================================

SET search_path = '';

CREATE TABLE IF NOT EXISTS public.eod_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  -- La version con la que se envio (null mientras es borrador).
  form_version_id uuid REFERENCES public.form_versions(id) ON DELETE SET NULL,
  -- Quien reporta: la persona de la sesion, nunca un selector.
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- El dia que reporta, en SU zona horaria (user_preferences), no la del workspace.
  report_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  -- Borrador: { <clave>: valor }. Enviado: { <clave>: { label, type, value } }.
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Borrador: { <canal>: { selected, answers } } (incluye los apagados, con selected=false).
  -- Enviado: { <canal>: { label, answers: { <clave>: { label, type, value } } } }, solo los elegidos.
  channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Totales por metricKey, por canal y en total. Se calcula al enviar.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- La correccion en curso de un reporte enviado ({ answers, channels } como en el borrador).
  pending_edit jsonb,
  rev integer NOT NULL DEFAULT 0 CHECK (rev >= 0),
  saved_at timestamptz,
  submitted_at timestamptz,
  edited_at timestamptz,
  edit_count integer NOT NULL DEFAULT 0 CHECK (edit_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eod_reports_submitted_at CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);

COMMENT ON TABLE public.eod_reports IS
  'Reportes de fin de dia (EOD): una fila por persona, formulario y dia. Escribe solo el servidor; nadie borra.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_eod_reports_form_user_date
  ON public.eod_reports (form_id, user_id, report_date);
CREATE INDEX IF NOT EXISTS idx_eod_reports_form_date
  ON public.eod_reports (form_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_eod_reports_ws_user_date
  ON public.eod_reports (workspace_id, user_id, report_date DESC);

DROP TRIGGER IF EXISTS set_updated_at ON public.eod_reports;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.eod_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- Quien ve los reportes ENVIADOS de todo el equipo
-- ------------------------------------------------------------
-- Owner y Admin, o un rol personalizado con `eod.view_all`. El rol de sistema Member NO la
-- tiene (su baseline vive en lib/auth/permissions.ts), por eso no hay rama para el.
CREATE OR REPLACE FUNCTION public.can_view_eod_all(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_workspace_admin(p_workspace_id) THEN true
    ELSE COALESCE((
      SELECT COALESCE(r.permissions -> 'keys' @> to_jsonb(ARRAY['eod.view_all']), false)
      FROM public.workspace_members m
      JOIN public.workspace_roles r ON r.id = m.role_id
      WHERE m.workspace_id = p_workspace_id
        AND m.user_id = auth.uid()
        AND r.system_role IS NULL
    ), false)
  END;
$$;

REVOKE ALL ON FUNCTION public.can_view_eod_all(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_eod_all(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.eod_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eod_reports_select ON public.eod_reports;
CREATE POLICY eod_reports_select ON public.eod_reports
  FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND (
      user_id = (SELECT auth.uid())
      OR (status = 'submitted' AND public.can_view_eod_all(workspace_id))
    )
  );

-- Sin policies de INSERT, UPDATE ni DELETE: escribe el servidor y nadie borra.
REVOKE ALL ON public.eod_reports FROM anon;
REVOKE ALL ON public.eod_reports FROM authenticated;
GRANT SELECT (
  id, workspace_id, form_id, form_version_id, user_id, report_date, status,
  answers, channels, metrics, rev, saved_at, submitted_at, edited_at, edit_count,
  created_at, updated_at
) ON public.eod_reports TO authenticated;
GRANT ALL ON public.eod_reports TO service_role;
