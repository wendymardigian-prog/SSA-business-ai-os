-- 00303_call_analysis_profiles (6/11/2026)
--
-- Un analizador por tipo de reunion: cada tipo (o area) tiene su formato, su rubrica, sus
-- instrucciones y sus reglas, porque un cierre no se evalua como un seguimiento ni como una
-- reunion de servicio. Una grabacion busca el perfil de su tipo, despues el de su area, y si no
-- hay ninguno NO se analiza.
--
--   1. `call_analysis_profiles`: una fila viva por tipo o area. Escribe solo el servidor, con
--      `calls.configure`. Es una tabla y no una clave de `ai_background_settings` porque dos personas
--      guardando dos tipos a la vez se pisarian, y una fila invalida ahi resetea toda la configuracion.
--   2. `ai_task_prompt_versions.variant`: las instrucciones de cada perfil usan el mismo historial,
--      con su propia numeracion. `variant` NULL = las instrucciones generales de la tarea.
--   3. `calls.analysis_profile_id`: con que perfil se analizo. `rubric_snapshot` sigue guardando la
--      copia: un analisis viejo no cambia si despues se edita el perfil.
--   4. Lo que ya existe: quien tenia guardada la configuracion de analisis arranca con un perfil por
--      cada tipo de ventas que analizaba, con su rubrica, su modo y sus instrucciones. Asi el negocio
--      que analizaba solo no deja de hacerlo, y el que lo hacia a mano sigue a mano.
--
-- Aditiva: va ANTES de desplegar el codigo. No analiza nada ni gasta IA.
--
-- Para volver atras:
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS analysis_profile_id;
--   DROP INDEX IF EXISTS public.uq_ai_task_prompt_versions_workspace_task_variant_version;
--   DELETE FROM public.ai_task_prompt_versions WHERE variant IS NOT NULL;
--   ALTER TABLE public.ai_task_prompt_versions DROP COLUMN IF EXISTS variant;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_prompt_versions_workspace_task_version
--     ON public.ai_task_prompt_versions(workspace_id, task, version);
--   DROP TABLE IF EXISTS public.call_analysis_profiles;

CREATE TABLE IF NOT EXISTS public.call_analysis_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Un tipo de reunion o, como respaldo de los tipos que no tienen el suyo, un area.
  category_id           uuid NOT NULL REFERENCES public.booking_categories(id) ON DELETE CASCADE,
  shape                 text NOT NULL DEFAULT 'general' CHECK (shape IN ('sales', 'general')),
  mode                  text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual', 'auto')),
  rules                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- NULL = la rubrica de arranque del formato.
  rubric                jsonb,
  auto_summary          boolean NOT NULL DEFAULT true,
  auto_memory           boolean NOT NULL DEFAULT true,
  auto_knowledge        boolean NOT NULL DEFAULT false,
  -- NULL = las instrucciones generales de la tarea (o las del formato general).
  active_prompt_version integer,
  archived_at           timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.call_analysis_profiles IS
  'Un analizador por tipo de reunion o area: formato, rubrica, instrucciones y cuando corre. Sin perfil, la grabacion no se analiza.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_call_analysis_profiles_category
  ON public.call_analysis_profiles (workspace_id, category_id)
  WHERE archived_at IS NULL;

ALTER TABLE public.call_analysis_profiles ENABLE ROW LEVEL SECURITY;

-- Lo lee cualquier miembro: la ficha necesita saber si el tipo tiene analizador. Escribe solo el servidor.
DROP POLICY IF EXISTS call_analysis_profiles_select ON public.call_analysis_profiles;
CREATE POLICY call_analysis_profiles_select ON public.call_analysis_profiles
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));

REVOKE ALL ON public.call_analysis_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.call_analysis_profiles FROM authenticated;
GRANT SELECT ON public.call_analysis_profiles TO authenticated;
GRANT ALL ON public.call_analysis_profiles TO service_role;

-- ── Las instrucciones de cada perfil ─────────────────────────────────────

ALTER TABLE public.ai_task_prompt_versions
  ADD COLUMN IF NOT EXISTS variant uuid REFERENCES public.call_analysis_profiles(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.ai_task_prompt_versions.variant IS
  'El perfil de analisis al que pertenece esta version. NULL = las instrucciones generales de la tarea. Cada uno numera aparte.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_prompt_versions_workspace_task_variant_version
  ON public.ai_task_prompt_versions (workspace_id, task, COALESCE(variant, '00000000-0000-0000-0000-000000000000'::uuid), version);
DROP INDEX IF EXISTS public.uq_ai_task_prompt_versions_workspace_task_version;

-- ── Con que perfil se analizo ────────────────────────────────────────────

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS analysis_profile_id uuid REFERENCES public.call_analysis_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.calls.analysis_profile_id IS
  'El perfil con el que se hizo el ultimo analisis. La rubrica de ese momento esta en rubric_snapshot.';

-- ── Lo que ya existe ─────────────────────────────────────────────────────

-- Un perfil por cada tipo de ventas que el negocio analizaba, con los criterios que aplicaban a ese tipo.
INSERT INTO public.call_analysis_profiles (workspace_id, category_id, shape, mode, rubric, auto_summary, auto_knowledge)
SELECT
  w.id,
  c.id,
  'sales',
  CASE WHEN x.s ->> 'mode' = 'now' THEN 'auto' ELSE 'manual' END,
  CASE WHEN jsonb_typeof(x.s -> 'rubric') = 'object' THEN
    jsonb_set(x.s -> 'rubric', '{closer}', COALESCE((
      SELECT jsonb_agg(item)
        FROM jsonb_array_elements(COALESCE(x.s #> '{rubric,closer}', '[]'::jsonb)) AS item
       WHERE NOT (item ? 'aplica_a') OR (item -> 'aplica_a') ? m.legacy
    ), '[]'::jsonb))
  END,
  CASE WHEN jsonb_typeof(x.s -> 'auto_summary') = 'boolean' THEN (x.s ->> 'auto_summary')::boolean ELSE true END,
  CASE WHEN jsonb_typeof(x.s -> 'auto_knowledge') = 'boolean' THEN (x.s ->> 'auto_knowledge')::boolean ELSE false END
FROM public.workspaces w
CROSS JOIN LATERAL (SELECT w.ai_background_settings -> 'call_analysis' AS s) x
CROSS JOIN LATERAL (VALUES ('cierre', 'ventas.cierre'), ('seguimiento', 'ventas.seguimiento'), ('triaje', 'ventas.triaje')) AS m(legacy, key)
JOIN public.booking_categories c
  ON c.workspace_id = w.id AND c.system_key = m.key AND c.archived_at IS NULL
WHERE jsonb_typeof(x.s) = 'object'
  AND (
    CASE WHEN jsonb_typeof(x.s -> 'analyze_types') = 'array' THEN x.s -> 'analyze_types' ELSE '["cierre", "seguimiento"]'::jsonb END ? m.legacy
    OR (m.legacy = 'cierre' AND x.s -> 'analyze_types' ? 'venta')
  )
ON CONFLICT DO NOTHING;

-- Las instrucciones que el negocio tenia activas pasan a ser las de esos perfiles.
INSERT INTO public.ai_task_prompt_versions (workspace_id, task, version, instructions, note, variant, created_by)
SELECT p.workspace_id, 'call_analysis', 1, v.instructions, 'Copiadas de las instrucciones generales', p.id, v.created_by
  FROM public.call_analysis_profiles p
  JOIN public.workspaces w ON w.id = p.workspace_id
  JOIN public.ai_task_prompt_versions v
    ON v.workspace_id = p.workspace_id AND v.task = 'call_analysis' AND v.variant IS NULL
   AND v.version::text = w.ai_task_prompt_active ->> 'call_analysis'
 WHERE NOT EXISTS (SELECT 1 FROM public.ai_task_prompt_versions o WHERE o.variant = p.id);

UPDATE public.call_analysis_profiles p
   SET active_prompt_version = 1
 WHERE p.active_prompt_version IS NULL
   AND EXISTS (SELECT 1 FROM public.ai_task_prompt_versions o WHERE o.variant = p.id AND o.version = 1);
