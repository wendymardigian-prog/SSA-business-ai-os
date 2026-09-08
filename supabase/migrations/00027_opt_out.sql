-- ============================================================
-- MIGRACION 00027 — DETECCION DE "NO CONTACTAR" (F18)
-- ============================================================
-- Cuando un lead escribe "no me contactes", el sistema tiene que marcarlo,
-- frenarle las secuencias y dejar constancia. Las columnas de la marca ya
-- existen desde la 00022 y el marcado a mano ya funciona; lo que falta es que
-- pase solo al recibir el mensaje.
--
-- Por que en SQL y no en TypeScript, que seria lo natural:
--
-- 1. Los mensajes entran por dos runtimes distintos: la Edge Function (Deno),
--    que es el receptor vivo, y /api/webhooks/late (Node), que ademas corre el
--    motor de flows. Deno no puede importar de lib/, asi que en TypeScript
--    esto se escribe y se mantiene dos veces. Es el mismo problema que la
--    00025 resolvio empujando find_or_link_contact a la base.
-- 2. Marcar el contacto, pausar sus inscripciones y escribir el audit son tres
--    escrituras que tienen que pasar juntas o no pasar.
-- 3. Un lead que manda "basta" por WhatsApp y por Instagram al mismo tiempo no
--    puede dejar el trabajo a medias.
--
-- Sobre como se busca la frase: por palabra completa, nunca por substring. Un
-- LIKE '%baja%' marca a quien escribe "trabaja con ustedes" o "me hacen una
-- rebaja?", que es exactamente el lead que no hay que perder. La comparacion
-- ignora mayusculas, acentos y puntuacion, porque nadie escribe con tildes
-- cuando esta enojado.
--
-- Las frases son configurables por workspace, como global_keywords: es una
-- lista corta que se edita entera desde Settings y no justifica una tabla.
-- La lista por defecto es deliberadamente conservadora. Quedan afuera "baja"
-- sola (demasiado corta) y "no me interesa" (es un no blando, no un pedido de
-- que dejen de escribirle); el workspace las agrega si quiere.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Las frases del workspace
-- ------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS opt_out_phrases jsonb NOT NULL DEFAULT
    '["no me contactes","no me contacten","no me escribas mas","no me escriban mas","no quiero recibir mensajes","dejen de escribirme","dejame de escribir","dar de baja","darme de baja","stop","unsubscribe","basta"]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_opt_out_phrases_is_array'
  ) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_opt_out_phrases_is_array
      CHECK (jsonb_typeof(opt_out_phrases) = 'array');
  END IF;
END;
$$;

COMMENT ON COLUMN public.workspaces.opt_out_phrases IS
  'Frases que marcan un contacto como "no contactar" cuando aparecen en un mensaje entrante (F18). Se editan desde Settings. Se comparan por palabra completa, sin acentos ni mayusculas.';

-- ------------------------------------------------------------
-- 2. Normalizacion y comparacion de frases
-- ------------------------------------------------------------
-- Aparte para poder probarla sola y para que la pantalla de configuracion
-- pueda mostrar en vivo que atrapa cada frase antes de guardarla.

CREATE OR REPLACE FUNCTION public.normalize_message_text(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Minusculas, sin acentos y con cualquier cosa que no sea letra o numero
  -- convertida en un espacio. "NO ME ESCRIBAS MAS!!!" y "no me escribas mas"
  -- terminan siendo el mismo texto.
  SELECT btrim(regexp_replace(
    translate(lower(btrim(coalesce(p_raw, ''))),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

/*
 * true si el texto contiene la frase como secuencia de palabras completas.
 * Los dos lados se normalizan igual, y despues se busca la frase rodeada de
 * limites de palabra: asi "baja" no matchea adentro de "trabaja".
 */
CREATE OR REPLACE FUNCTION public.text_matches_phrase(p_text text, p_phrase text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text   text := public.normalize_message_text(p_text);
  v_phrase text := public.normalize_message_text(p_phrase);
BEGIN
  IF v_text = '' OR v_phrase = '' THEN
    RETURN false;
  END IF;

  RETURN (' ' || v_text || ' ') LIKE ('% ' || v_phrase || ' %');
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_message_text(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.text_matches_phrase(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_message_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.text_matches_phrase(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.text_matches_phrase(text, text) IS
  'true si el mensaje contiene la frase como palabras completas, ignorando mayusculas, acentos y puntuacion. Nunca por substring: "baja" no matchea en "trabaja".';

-- ------------------------------------------------------------
-- 3. apply_opt_out_check — la que corre el receptor
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { "matched": bool,
--     "phrase": text | null,       -- la frase que disparo
--     "already": bool,             -- ya estaba marcado de antes
--     "sequences_paused": int }
--
-- SECURITY DEFINER porque la llaman los webhooks con la service key y porque
-- tiene que poder marcar un contacto que el operador de turno no tiene
-- asignado. No devuelve ningun dato del contacto mas alla de si matcheo, asi
-- que no filtra nada fuera del scope de leads.
--
-- Solo service_role: marcar un contacto como "no contactar" a nombre del
-- sistema es una accion de sistema. Un usuario logueado tiene setDoNotContact,
-- que deja su nombre en el audit log.

CREATE OR REPLACE FUNCTION public.apply_opt_out_check(
  p_contact_id      uuid,
  p_conversation_id uuid DEFAULT NULL,
  p_text            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_already      boolean;
  v_phrases      jsonb;
  v_phrase       text;
  v_match        text := NULL;
  v_paused       integer := 0;
BEGIN
  IF p_contact_id IS NULL OR btrim(coalesce(p_text, '')) = '' THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  SELECT c.workspace_id, c.do_not_contact
    INTO v_workspace_id, v_already
  FROM public.contacts c
  WHERE c.id = p_contact_id;

  IF v_workspace_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- Ya marcado: no se vuelve a escribir nada. Sin esta guarda, cada mensaje
  -- posterior del lead sumaria otra entrada identica al audit log y pisaria la
  -- razon original, que es la que explica por que quedo marcado.
  IF v_already THEN
    RETURN jsonb_build_object('matched', false, 'already', true, 'sequences_paused', 0);
  END IF;

  SELECT w.opt_out_phrases INTO v_phrases
  FROM public.workspaces w WHERE w.id = v_workspace_id;

  FOR v_phrase IN SELECT jsonb_array_elements_text(coalesce(v_phrases, '[]'::jsonb))
  LOOP
    IF public.text_matches_phrase(p_text, v_phrase) THEN
      v_match := v_phrase;
      EXIT;
    END IF;
  END LOOP;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- is_subscribed tambien baja: es la marca que ya miraban los broadcasts y
  -- las palabras clave globales de ZernFlow, y seria raro que un contacto
  -- quede "no contactar" pero suscripto.
  UPDATE public.contacts
  SET do_not_contact = true,
      do_not_contact_reason = 'auto: ' || v_match,
      do_not_contact_at = now(),
      is_subscribed = false
  WHERE id = p_contact_id;

  UPDATE public.sequence_enrollments
  SET status = 'paused'
  WHERE contact_id = p_contact_id AND status = 'active';
  GET DIAGNOSTICS v_paused = ROW_COUNT;

  -- performed_by en null: lo hizo el sistema, no una persona.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace_id, 'contact', p_contact_id, 'do_not_contact',
    jsonb_build_object('do_not_contact', jsonb_build_object('old', false, 'new', true)),
    jsonb_build_object(
      'source', 'auto',
      'phrase', v_match,
      'conversation_id', p_conversation_id,
      'sequences_paused', v_paused
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'matched', true, 'phrase', v_match, 'already', false, 'sequences_paused', v_paused
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.apply_opt_out_check(uuid, uuid, text) IS
  'Marca el contacto como "no contactar" si el mensaje trae una frase de opt-out del workspace: pausa sus secuencias activas y deja la entrada en audit_log, todo en una transaccion. La llaman los dos receptores de webhooks. Idempotente: sobre un contacto ya marcado no escribe nada.';

-- ------------------------------------------------------------
-- 4. El estado "pausada" de las inscripciones
-- ------------------------------------------------------------
-- La columna no tiene CHECK (viene asi de la 00005) y el procesador solo toma
-- las 'active', asi que sumar el valor no necesita DDL. Se documenta y se
-- indexan las dos consultas que ahora importan: la del cron, que hasta hoy
-- escaneaba la tabla entera cada minuto, y la pausa por contacto.

COMMENT ON COLUMN public.sequence_enrollments.status IS
  'active = corriendo | paused = frenada porque el contacto pidio no ser contactado (F18); no se reanuda sola, ni siquiera al sacar la marca | completed = termino | cancelled = la secuencia dejo de estar activa.';

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_due
  ON public.sequence_enrollments(next_step_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_contact
  ON public.sequence_enrollments(contact_id, status);
