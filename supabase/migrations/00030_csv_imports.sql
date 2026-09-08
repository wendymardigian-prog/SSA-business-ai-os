-- ============================================================
-- MIGRACION 00030 — REGISTRO DE IMPORTACIONES DE CSV (F19)
-- ============================================================
-- Una fila por importacion, con los contadores de que paso. Existe por dos
-- motivos que no cubre el audit log:
--
-- 1. El detalle de los errores. Cuando de 800 filas entran 780, lo que se
--    necesita es la lista de las 20 con el numero de fila y el motivo, para
--    corregir la planilla y volver a subirla. Eso no entra en una entrada de
--    audit_log.
-- 2. La barra de progreso. La importacion se manda en tandas, y esta fila es
--    donde se van acumulando los contadores mientras corre.
--
-- Decisiones:
--
-- - Sin deleted_at. No es contenido que alguien vaya a borrar; es evidencia de
--   una operacion, como el audit log. Se va con el workspace por cascade.
-- - finished_at separado de created_at: una importacion que se corto a la
--   mitad (se cerro la pestaña, se fue internet) se reconoce porque nunca lo
--   estampo, y ahi los contadores no suman total_rows.
-- - error_details arranca en array vacio y no en null, para que sumar errores
--   no tenga que distinguir el primero de los demas. La app corta el detalle a
--   los primeros 200: 10.000 filas malas con un mensaje cada una serian varios
--   MB en una sola fila.
--
-- RLS espejo del audit_log: Owner y Admin ven todas las importaciones del
-- workspace, un Member solo las suyas. Sin DELETE ni por parte del dueño.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.csv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,

  imported integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,

  -- [{ line: 7, error: "Email: formato invalido" }, ...]
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL mientras corre; se estampa al cerrar.
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_csv_imports_workspace
  ON public.csv_imports(workspace_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_file_name_not_blank'
  ) THEN
    ALTER TABLE public.csv_imports
      ADD CONSTRAINT csv_imports_file_name_not_blank
      CHECK (length(btrim(file_name)) > 0);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'csv_imports_error_details_is_array'
  ) THEN
    ALTER TABLE public.csv_imports
      ADD CONSTRAINT csv_imports_error_details_is_array
      CHECK (jsonb_typeof(error_details) = 'array');
  END IF;
END;
$$;

COMMENT ON TABLE public.csv_imports IS
  'Una fila por importacion de CSV (F19): contadores, detalle de los errores y quien la corrio. Sin soft delete, como el audit log.';
COMMENT ON COLUMN public.csv_imports.finished_at IS
  'NULL mientras la importacion corre. Una que quedo con NULL y contadores que no suman total_rows es una que se corto a la mitad.';
COMMENT ON COLUMN public.csv_imports.error_details IS
  'Array de { line, error } con el numero de fila como lo ve la persona en la planilla. La app lo corta en los primeros 200.';

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
-- Quien importo puede seguir escribiendo sobre su propia fila mientras corre
-- (los contadores de cada tanda). Nadie puede tocar la de otro, y nadie borra.

ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "csv_imports_select" ON public.csv_imports;
CREATE POLICY "csv_imports_select" ON public.csv_imports
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND imported_by = auth.uid())
  );

DROP POLICY IF EXISTS "csv_imports_insert" ON public.csv_imports;
CREATE POLICY "csv_imports_insert" ON public.csv_imports
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  );

DROP POLICY IF EXISTS "csv_imports_update" ON public.csv_imports;
CREATE POLICY "csv_imports_update" ON public.csv_imports
  FOR UPDATE USING (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id) AND imported_by = auth.uid()
  );
