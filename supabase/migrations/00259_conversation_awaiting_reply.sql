-- ============================================================================
-- 00259 — "Esperando respuesta" guardado en la conversación
-- ============================================================================
-- Hasta acá "esperando respuesta" se calculaba en el momento mirando el último
-- mensaje de cada conversación (chat_waiting_now, 00078). Eso dejaba afuera tres
-- cosas que se pidieron el 23/10/2026:
--
--   1. Separar lo que todavía se puede responder desde el sistema (Instagram
--      deja 24 h desde el último mensaje del lead) de lo que ya no.
--   2. No contar lo que no necesita respuesta: un "gracias", un "ok", un emoji.
--      Salvo que nuestra ultima respuesta haya sido una pregunta o una promesa
--      ("dame un momento"): ahi el lead sigue esperando.
--   3. Poder filtrar la bandeja por eso, con el mismo número que el dashboard.
--
-- Columnas nuevas en conversations (las mantiene SOLO el trigger de messages y
-- private.refresh_conversation_awaiting; la app las lee):
--
--   awaiting_reply_since      primer mensaje del lead sin responder (NULL = no espera)
--   awaiting_last_inbound_at  último mensaje del lead sin responder (de acá corre la ventana)
--   reply_window_until        hasta cuándo se puede responder desde el sistema
--                             (NULL = el canal no tiene ventana, o no espera)
--   no_reply_needed_at/_reason/_by
--                             la tanda sin responder no pide respuesta:
--                             'rule' (la regla de abajo), 'agent' (lo decidió el
--                             agente) o 'manual' (una persona). Se borra solo
--                             cuando el lead vuelve a escribir o le respondemos.
--
-- "Responder" es cualquier saliente que no falló (persona, agente, flow, o desde
-- fuera del sistema): mismo criterio que chat_waiting_now.
--
-- La regla "no necesita respuesta" (public.chat_is_closure_message) es GEMELA de
-- lib/messages/closure.ts, con los casos de lib/messages/closure.cases.json
-- (scripts/verify-chat-awaiting.mjs los corre contra la base).
--
-- El trigger NUNCA puede tumbar el insert de un mensaje: va envuelto en
-- EXCEPTION WHEN OTHERS (un webhook que pierde un mensaje es peor que un contador
-- desactualizado).
--
-- Idempotente y aditiva. No toca chat_waiting_now (queda para volver atrás).
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Columnas
-- ------------------------------------------------------------
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS awaiting_reply_since timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS awaiting_last_inbound_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS reply_window_until timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS no_reply_needed_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS no_reply_needed_reason text;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS no_reply_needed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_no_reply_reason_values') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_no_reply_reason_values
      CHECK (no_reply_needed_reason IS NULL OR no_reply_needed_reason IN ('rule', 'agent', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_no_reply_complete') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_no_reply_complete
      CHECK ((no_reply_needed_at IS NULL) = (no_reply_needed_reason IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.conversations.awaiting_reply_since IS
  'Primer mensaje del lead sin responder. NULL = el ultimo mensaje que importa es nuestro. Lo mantiene el trigger de messages (00259).';
COMMENT ON COLUMN public.conversations.awaiting_last_inbound_at IS
  'Ultimo mensaje del lead sin responder: de aca corre la ventana de mensajeria. Lo mantiene el trigger de messages (00259).';
COMMENT ON COLUMN public.conversations.reply_window_until IS
  'Hasta cuando se puede responder desde el sistema (awaiting_last_inbound_at + ventana del canal). NULL = sin ventana o no espera.';
COMMENT ON COLUMN public.conversations.no_reply_needed_at IS
  'La tanda sin responder no pide respuesta (un gracias, un emoji). Se borra sola cuando el lead vuelve a escribir o le respondemos.';
COMMENT ON COLUMN public.conversations.no_reply_needed_reason IS
  'Quien lo decidio: rule (regla de cierre, 00259), agent (el agente) o manual (una persona).';

-- Lo que filtra la bandeja y cuenta el dashboard: solo las que esperan.
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting
  ON public.conversations (workspace_id, awaiting_last_inbound_at)
  WHERE awaiting_last_inbound_at IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------
-- 2. La regla: ¿este mensaje del lead cierra la charla?
-- ------------------------------------------------------------
-- Gemela de lib/messages/closure.ts. La lista de palabras va en el MISMO orden
-- que CLOSURE_WORDS; la tabla de tildes es la misma que normalizeClosureText.
CREATE OR REPLACE FUNCTION public.chat_is_closure_message(
  p_text text,
  p_attachments jsonb,
  p_last_reply text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text text := btrim(COALESCE(p_text, ''));
  v_norm text;
  v_symbols text;
  v_words text[];
  v_kinds text[];
  v_vocab text[] := ARRAY[
    'gracias','graciass','gracia','grax','thanks','thank','thx','ty','you',
    'mil','muchas','muchisimas','muchisimo','mucho','infinitas',
    'de','nada','igualmente','vos','tambien','ti','a','para','el','la','lo','y','me','te',
    'chau','chao','adios','bye','saludos','saludo','abrazo','abrazos','abrazote',
    'beso','besos','besito','besitos','hasta','luego','pronto','manana','nos','vemos','hablamos',
    'buen','buena','buenas','dia','dias','noches','tardes','finde','semana','que','tengas',
    'ok','okey','oki','okis','oka','okay','dale','perfecto','perfecta','genial','listo','lista',
    'joya','buenisimo','buenisima','barbaro','barbara','copado','super','bien','bueno','excelente',
    'entendido','claro','re','muy','todo','ah','oh','wow','amo','love','hermoso','hermosa',
    'lindo','linda','encanta','encanto','gusto','un','una','sos','crack','idola','idolo',
    'increible','fantastico','no'
  ];
  -- Frases de una respuesta nuestra que dejan algo pendiente (PENDING_PROMISE_PHRASES).
  v_promises text[] := ARRAY[
    'dame un momento','dame un segundo','un momentito','un segundito','en breve','enseguida te',
    'ya te lo paso','ya te la paso','ya te paso','ya te lo mando','ya te la mando',
    'ahora te lo','ahora te la','te aviso'
  ];
  v_reply_norm text;
BEGIN
  -- Si nuestra ultima respuesta fue una pregunta, o prometio algo ("dame un
  -- momento", "ya te lo paso"), nada cierra: el lead sigue esperando.
  IF p_last_reply IS NOT NULL THEN
    IF position('?' IN p_last_reply) > 0 OR position('¿' IN p_last_reply) > 0 THEN
      RETURN false;
    END IF;
    v_reply_norm := regexp_replace(
      translate(lower(p_last_reply), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
      '([a-z])\1{2,}', '\1', 'g'
    );
    IF EXISTS (SELECT 1 FROM unnest(v_promises) AS p WHERE position(p IN v_reply_norm) > 0) THEN
      RETURN false;
    END IF;
  END IF;

  IF v_text = '' THEN
    -- Sin texto: cierra solo si todos los adjuntos (formato v2) son stickers o GIFs.
    IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'object' OR p_attachments->>'v' <> '2'
       OR jsonb_typeof(p_attachments->'items') <> 'array' THEN
      RETURN false;
    END IF;
    SELECT array_agg(item->>'kind') INTO v_kinds FROM jsonb_array_elements(p_attachments->'items') AS item;
    RETURN v_kinds IS NOT NULL AND array_length(v_kinds, 1) > 0
       AND v_kinds <@ ARRAY['sticker', 'gif']::text[];
  END IF;

  IF position('?' IN v_text) > 0 OR position('¿' IN v_text) > 0 THEN
    RETURN false;
  END IF;

  v_norm := regexp_replace(
    translate(lower(v_text), 'áéíóúüñàèìòù', 'aeiouunaeiou'),
    '([a-z])\1{2,}', '\1', 'g'
  );

  -- Solo emojis o simbolos (sin letras ni numeros).
  v_symbols := regexp_replace(v_norm, '[[:space:].,;:!¡''"()\-_*~…]', '', 'g');
  IF v_symbols <> '' AND v_symbols !~ '[a-z0-9]' THEN
    RETURN v_symbols ~ '^[ -⯿️‍\U0001F000-\U0001FAFF]+$';
  END IF;

  IF v_norm ~ '[0-9]' THEN
    RETURN false;
  END IF;

  SELECT array_agg(w) INTO v_words
  FROM regexp_split_to_table(v_norm, '[^a-z]+') AS w
  WHERE w <> '';

  IF v_words IS NULL OR array_length(v_words, 1) > 10 THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM unnest(v_words) AS w
    WHERE NOT (w = ANY (v_vocab)) AND w !~ '^(ja|je|ji|ha|he)+j?$'
  );
END;
$$;

COMMENT ON FUNCTION public.chat_is_closure_message(text, jsonb, text) IS
  'Si un mensaje del lead solo cierra la charla (gracias, ok, un emoji, un sticker) y no pide respuesta. Gemela de lib/messages/closure.ts (casos en closure.cases.json).';

REVOKE ALL ON FUNCTION public.chat_is_closure_message(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_is_closure_message(text, jsonb, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Recalcular el estado de una conversación
-- ------------------------------------------------------------
-- Lee los mensajes y escribe las columnas. Toma el lock de la fila de la
-- conversación ANTES de leer: dos mensajes que llegan a la vez se recalculan uno
-- detrás del otro, y el segundo ya ve al primero.
--
-- Si el último mensaje del lead sin responder no cambió, la marca de "no
-- necesita respuesta" se respeta (la pudo poner una persona o el agente). Si
-- cambió, se vuelve a decidir con la regla.
CREATE OR REPLACE FUNCTION private.refresh_conversation_awaiting(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv record;
  v_reply_at timestamptz;
  v_reply_text text;
  v_since timestamptz;
  v_last timestamptz;
  v_all_closure boolean;
  v_window integer;
  v_until timestamptz;
BEGIN
  SELECT c.id, c.awaiting_last_inbound_at, ch.platform, ch.messaging_window_hours
  INTO v_conv
  FROM public.conversations c
  LEFT JOIN public.channels ch ON ch.id = c.channel_id
  WHERE c.id = p_conversation_id
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT m.created_at, m.text INTO v_reply_at, v_reply_text
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.direction = 'outbound'
    AND m.status IS DISTINCT FROM 'failed'
  ORDER BY m.created_at DESC
  LIMIT 1;

  SELECT MIN(m.created_at), MAX(m.created_at),
         bool_and(public.chat_is_closure_message(m.text, m.attachments, v_reply_text))
  INTO v_since, v_last, v_all_closure
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.direction = 'inbound'
    AND (v_reply_at IS NULL OR m.created_at > v_reply_at);

  v_window := public.messaging_window_hours(v_conv.platform, v_conv.messaging_window_hours);
  v_until := CASE WHEN v_last IS NOT NULL AND v_window > 0 THEN v_last + make_interval(hours => v_window) END;

  IF v_last IS NOT DISTINCT FROM v_conv.awaiting_last_inbound_at THEN
    UPDATE public.conversations
    SET awaiting_reply_since = v_since,
        reply_window_until = v_until
    WHERE id = p_conversation_id
      AND (awaiting_reply_since IS DISTINCT FROM v_since OR reply_window_until IS DISTINCT FROM v_until);
    RETURN;
  END IF;

  UPDATE public.conversations
  SET awaiting_reply_since = v_since,
      awaiting_last_inbound_at = v_last,
      reply_window_until = v_until,
      no_reply_needed_at = CASE WHEN v_last IS NOT NULL AND COALESCE(v_all_closure, false) THEN now() END,
      no_reply_needed_reason = CASE WHEN v_last IS NOT NULL AND COALESCE(v_all_closure, false) THEN 'rule' END,
      no_reply_needed_by = NULL
  WHERE id = p_conversation_id;
END;
$$;

COMMENT ON FUNCTION private.refresh_conversation_awaiting(uuid) IS
  'Recalcula awaiting_*, reply_window_until y la marca de la regla de cierre de una conversacion a partir de sus mensajes (00259).';

REVOKE ALL ON FUNCTION private.refresh_conversation_awaiting(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_conversation_awaiting(uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. El trigger de messages
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_refresh_awaiting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM private.refresh_conversation_awaiting(NEW.conversation_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_awaiting: no pude recalcular la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_refresh_awaiting() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_zz_refresh_awaiting ON public.messages;
CREATE TRIGGER messages_zz_refresh_awaiting
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_refresh_awaiting();

-- Un envío que pasa a fallido (o vuelve de fallido) cambia si se respondió.
DROP TRIGGER IF EXISTS messages_zz_refresh_awaiting_update ON public.messages;
CREATE TRIGGER messages_zz_refresh_awaiting_update
  AFTER UPDATE OF status, direction, created_at ON public.messages
  FOR EACH ROW
  WHEN (
    OLD.direction IS DISTINCT FROM NEW.direction
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR ((OLD.status = 'failed') IS DISTINCT FROM (NEW.status = 'failed'))
  )
  EXECUTE FUNCTION public.messages_refresh_awaiting();

-- ------------------------------------------------------------
-- 5. Marcar o desmarcar a mano / desde el agente
-- ------------------------------------------------------------
-- Solo service_role: quien llama ya chequeó que la persona puede responder esa
-- conversación (lib/inbox/no-reply-actions.ts) o es el agente. Con
-- p_expected_last_inbound_at, la marca solo se pone si el lead no volvió a
-- escribir en el medio (si no, se marcaría como cerrado algo que ya pide otra
-- cosa). Devuelve true si cambió algo.
CREATE OR REPLACE FUNCTION public.set_conversation_no_reply(
  p_conversation_id uuid,
  p_needed boolean,
  p_reason text,
  p_by uuid DEFAULT NULL,
  p_expected_last_inbound_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_needed THEN
    -- "Necesita respuesta": se saca la marca, sea de quien sea.
    UPDATE public.conversations
    SET no_reply_needed_at = NULL, no_reply_needed_reason = NULL, no_reply_needed_by = NULL
    WHERE id = p_conversation_id AND no_reply_needed_at IS NOT NULL;
  ELSE
    IF p_reason NOT IN ('agent', 'manual') THEN
      RAISE EXCEPTION 'motivo invalido: %', p_reason USING ERRCODE = '22023';
    END IF;
    UPDATE public.conversations
    SET no_reply_needed_at = now(), no_reply_needed_reason = p_reason, no_reply_needed_by = p_by
    WHERE id = p_conversation_id
      AND awaiting_last_inbound_at IS NOT NULL
      AND (p_expected_last_inbound_at IS NULL OR awaiting_last_inbound_at = p_expected_last_inbound_at);
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.set_conversation_no_reply(uuid, boolean, text, uuid, timestamptz) IS
  'Pone o saca la marca "no necesita respuesta" (agente o persona). Solo service_role: el permiso lo chequea quien llama.';

REVOKE ALL ON FUNCTION public.set_conversation_no_reply(uuid, boolean, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_conversation_no_reply(uuid, boolean, text, uuid, timestamptz) TO service_role;

-- ------------------------------------------------------------
-- 6. El contador del dashboard
-- ------------------------------------------------------------
-- Mismo criterio que chat_waiting_now (abierta, sin "no contactar", sin la
-- etiqueta que apaga al agente, último mensaje del lead hace más de 1 hora), en
-- tres partes. La bandeja filtra con el mismo criterio (lib/inbox/awaiting.ts).
CREATE OR REPLACE FUNCTION public.chat_waiting_now_v2(
  p_workspace_id uuid,
  p_channel text DEFAULT NULL
)
RETURNS TABLE (can_reply bigint, window_closed bigint, no_reply_needed bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH w AS (
    SELECT c.reply_window_until, c.no_reply_needed_at
    FROM public.conversations c
    JOIN public.contacts ct ON ct.id = c.contact_id
    WHERE c.workspace_id = p_workspace_id
      AND c.deleted_at IS NULL
      AND c.status = 'open'
      AND c.agent_disabled_by_tag_id IS NULL
      AND COALESCE(ct.do_not_contact, false) = false
      AND c.awaiting_last_inbound_at IS NOT NULL
      AND c.awaiting_last_inbound_at < now() - interval '1 hour'
      AND (p_channel IS NULL OR c.channel_id::text = p_channel OR c.platform = p_channel)
  )
  SELECT
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NULL AND (reply_window_until IS NULL OR reply_window_until > now())),
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NULL AND reply_window_until <= now()),
    COUNT(*) FILTER (WHERE no_reply_needed_at IS NOT NULL)
  FROM w;
$$;

COMMENT ON FUNCTION public.chat_waiting_now_v2(uuid, text) IS
  'Esperando respuesta ahora, en tres: se puede responder desde el sistema, la ventana ya cerro, y no necesita respuesta. Lee las columnas que mantiene el trigger de messages (00259).';

REVOKE ALL ON FUNCTION public.chat_waiting_now_v2(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_waiting_now_v2(uuid, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Backfill: todas las conversaciones existentes
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.conversations LOOP
    PERFORM private.refresh_conversation_awaiting(r.id);
  END LOOP;
END $$;
