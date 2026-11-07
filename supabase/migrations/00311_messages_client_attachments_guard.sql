-- ============================================================
-- 00311_messages_client_attachments_guard (7/11/2026)
--
-- Auditoria de seguridad (SSRF). La politica `messages_insert` (00054) deja
-- que cualquier miembro inserte mensajes con el cliente del usuario, con la
-- columna `attachments` libre. Un adjunto con `sourceUrl` (o un formato viejo
-- con `url`) hacia que "Reintentar descarga" (/api/v1/messages/<id>/media-retry)
-- bajara esa direccion desde el servidor, incluida una interna, y guardara la
-- respuesta en `chat-media`, donde se podia leer. Un `storagePath` de otro
-- workspace llegaba al transcriptor y a "guardar sticker", que leen con el
-- cliente de servicio.
--
-- La app, con la sesion del usuario, solo escribe adjuntos v2 que ya subio a
-- `chat-media` (el envio manual de /api/v1/messages): sin `sourceUrl` y con
-- la ruta del propio workspace. Este trigger exige exactamente eso cuando
-- escribe un usuario (`authenticated` o `anon`). El servidor (service role),
-- los webhooks y los jobs no cambian.
--
-- El codigo ademas baja la media con la misma proteccion de la "Llamada HTTP"
-- (lib/net/safe-fetch.ts) y el reintento solo acepta mensajes entrantes.
--
-- El nombre ordena DESPUES de `messages_fill_workspace_id` (los BEFORE corren
-- por orden alfabetico): cuando se mira, `workspace_id` ya esta completo.
--
-- Idempotente. Va ANTES o despues del deploy (el codigo no depende de esto).
-- ============================================================

CREATE OR REPLACE FUNCTION public.messages_guard_client_attachments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_item jsonb;
  v_path text;
BEGIN
  -- Solo lo que escribe una persona con su sesion. Sin JWT (migraciones, SQL
  -- del cron) o con service role, como siempre.
  IF coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.attachments IS NOT DISTINCT FROM OLD.attachments THEN
    RETURN NEW;
  END IF;
  IF NEW.attachments IS NULL OR jsonb_typeof(NEW.attachments) = 'null' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.attachments) <> 'object'
     OR (NEW.attachments->>'v') IS DISTINCT FROM '2'
     OR jsonb_typeof(NEW.attachments->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'adjuntos con un formato que no se puede escribir desde la app'
      USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(NEW.attachments->'items') LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'adjunto invalido' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(v_item->'sourceUrl') IS NOT NULL AND jsonb_typeof(v_item->'sourceUrl') <> 'null' THEN
      RAISE EXCEPTION 'un adjunto escrito desde la app no puede traer una direccion de descarga'
        USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(v_item->'storagePath') IS NOT NULL AND jsonb_typeof(v_item->'storagePath') <> 'null' THEN
      v_path := v_item->>'storagePath';
      IF jsonb_typeof(v_item->'storagePath') <> 'string'
         OR NEW.workspace_id IS NULL
         OR NOT starts_with(v_path, NEW.workspace_id::text || '/')
         OR position('..' IN v_path) > 0 THEN
        RAISE EXCEPTION 'el archivo de un adjunto tiene que ser de este negocio'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.messages_guard_client_attachments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messages_guard_client_attachments() TO service_role;

DROP TRIGGER IF EXISTS messages_guard_client_attachments ON public.messages;
CREATE TRIGGER messages_guard_client_attachments
  BEFORE INSERT OR UPDATE OF attachments ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.messages_guard_client_attachments();
