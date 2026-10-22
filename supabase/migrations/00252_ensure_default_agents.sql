-- ============================================================
-- 00252 — Los agentes nacen configurados al conectar la primera IA
-- ============================================================
-- Hasta ahora, conectar una IA no configuraba nada: el agente de chat no
-- existia hasta que alguien apretaba "Crear" (y si lo creaba antes de conectar
-- la IA quedaba sin modelo para siempre), y el copywriter (00094/00238) nacia
-- sin modelo y con las instrucciones vacias.
--
-- `ensure_default_agents` deja todo listo en una sola transaccion. La llama el
-- servidor (lib/agent/defaults.ts) al guardar una IA en Integraciones y al
-- abrir Agentes IA con una IA conectada (asi tambien se completan los negocios
-- que ya la tenian conectada antes de esta migracion). Es idempotente y nunca
-- pisa algo elegido por una persona:
--
--   1. Si el workspace NUNCA tuvo un agente de chat (tambien mirando los
--      borrados: uno que alguien borro no se resucita), lo crea APAGADO, sin
--      canales, con el prompt inicial como version 1 y el modelo recibido.
--   2. El agente de chat y el copywriter sin proveedor reciben el proveedor y
--      el modelo recibidos. Uno con proveedor (aunque este desconectado) no se
--      toca.
--   3. El copywriter con las instrucciones vacias y sin ninguna version recibe
--      las instrucciones por defecto como version 1. NO se prende: se prende a
--      mano desde Agentes IA.
--
-- Los textos (prompt del chat e instrucciones del copywriter) los pasa el
-- servidor: viven en el codigo (DEFAULT_AGENT_SYSTEM_PROMPT y
-- DEFAULT_COPYWRITER_INSTRUCTIONS) y se editan desde la pantalla.
--
-- Dos llamadas a la vez no crean dos agentes: candado de transaccion por
-- workspace. Solo la ejecuta `service_role`.
--
-- Aditiva: solo crea una funcion. Para volver atras:
--   DROP FUNCTION IF EXISTS public.ensure_default_agents(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION public.ensure_default_agents(
  p_workspace_id uuid,
  p_provider text,
  p_model text,
  p_chat_prompt text,
  p_copywriter_instructions text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_provider text := nullif(btrim(coalesce(p_provider, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_chat_prompt text := btrim(coalesce(p_chat_prompt, ''));
  v_copy_text text := btrim(coalesce(p_copywriter_instructions, ''));
  v_chat_id uuid;
  v_copy_id uuid;
  v_models_set integer := 0;
BEGIN
  IF p_workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id) THEN
    RAISE EXCEPTION 'El workspace no existe.' USING ERRCODE = '22023';
  END IF;
  IF (v_provider IS NULL) <> (v_model IS NULL) THEN
    RAISE EXCEPTION 'El proveedor y el modelo van juntos.' USING ERRCODE = '22023';
  END IF;
  IF length(v_chat_prompt) < 20 OR length(v_copy_text) < 20 THEN
    RAISE EXCEPTION 'Faltan los textos iniciales de los agentes.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_default_agents:' || p_workspace_id::text, 0));

  -- 1. El agente de chat, solo si el negocio nunca tuvo uno.
  IF NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.workspace_id = p_workspace_id AND a.type = 'chat') THEN
    INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt, active_prompt_version, provider, model)
    VALUES (p_workspace_id, 'Asistente de conversacion', 'chat', false, v_chat_prompt, 1, v_provider, v_model)
    RETURNING id INTO v_chat_id;

    INSERT INTO public.agent_prompt_versions (workspace_id, agent_id, version, system_prompt, note)
    VALUES (p_workspace_id, v_chat_id, 1, v_chat_prompt, 'Prompt inicial');
  END IF;

  -- 2. El modelo, solo donde no hay ninguno elegido.
  IF v_provider IS NOT NULL THEN
    UPDATE public.agents a
       SET provider = v_provider, model = v_model
     WHERE a.workspace_id = p_workspace_id
       AND a.deleted_at IS NULL
       AND a.type IN ('chat', 'copywriter')
       AND a.provider IS NULL;
    GET DIAGNOSTICS v_models_set = ROW_COUNT;
  END IF;

  -- 3. Las instrucciones del copywriter, solo si nunca se escribieron.
  SELECT a.id INTO v_copy_id
    FROM public.agents a
   WHERE a.workspace_id = p_workspace_id
     AND a.type = 'copywriter'
     AND a.deleted_at IS NULL
     AND btrim(coalesce(a.system_prompt, '')) = ''
     AND NOT EXISTS (SELECT 1 FROM public.agent_prompt_versions v WHERE v.agent_id = a.id)
   FOR UPDATE;

  IF v_copy_id IS NOT NULL THEN
    INSERT INTO public.agent_prompt_versions (workspace_id, agent_id, version, system_prompt, note)
    VALUES (p_workspace_id, v_copy_id, 1, v_copy_text, 'Instrucciones iniciales');

    UPDATE public.agents SET system_prompt = v_copy_text, active_prompt_version = 1 WHERE id = v_copy_id;
  END IF;

  RETURN jsonb_build_object(
    'chat_agent_created', v_chat_id IS NOT NULL,
    'chat_agent_id', v_chat_id,
    'models_set', v_models_set,
    'copywriter_instructions_set', v_copy_id IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_default_agents(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_agents(uuid, text, text, text, text) TO service_role;
