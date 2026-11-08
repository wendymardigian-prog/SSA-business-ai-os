-- ============================================================
-- 00356_messages_deleted_for_everyone
--
-- Un mensaje de WhatsApp borrado "para todos" (desde el celular de cualquiera
-- de las dos partes, o por la API de Evolution) seguia apareciendo en la
-- bandeja como si nada: `messages` no tenia un estado de borrado.
--
-- 1. Tres columnas: cuando se borro, quien lo borro (`contact`: el contacto;
--    `business`: el telefono del negocio o la API de Evolution; `app`: el
--    boton «Eliminar para todos» de la bandeja) y, si fue desde la app, que
--    persona. La FILA NO SE BORRA: el texto queda guardado para el equipo
--    («Ver lo que decia»).
-- 2. `mark_message_deleted_for_everyone`: la unica puerta para marcarlo, solo
--    `service_role`. Busca el mensaje por su id de WhatsApp dentro del canal
--    (usa el indice `idx_messages_workspace_platform_message_id`) y no pisa un
--    borrado anterior: el aviso de Evolution puede llegar dos veces (por
--    `MESSAGES_DELETE` y por `MESSAGES_EDITED`), y despues del boton de la
--    app llega el eco.
-- 3. La guardia: con la sesion de una persona no se puede escribir nada de
--    esto (ni al insertar ni al editar). Hoy `messages` no tiene politica de
--    UPDATE, pero si de INSERT.
-- 4. La vista previa de la lista: si el ultimo mensaje se borro, dice
--    «Mensaje eliminado» (`messages_refresh_last_message`, copia de la 00265
--    con el cambio marcado «00356») y se recalcula al marcarlo (trigger nuevo
--    `messages_zz_last_message_deleted`). El texto de la etiqueta es
--    `DELETED_MESSAGE_LABEL` (lib/messages/revoke.ts); un test los compara.
--
-- La definicion anterior de `messages_refresh_last_message` esta completa en
-- supabase/migrations/00265_conversation_last_message_fix.sql (sin cambios
-- desde entonces).
--
-- Aditiva e idempotente. Va ANTES de desplegar el codigo: la burbuja y el
-- receptor leen y escriben estas columnas.
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_source text,
  ADD COLUMN IF NOT EXISTS deleted_for_everyone_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_deleted_for_everyone_source_check') THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_deleted_for_everyone_source_check
      CHECK (
        (deleted_for_everyone_at IS NULL AND deleted_for_everyone_source IS NULL AND deleted_for_everyone_by IS NULL)
        OR (deleted_for_everyone_at IS NOT NULL AND deleted_for_everyone_source IN ('contact', 'business', 'app'))
      );
  END IF;
END $$;

COMMENT ON COLUMN public.messages.deleted_for_everyone_at IS
  'Cuando se borro "para todos" en WhatsApp. La fila y el texto se conservan para el equipo. Se escribe solo con mark_message_deleted_for_everyone (00356).';
COMMENT ON COLUMN public.messages.deleted_for_everyone_source IS
  'Quien lo borro: contact (el contacto), business (el telefono del negocio o la API de Evolution) o app (el boton de la bandeja).';
COMMENT ON COLUMN public.messages.deleted_for_everyone_by IS
  'La persona que lo borro desde la bandeja (solo con source = app).';

-- ------------------------------------------------------------
-- La guardia: una persona no marca ni desmarca un borrado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.messages_guard_deleted_for_everyone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
BEGIN
  -- Sin JWT (migraciones, cron) o con service role, como siempre.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_for_everyone_at IS NOT NULL
       OR NEW.deleted_for_everyone_source IS NOT NULL
       OR NEW.deleted_for_everyone_by IS NOT NULL THEN
      RAISE EXCEPTION 'un mensaje nuevo no puede nacer borrado' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deleted_for_everyone_at IS DISTINCT FROM OLD.deleted_for_everyone_at
     OR NEW.deleted_for_everyone_source IS DISTINCT FROM OLD.deleted_for_everyone_source
     OR NEW.deleted_for_everyone_by IS DISTINCT FROM OLD.deleted_for_everyone_by THEN
    RAISE EXCEPTION 'el borrado de un mensaje solo lo escribe el servidor' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_guard_deleted_for_everyone() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_guard_deleted_for_everyone() TO service_role;

DROP TRIGGER IF EXISTS messages_guard_deleted_for_everyone ON public.messages;
CREATE TRIGGER messages_guard_deleted_for_everyone
  BEFORE INSERT OR UPDATE OF deleted_for_everyone_at, deleted_for_everyone_source, deleted_for_everyone_by ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_deleted_for_everyone();

-- ------------------------------------------------------------
-- La unica puerta para marcar un borrado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_message_deleted_for_everyone(
  p_workspace_id uuid,
  p_channel_id uuid,
  p_platform_message_id text,
  p_source text,
  p_by uuid DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('contact', 'business', 'app') THEN
    RAISE EXCEPTION 'origen de borrado invalido: %', p_source USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_platform_message_id, '') = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.messages m
  SET deleted_for_everyone_at = COALESCE(m.deleted_for_everyone_at, p_at, now()),
      deleted_for_everyone_source = p_source,
      deleted_for_everyone_by = CASE WHEN p_source = 'app' THEN p_by ELSE NULL END
  FROM public.conversations c
  WHERE m.workspace_id = p_workspace_id
    AND m.platform_message_id = p_platform_message_id
    -- No se pisa un borrado anterior. Excepcion: el boton de la app gana sobre el eco de Evolution, que puede
    -- llegar ANTES de que la accion termine de marcar y diria "desde el telefono del negocio".
    AND (
      m.deleted_for_everyone_at IS NULL
      OR (p_source = 'app' AND m.deleted_for_everyone_source = 'business')
    )
    AND c.id = m.conversation_id
    AND c.channel_id = p_channel_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_message_deleted_for_everyone(uuid, uuid, text, text, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_message_deleted_for_everyone(uuid, uuid, text, text, uuid, timestamptz) TO service_role;

-- ------------------------------------------------------------
-- La vista previa de la lista
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.message_list_preview(
  p_text text,
  p_transcript text,
  p_attachments jsonb,
  p_deleted_at timestamptz
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_deleted_at IS NOT NULL THEN 'Mensaje eliminado'
    ELSE private.message_preview_text(p_text, p_transcript, p_attachments)
  END;
$$;

REVOKE ALL ON FUNCTION private.message_list_preview(text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.message_list_preview(text, text, jsonb, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.messages_refresh_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_last record;
  v_preview text;
BEGIN
  BEGIN
    -- El ultimo mensaje que existe de verdad (ni fallido ni en vuelo). Incluye
    -- al que se acaba de guardar.
    SELECT m.id, m.direction::text AS direction, m.created_at, m.origin::text AS origin, m.sent_by_user_id,
           m.text, m.transcript, m.attachments,
           m.deleted_for_everyone_at  -- 00356
    INTO v_last
    FROM public.messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.status IS DISTINCT FROM 'failed'
      AND m.status IS DISTINCT FROM 'pending'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1;

    IF v_last.id IS NULL THEN
      RETURN NEW;
    END IF;

    -- 00356: un mensaje borrado "para todos" dice «Mensaje eliminado».
    v_preview := private.message_list_preview(v_last.text, v_last.transcript, v_last.attachments, v_last.deleted_for_everyone_at);

    -- Fecha, direccion y preview salen SIEMPRE del ultimo mensaje, no del que
    -- se acaba de guardar. La fecha nunca va para atras.
    UPDATE public.conversations c
    SET last_message_at = GREATEST(c.last_message_at, v_last.created_at),
        last_message_direction = v_last.direction,
        last_message_preview = v_preview
    WHERE c.id = NEW.conversation_id
      AND (
        c.last_message_at IS NULL
        OR c.last_message_at < v_last.created_at
        OR c.last_message_direction IS DISTINCT FROM v_last.direction
        OR c.last_message_preview IS DISTINCT FROM v_preview
      );

    -- El no leido: si lo ultimo que se dijo es nuestro, no hay nada sin leer.
    IF v_last.direction = 'outbound'
       AND (v_last.sent_by_user_id IS NOT NULL OR v_last.origin IN ('user', 'external')) THEN
      UPDATE public.conversations c
      SET unread_count = 0
      WHERE c.id = NEW.conversation_id
        AND c.unread_count > 0;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'messages_refresh_last_message: no pude actualizar la conversacion % (%)', NEW.conversation_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.messages_refresh_last_message() FROM PUBLIC, anon, authenticated;

-- Al marcar un borrado se recalcula la vista previa (si era el ultimo, pasa a
-- decir «Mensaje eliminado»). Nunca tumba la marca: la funcion atrapa todo.
DROP TRIGGER IF EXISTS messages_zz_last_message_deleted ON public.messages;
CREATE TRIGGER messages_zz_last_message_deleted
  AFTER UPDATE OF deleted_for_everyone_at ON public.messages
  FOR EACH ROW
  WHEN (OLD.deleted_for_everyone_at IS NULL AND NEW.deleted_for_everyone_at IS NOT NULL)
  EXECUTE FUNCTION public.messages_refresh_last_message();
