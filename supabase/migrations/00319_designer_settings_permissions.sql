-- ============================================================================
-- 00319_designer_settings_permissions  (Diseñador IA, D1)
-- ============================================================================
-- 1. `workspaces.design_settings` (estilos propios, fuentes agregadas y subidas, paleta extra) con su
--    validador de estructura `public.validate_design_settings(jsonb)` por trigger. La validación fina es
--    `lib/designer/settings-schema.ts` (Zod); los casos de `lib/designer/settings.cases.json` corren contra
--    las dos (vitest y `verify-designer --bloque ds0`).
-- 2. Permisos: el Member de sistema suma `designer.view` y `designer.edit` (cambio aprobado M12). Se
--    redefine `private.member_permission_keys()` COPIANDO la vigente (00250) letra por letra y sumando las
--    dos claves al final; `lib/auth/member-sql-parity.test.ts` la compara con `MEMBER_PERMISSION_KEYS`.
--    `designer.publish`, `designer.generate` y `designer.manage` quedan para Owner, Admin y los roles
--    personalizados que las tengan (no hace falta SQL: `has_permission` lee el catálogo de cada rol).
-- 3. Buckets PRIVADOS `design-assets` (imágenes subidas, fuentes y recursos de HTML cargados; 20 MB por
--    archivo) y `design-renders` (PNG y PDF generados). El primer segmento de la ruta es el workspace.
--    Lectura: miembros con `designer.view`. Escritura: solo el servidor (service_role), sin políticas.
--    Lectura pública NUNCA: el link público sirve archivos por una ruta del servidor (F44).
--
-- Aditiva + modifica la lista de permisos del Member. Va ANTES de desplegar el código.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS workspaces_design_settings_check ON public.workspaces;
--   DROP FUNCTION IF EXISTS public.workspaces_design_settings_check();
--   DROP FUNCTION IF EXISTS public.validate_design_settings(jsonb);
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS design_settings;
--   DROP POLICY IF EXISTS design_assets_select ON storage.objects;
--   DROP POLICY IF EXISTS design_renders_select ON storage.objects;
--   -- (vaciar los buckets antes) DELETE FROM storage.buckets WHERE id IN ('design-assets','design-renders');
--   -- y `private.member_permission_keys()` vuelve a la definición de 00250 (la misma de abajo SIN las dos
--   -- últimas claves `designer.view` y `designer.edit`).
-- Riesgo: medio (cambia lo que ve el Member de sistema: el menú suma «Diseñador IA»).
-- ============================================================================

-- ─── 1. Ajustes del Diseñador IA ────────────────────────────────────────────

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS design_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Gemela mínima de `designSettingsSchema` (estructura y tipos). Devuelve true o false, nunca NULL.
CREATE OR REPLACE FUNCTION public.validate_design_settings(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN false;
  END IF;
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN
    RETURN false;
  END IF;
  IF p ? 'palette' THEN
    IF jsonb_typeof(p -> 'palette') <> 'array' OR jsonb_array_length(p -> 'palette') > 24 THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'palette') LOOP
      IF jsonb_typeof(v_item) <> 'string' OR (v_item #>> '{}') !~ '^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$' THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  IF p ? 'fonts' THEN
    IF jsonb_typeof(p -> 'fonts') <> 'object' THEN
      RETURN false;
    END IF;
    IF (p -> 'fonts') ? 'google' THEN
      IF jsonb_typeof(p -> 'fonts' -> 'google') <> 'array' THEN
        RETURN false;
      END IF;
      FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'fonts' -> 'google') LOOP
        IF jsonb_typeof(v_item) <> 'string' THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
    IF (p -> 'fonts') ? 'uploaded' THEN
      IF jsonb_typeof(p -> 'fonts' -> 'uploaded') <> 'array' THEN
        RETURN false;
      END IF;
      FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'fonts' -> 'uploaded') LOOP
        IF jsonb_typeof(v_item) <> 'object'
           OR jsonb_typeof(v_item -> 'family') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v_item -> 'path') IS DISTINCT FROM 'string' THEN
          RETURN false;
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'styles' THEN
    IF jsonb_typeof(p -> 'styles') <> 'array' THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p -> 'styles') LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string'
         OR jsonb_typeof(v_item -> 'name') IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_design_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_design_settings(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.workspaces_design_settings_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.validate_design_settings(NEW.design_settings) THEN
    RAISE EXCEPTION 'Los ajustes del Diseñador IA no tienen la forma esperada' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.workspaces_design_settings_check() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspaces_design_settings_check ON public.workspaces;
CREATE TRIGGER workspaces_design_settings_check
  BEFORE INSERT OR UPDATE OF design_settings ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_design_settings_check();

-- ─── 2. Permisos del Member (cambio aprobado M12) ──────────────────────────
-- Copia de 00250 + `designer.view` y `designer.edit` al final.

CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view',
    'designer.view',
    'designer.edit'
  ]::text[]
$function$;
REVOKE ALL ON FUNCTION private.member_permission_keys() FROM PUBLIC, anon, authenticated;

-- ─── 3. Buckets privados ────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('design-assets', 'design-assets', false, 20971520, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('design-renders', 'design-renders', false, 52428800, ARRAY['image/png', 'application/pdf', 'application/zip'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Lectura: miembro con `designer.view` del workspace del primer segmento. Sin políticas de escritura
-- (sube y borra el servidor con el cliente de servicio, después de validar los bytes y el permiso).
DROP POLICY IF EXISTS design_assets_select ON storage.objects;
CREATE POLICY design_assets_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'design-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (SELECT public.has_permission(((storage.foldername(name))[1])::uuid, 'designer.view'))
);

DROP POLICY IF EXISTS design_renders_select ON storage.objects;
CREATE POLICY design_renders_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'design-renders'
  AND (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND (SELECT public.has_permission(((storage.foldername(name))[1])::uuid, 'designer.view'))
);
