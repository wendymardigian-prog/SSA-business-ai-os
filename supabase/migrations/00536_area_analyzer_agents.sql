-- ============================================================
-- 00536 — Los analizadores de reuniones por área (Ventas y Servicio)
-- ============================================================
-- Dos agentes declarados en el código: «Analizador de reuniones de Ventas» (type `sales_analyzer`) y «Analizador de
-- reuniones de Servicio» (type `service_analyzer`). Cada uno aporta su modelo al análisis de las grabaciones de SU área
-- (lib/calls/area-analyzers.ts) y su pantalla muestra los analizadores por tipo de esa área. Nacen APAGADOS: apagado,
-- el análisis usa el modelo de la tarea «Análisis de llamadas», igual que antes.
--
--   1. `uq_agents_area_analyzer_type`: uno por negocio y por tipo entre los vivos. Dos aperturas de la pantalla a la
--      vez no crean dos agentes.
--   2. `ensure_area_analyzer_agents(p_workspace_id, p_agents)`: crea los que falten, en una sola transacción y con
--      candado por negocio. Idempotente y nunca pisa lo elegido por una persona: no toca un agente que ya existe y
--      tampoco resucita uno que alguien borró (mira también los borrados). Solo la ejecuta `service_role`.
--
-- Cada elemento de `p_agents`: { type, name, provider?, model? }. El proveedor y el modelo van juntos o ninguno.
-- No hace falta ninguna columna nueva: el agente se reconoce por su `type`.
--
-- Aditiva e idempotente. Para volver atrás:
--   DROP FUNCTION IF EXISTS public.ensure_area_analyzer_agents(uuid, jsonb);
--   DROP INDEX IF EXISTS public.uq_agents_area_analyzer_type;
--   (los agentes creados se pueden borrar desde Agentes IA o con un UPDATE de deleted_at)

CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_area_analyzer_type
  ON public.agents (workspace_id, type)
  WHERE type IN ('sales_analyzer', 'service_analyzer') AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_area_analyzer_agents(p_workspace_id uuid, p_agents jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_type text;
  v_name text;
  v_provider text;
  v_model text;
  v_created text[] := '{}';
BEGIN
  IF p_workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id) THEN
    RAISE EXCEPTION 'El workspace no existe.' USING ERRCODE = '22023';
  END IF;
  IF p_agents IS NULL OR jsonb_typeof(p_agents) <> 'array' THEN
    RAISE EXCEPTION 'Faltan los agentes.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_area_analyzer_agents:' || p_workspace_id::text, 0));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_agents) LOOP
    v_type := v_item ->> 'type';
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_provider := nullif(btrim(coalesce(v_item ->> 'provider', '')), '');
    v_model := nullif(btrim(coalesce(v_item ->> 'model', '')), '');

    IF v_type NOT IN ('sales_analyzer', 'service_analyzer') OR v_name IS NULL THEN
      RAISE EXCEPTION 'Agente no válido.' USING ERRCODE = '22023';
    END IF;
    IF (v_provider IS NULL) <> (v_model IS NULL) THEN
      RAISE EXCEPTION 'El proveedor y el modelo van juntos.' USING ERRCODE = '22023';
    END IF;

    -- Uno que ya existió (también borrado) no se vuelve a crear.
    IF EXISTS (SELECT 1 FROM public.agents a WHERE a.workspace_id = p_workspace_id AND a.type = v_type) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.agents (workspace_id, name, type, is_enabled, provider, model)
    VALUES (p_workspace_id, v_name, v_type, false, v_provider, v_model);
    v_created := v_created || v_type;
  END LOOP;

  RETURN jsonb_build_object('created', to_jsonb(v_created));
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_area_analyzer_agents(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_area_analyzer_agents(uuid, jsonb) TO service_role;
