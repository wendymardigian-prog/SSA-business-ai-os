-- ============================================================
-- 00266_workspace_brand
--
-- Varios negocios del mismo dueño en UNA instalacion (por ejemplo SSA y
-- BusinessXcelerator, con el mismo login y el selector de workspace).
--
-- 1. La marca y el tono del agente pasan a poder ser de cada workspace:
--    `brand_name`, `brand_logo_path`, `brand_color` y `ai_language_style`.
--    Todas nullable: vacias, el workspace usa la marca de la instalacion
--    (`NEXT_PUBLIC_BRAND_*` y `AI_LANGUAGE_STYLE`, ver lib/brand.ts y
--    lib/ai/language-style.ts). Un workspace que nunca las toca se ve igual
--    que antes. Las escribe el servidor con el cliente de servicio despues de
--    chequear `settings.general` (como el resto de Ajustes): la politica de
--    UPDATE de `workspaces` no se toca.
--
-- 2. Bucket PUBLICO `brand-assets` para el logo: va en emails y en paginas
--    publicas, donde un link firmado venceria. Primer segmento del path = el
--    workspace. Sin policies: sube y borra solo el service role, y se lee por
--    la URL publica. Cada logo nuevo es un archivo nuevo (nunca se pisa uno),
--    asi un cache viejo no muestra el logo equivocado.
--
-- 3. El usuario de la agenda es unico en TODA la instalacion. El link publico
--    es /calendario/<usuario>/<evento>, sin el negocio, y la busqueda
--    (`findPublicEvent`) es por usuario solo: con el mismo usuario en dos
--    workspaces, las dos agendas daban 404. El indice viejo por workspace
--    (`uq_scheduling_profiles_ws_username`, 00095) queda como estaba.
--    Aborta si ya hubiera usuarios repetidos entre workspaces.
--
-- Volver atras:
--   DROP INDEX IF EXISTS public.uq_scheduling_profiles_username_global;
--   ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_brand_color_check,
--     DROP CONSTRAINT IF EXISTS workspaces_brand_name_check,
--     DROP CONSTRAINT IF EXISTS workspaces_ai_language_style_check,
--     DROP COLUMN IF EXISTS brand_name, DROP COLUMN IF EXISTS brand_logo_path,
--     DROP COLUMN IF EXISTS brand_color, DROP COLUMN IF EXISTS ai_language_style;
--   (el bucket se borra desde el panel, despues de vaciarlo)
-- Riesgo: bajo (aditiva). Se puede aplicar antes de desplegar el codigo.
-- ============================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Marca por workspace
-- ------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS brand_logo_path text,
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS ai_language_style text;

DO $$
BEGIN
  -- El color se inyecta como texto en un <style>: solo #rrggbb, nada de CSS arbitrario.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_brand_color_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_brand_color_check
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_brand_name_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_brand_name_check
      CHECK (brand_name IS NULL OR char_length(btrim(brand_name)) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_language_style_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_language_style_check
      CHECK (ai_language_style IS NULL OR char_length(btrim(ai_language_style)) BETWEEN 1 AND 200);
  END IF;
  -- El logo vive en el bucket de abajo, adentro de la carpeta de SU workspace.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_brand_logo_path_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_brand_logo_path_check
      CHECK (brand_logo_path IS NULL OR brand_logo_path LIKE id::text || '/logo/%');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.brand_name IS
  'Nombre del negocio que ven los leads (formularios, contratos, agenda, emails). NULL = el de la instalacion (NEXT_PUBLIC_BRAND_NAME).';
COMMENT ON COLUMN public.workspaces.brand_logo_path IS
  'Path del logo en el bucket publico brand-assets (<workspace>/logo/<id>.<ext>). NULL = el de la instalacion.';
COMMENT ON COLUMN public.workspaces.brand_color IS
  'Color principal en #rrggbb. NULL = el de la instalacion (NEXT_PUBLIC_BRAND_COLOR).';
COMMENT ON COLUMN public.workspaces.ai_language_style IS
  'Como escribe la IA de este negocio, por ejemplo "español rioplatense (vos/tenés)". NULL = AI_LANGUAGE_STYLE.';

-- ------------------------------------------------------------
-- 2. Bucket del logo
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'brand-assets',
  'brand-assets',
  true,
  524288,  -- 500 KB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 3. Usuario de agenda unico en toda la instalacion
-- ------------------------------------------------------------
DO $$
DECLARE
  v_dups text;
BEGIN
  SELECT string_agg(u, ', ') INTO v_dups
  FROM (
    SELECT lower(username) AS u
    FROM public.scheduling_profiles
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) d;
  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'Hay usuarios de agenda repetidos entre workspaces (%): cambialos antes de aplicar la 00266', v_dups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_username_global
  ON public.scheduling_profiles (lower(username));
