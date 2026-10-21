-- ============================================================
-- 00247_merge_contacts_statuses_interest
-- ============================================================
-- La fusion de contactos (`merge_contacts`, 00207) suma lo nuevo del pipeline:
--
--  1. `contact_status_changes` (00245): el historial de estados del duplicado
--     pasa al principal. Sin esto, la guardia de deriva de
--     `scripts/verify-contact-merge.mjs` falla (la tabla tiene `contact_id`).
--  2. Los estados de setter y de vendedor (00245): gana el del principal; si no
--     tiene, se toma el del duplicado (con su fecha). El ultimo estado se
--     recalcula con la misma regla que `set_contact_status`.
--  3. El producto de interes (00246): gana el del principal; si no tiene, el
--     del duplicado con su variante.
--
-- Todo lo demas es la 00207 letra por letra. Misma firma, mismos permisos
-- (solo service_role).
--
-- Como volver atras: volver a ejecutar la definicion anterior (00207), que
-- queda completa aca abajo:
--
--   CREATE OR REPLACE FUNCTION public.merge_contacts(
--     p_workspace_id uuid,
--     p_main uuid,
--     p_duplicate uuid,
--     p_actor uuid
--   ) RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $fn$
--   DECLARE
--     v_main public.contacts%ROWTYPE;
--     v_dup public.contacts%ROWTYPE;
--     v_moved jsonb := '{}'::jsonb;
--     v_n integer;
--     v_conv record;
--     v_merged_convs uuid[] := '{}';
--     v_convs_merged integer := 0;
--     v_msgs_moved integer := 0;
--     v_msgs_left integer := 0;
--     v_notes text;
--     v_table text;
--   BEGIN
--     IF p_workspace_id IS NULL OR p_main IS NULL OR p_duplicate IS NULL THEN
--       RAISE EXCEPTION 'merge_invalid' USING ERRCODE = '22023';
--     END IF;
--     IF p_main = p_duplicate THEN
--       RAISE EXCEPTION 'merge_same_contact' USING ERRCODE = '22023';
--     END IF;
--
--     -- Las dos filas, bloqueadas en un orden fijo (sin interbloqueos entre dos fusiones).
--     PERFORM 1 FROM public.contacts WHERE id IN (p_main, p_duplicate) ORDER BY id FOR UPDATE;
--     SELECT * INTO v_main FROM public.contacts WHERE id = p_main;
--     IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
--     SELECT * INTO v_dup FROM public.contacts WHERE id = p_duplicate;
--     IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
--     IF v_main.workspace_id <> p_workspace_id OR v_dup.workspace_id <> p_workspace_id THEN
--       RAISE EXCEPTION 'merge_workspace_mismatch' USING ERRCODE = '22023';
--     END IF;
--     IF v_main.deleted_at IS NOT NULL OR v_dup.deleted_at IS NOT NULL THEN
--       RAISE EXCEPTION 'merge_deleted' USING ERRCODE = '22023';
--     END IF;
--
--     -- El duplicado sale de circulacion PRIMERO: asi, si hay indices unicos por telefono o email sobre los contactos vivos,
--     -- rellenar los datos vacios del principal no choca con el duplicado.
--     UPDATE public.contacts
--        SET deleted_at = now(),
--            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_into', p_main)
--      WHERE id = p_duplicate;
--
--     -- Canales vinculados (unico por canal + remitente: los remitentes son distintos, no choca).
--     UPDATE public.contact_channels SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_channels', v_n);
--
--     -- Conversaciones: UNA por canal y contacto. Si el principal ya tiene una en ese canal, los mensajes de la del
--     -- duplicado pasan a la del principal (los que repiten el id del mensaje de la plataforma se quedan donde estan y se
--     -- cuentan), se recalcula su resumen y la del duplicado queda vacia y con borrado logico.
--     FOR v_conv IN
--       SELECT d.id AS dup_conv, m.id AS main_conv
--         FROM public.conversations d
--         JOIN public.conversations m ON m.channel_id = d.channel_id AND m.contact_id = p_main
--        WHERE d.contact_id = p_duplicate
--        ORDER BY d.id
--     LOOP
--       -- Un solo borrador abierto por conversacion: si el principal ya tiene uno, el del duplicado se descarta.
--       IF EXISTS (SELECT 1 FROM public.agent_drafts WHERE conversation_id = v_conv.main_conv AND status IN ('pending', 'sending', 'failed')) THEN
--         UPDATE public.agent_drafts SET status = 'discarded'
--          WHERE conversation_id = v_conv.dup_conv AND status IN ('pending', 'sending', 'failed');
--       END IF;
--       UPDATE public.agent_drafts SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
--
--       UPDATE public.messages msg SET conversation_id = v_conv.main_conv
--        WHERE msg.conversation_id = v_conv.dup_conv
--          AND (msg.platform_message_id IS NULL OR NOT EXISTS (
--                SELECT 1 FROM public.messages o
--                 WHERE o.conversation_id = v_conv.main_conv AND o.platform_message_id = msg.platform_message_id));
--       GET DIAGNOSTICS v_n = ROW_COUNT; v_msgs_moved := v_msgs_moved + v_n;
--       SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv.dup_conv;
--       v_msgs_left := v_msgs_left + v_n;
--
--       UPDATE public.conversations m SET
--         last_message_preview = CASE WHEN d.last_message_at IS NOT NULL AND (m.last_message_at IS NULL OR d.last_message_at > m.last_message_at)
--                                     THEN d.last_message_preview ELSE m.last_message_preview END,
--         last_message_at = GREATEST(m.last_message_at, d.last_message_at),
--         unread_count = COALESCE(m.unread_count, 0) + COALESCE(d.unread_count, 0),
--         status = CASE WHEN m.status = 'open' OR d.status = 'open' THEN 'open' ELSE m.status END,
--         assigned_to = COALESCE(m.assigned_to, d.assigned_to),
--         needs_human_reason = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_reason ELSE m.needs_human_reason END,
--         needs_human_at = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_at ELSE m.needs_human_at END,
--         needs_human = COALESCE(m.needs_human, false) OR COALESCE(d.needs_human, false),
--         deleted_at = CASE WHEN m.deleted_at IS NOT NULL AND d.deleted_at IS NULL THEN NULL ELSE m.deleted_at END
--        FROM public.conversations d
--       WHERE m.id = v_conv.main_conv AND d.id = v_conv.dup_conv;
--
--       UPDATE public.agent_runs SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
--       UPDATE public.tasks SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
--       UPDATE public.conversations SET deleted_at = COALESCE(deleted_at, now()), unread_count = 0 WHERE id = v_conv.dup_conv;
--
--       v_merged_convs := v_merged_convs || v_conv.dup_conv;
--       v_convs_merged := v_convs_merged + 1;
--     END LOOP;
--
--     -- Las demas conversaciones se mueven enteras.
--     UPDATE public.conversations SET contact_id = p_main
--      WHERE contact_id = p_duplicate AND NOT (id = ANY (v_merged_convs));
--     GET DIAGNOSTICS v_n = ROW_COUNT;
--     v_moved := v_moved || jsonb_build_object('conversations', v_n, 'conversations_merged', v_convs_merged, 'messages_moved', v_msgs_moved, 'messages_left', v_msgs_left);
--
--     -- Etiquetas: se mueven las que el principal no tiene (PK contact_id + tag_id).
--     UPDATE public.contact_tags SET contact_id = p_main
--      WHERE contact_id = p_duplicate
--        AND NOT EXISTS (SELECT 1 FROM public.contact_tags o WHERE o.contact_id = p_main AND o.tag_id = public.contact_tags.tag_id);
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_tags', v_n);
--
--     -- Campos personalizados: en uno que ambos tienen, gana el del principal.
--     UPDATE public.contact_custom_fields SET contact_id = p_main
--      WHERE contact_id = p_duplicate
--        AND NOT EXISTS (SELECT 1 FROM public.contact_custom_fields o WHERE o.contact_id = p_main AND o.field_id = public.contact_custom_fields.field_id);
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_custom_fields', v_n);
--
--     -- Secuencias: una inscripcion viva por secuencia. Si el principal ya esta activo o pausado en esa secuencia, la viva del
--     -- duplicado se cancela (con el motivo); el resto se mueve.
--     UPDATE public.sequence_enrollments d SET status = 'cancelled', paused_reason = 'fusion de contactos', next_step_at = NULL, locked_at = NULL
--      WHERE d.contact_id = p_duplicate AND d.status IN ('active', 'paused')
--        AND EXISTS (SELECT 1 FROM public.sequence_enrollments m WHERE m.contact_id = p_main AND m.sequence_id = d.sequence_id AND m.status IN ('active', 'paused'));
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments_cancelled', v_n);
--     UPDATE public.sequence_enrollments SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments', v_n);
--
--     -- Sesiones de flujo: las activas del duplicado se mueven, salvo que el principal ya tenga una activa del mismo flujo (la
--     -- del duplicado se cancela). El historial se mueve siempre.
--     UPDATE public.flow_sessions d SET status = 'cancelled'
--      WHERE d.contact_id = p_duplicate AND d.status = 'active'
--        AND EXISTS (SELECT 1 FROM public.flow_sessions m WHERE m.contact_id = p_main AND m.status = 'active' AND m.flow_id = d.flow_id);
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions_cancelled', v_n);
--     UPDATE public.flow_sessions SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions', v_n);
--
--     -- Eventos de automatizacion: los pendientes del duplicado NO se mueven (podrian disparar otra vez un flujo para el
--     -- principal): se marcan como cancelados. Los ya procesados (historial) se mueven.
--     UPDATE public.automation_events SET processed_at = now(), error = 'fusion de contactos'
--      WHERE contact_id = p_duplicate AND processed_at IS NULL;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events_cancelled', v_n);
--     UPDATE public.automation_events SET contact_id = p_main
--      WHERE contact_id = p_duplicate AND processed_at IS NOT NULL AND error IS DISTINCT FROM 'fusion de contactos';
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events', v_n);
--
--     -- Tareas: si los dos tienen un seguimiento para la misma fecha, el del duplicado pasa como tarea normal (sin la clave).
--     UPDATE public.tasks d SET source_ref = NULL
--      WHERE d.contact_id = p_duplicate AND d.source_ref LIKE 'followup:%' AND d.deleted_at IS NULL
--        AND EXISTS (SELECT 1 FROM public.tasks m WHERE m.workspace_id = d.workspace_id AND m.contact_id = p_main AND m.source_ref = d.source_ref AND m.deleted_at IS NULL);
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks_detached', v_n);
--     UPDATE public.tasks SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks', v_n);
--
--     -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
--     UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
--     IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;
--
--     -- Formularios: "una vez por contacto" guarda `contact:<id>`; la respuesta que se mueve pasa a `contact:<principal>` salvo
--     -- que el principal ya tenga una para ese formulario (el indice unico no deja dos).
--     UPDATE public.form_submissions fs SET once_key = 'contact:' || p_main::text
--      WHERE fs.contact_id = p_duplicate AND fs.once_key = 'contact:' || p_duplicate::text
--        AND NOT EXISTS (SELECT 1 FROM public.form_submissions o WHERE o.form_id = fs.form_id AND o.once_key = 'contact:' || p_main::text AND o.status <> 'spam' AND fs.status <> 'spam');
--     UPDATE public.form_submissions SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('form_submissions', v_n);
--
--     -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las ventas llevan sus pagos; las agendas y
--     -- las llamadas no cambian de estado ni de monto.
--     FOREACH v_table IN ARRAY ARRAY[
--       'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'calls', 'contact_notes',
--       'contract_signatures', 'email_log', 'inbound_webhooks', 'sales', 'social_post_comments', 'trigger_fires'
--     ] LOOP
--       EXECUTE format('UPDATE public.%I SET contact_id = $1 WHERE contact_id = $2', v_table) USING p_main, p_duplicate;
--       GET DIAGNOSTICS v_n = ROW_COUNT;
--       v_moved := v_moved || jsonb_build_object(v_table, v_n);
--     END LOOP;
--
--     -- Los contactos que el duplicado habia referido pasan a ser referidos por el principal.
--     UPDATE public.contacts SET referred_by_contact_id = NULL WHERE id = p_main AND referred_by_contact_id = p_duplicate;
--     UPDATE public.contacts SET referred_by_contact_id = p_main WHERE referred_by_contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('referred_contacts', v_n);
--
--     -- Los datos de identidad que el principal tiene vacios se completan con los del duplicado (nunca al reves), mas la fecha
--     -- del proximo seguimiento.
--     UPDATE public.contacts SET
--       display_name = CASE WHEN NULLIF(btrim(COALESCE(display_name, '')), '') IS NULL THEN COALESCE(v_dup.display_name, display_name) ELSE display_name END,
--       email = CASE WHEN NULLIF(btrim(COALESCE(email, '')), '') IS NULL THEN COALESCE(v_dup.email, email) ELSE email END,
--       secondary_email = CASE WHEN NULLIF(btrim(COALESCE(secondary_email, '')), '') IS NULL THEN COALESCE(v_dup.secondary_email, secondary_email) ELSE secondary_email END,
--       phone = CASE WHEN NULLIF(btrim(COALESCE(phone, '')), '') IS NULL THEN COALESCE(v_dup.phone, phone) ELSE phone END,
--       whatsapp_phone = CASE WHEN NULLIF(btrim(COALESCE(whatsapp_phone, '')), '') IS NULL THEN COALESCE(v_dup.whatsapp_phone, whatsapp_phone) ELSE whatsapp_phone END,
--       country = CASE WHEN NULLIF(btrim(COALESCE(country, '')), '') IS NULL THEN COALESCE(v_dup.country, country) ELSE country END,
--       instagram_username = CASE WHEN NULLIF(btrim(COALESCE(instagram_username, '')), '') IS NULL THEN COALESCE(v_dup.instagram_username, instagram_username) ELSE instagram_username END,
--       tiktok_username = CASE WHEN NULLIF(btrim(COALESCE(tiktok_username, '')), '') IS NULL THEN COALESCE(v_dup.tiktok_username, tiktok_username) ELSE tiktok_username END,
--       twitter_username = CASE WHEN NULLIF(btrim(COALESCE(twitter_username, '')), '') IS NULL THEN COALESCE(v_dup.twitter_username, twitter_username) ELSE twitter_username END,
--       facebook_id = CASE WHEN NULLIF(btrim(COALESCE(facebook_id, '')), '') IS NULL THEN COALESCE(v_dup.facebook_id, facebook_id) ELSE facebook_id END,
--       youtube_channel_id = CASE WHEN NULLIF(btrim(COALESCE(youtube_channel_id, '')), '') IS NULL THEN COALESCE(v_dup.youtube_channel_id, youtube_channel_id) ELSE youtube_channel_id END,
--       linkedin_profile_url = CASE WHEN NULLIF(btrim(COALESCE(linkedin_profile_url, '')), '') IS NULL THEN COALESCE(v_dup.linkedin_profile_url, linkedin_profile_url) ELSE linkedin_profile_url END,
--       setter_id = COALESCE(setter_id, v_dup.setter_id),
--       vendedor_id = COALESCE(vendedor_id, v_dup.vendedor_id),
--       next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date)
--      WHERE id = p_main;
--
--     -- Las notas de los dos se juntan (dos textos de personas distintas sobre el mismo lead: quedarse con uno tira el otro).
--     v_notes := concat_ws(E'\n\n---\n\n', NULLIF(btrim(COALESCE(v_main.notes, '')), ''), NULLIF(btrim(COALESCE(v_dup.notes, '')), ''));
--     IF v_notes <> '' AND v_notes IS DISTINCT FROM btrim(COALESCE(v_main.notes, '')) THEN
--       UPDATE public.contacts SET notes = v_notes WHERE id = p_main;
--     END IF;
--
--     -- La sugerencia de vinculacion ya no corresponde.
--     UPDATE public.contacts SET metadata = jsonb_set(
--         COALESCE(metadata, '{}'::jsonb), '{link_suggestions}',
--         COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(metadata -> 'link_suggestions') s WHERE s ->> 'contact_id' IS DISTINCT FROM p_duplicate::text), '[]'::jsonb))
--      WHERE id = p_main AND jsonb_typeof(metadata -> 'link_suggestions') = 'array';
--
--     -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
--     INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--     VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
--             jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);
--
--     RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
--   END;
--   $fn$;
--
--   REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, uuid, uuid) TO service_role;
--
-- Idempotente: CREATE OR REPLACE.
-- ============================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_workspace_id uuid,
  p_main uuid,
  p_duplicate uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_main public.contacts%ROWTYPE;
  v_dup public.contacts%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_n integer;
  v_conv record;
  v_merged_convs uuid[] := '{}';
  v_convs_merged integer := 0;
  v_msgs_moved integer := 0;
  v_msgs_left integer := 0;
  v_notes text;
  v_table text;
  -- Pipeline (00245): el estado de cada rol despues de fusionar, y el ultimo.
  v_setter text;
  v_setter_at timestamptz;
  v_setter_by_agent boolean;
  v_closer text;
  v_closer_at timestamptz;
  v_last_role text;
  v_last text;
  v_last_at timestamptz;
BEGIN
  IF p_workspace_id IS NULL OR p_main IS NULL OR p_duplicate IS NULL THEN
    RAISE EXCEPTION 'merge_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_main = p_duplicate THEN
    RAISE EXCEPTION 'merge_same_contact' USING ERRCODE = '22023';
  END IF;

  -- Las dos filas, bloqueadas en un orden fijo (sin interbloqueos entre dos fusiones).
  PERFORM 1 FROM public.contacts WHERE id IN (p_main, p_duplicate) ORDER BY id FOR UPDATE;
  SELECT * INTO v_main FROM public.contacts WHERE id = p_main;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dup FROM public.contacts WHERE id = p_duplicate;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_main.workspace_id <> p_workspace_id OR v_dup.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'merge_workspace_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_main.deleted_at IS NOT NULL OR v_dup.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'merge_deleted' USING ERRCODE = '22023';
  END IF;

  -- El duplicado sale de circulacion PRIMERO: asi, si hay indices unicos por telefono o email sobre los contactos vivos,
  -- rellenar los datos vacios del principal no choca con el duplicado.
  UPDATE public.contacts
     SET deleted_at = now(),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('merged_into', p_main)
   WHERE id = p_duplicate;

  -- Canales vinculados (unico por canal + remitente: los remitentes son distintos, no choca).
  UPDATE public.contact_channels SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_channels', v_n);

  -- Conversaciones: UNA por canal y contacto. Si el principal ya tiene una en ese canal, los mensajes de la del
  -- duplicado pasan a la del principal (los que repiten el id del mensaje de la plataforma se quedan donde estan y se
  -- cuentan), se recalcula su resumen y la del duplicado queda vacia y con borrado logico.
  FOR v_conv IN
    SELECT d.id AS dup_conv, m.id AS main_conv
      FROM public.conversations d
      JOIN public.conversations m ON m.channel_id = d.channel_id AND m.contact_id = p_main
     WHERE d.contact_id = p_duplicate
     ORDER BY d.id
  LOOP
    -- Un solo borrador abierto por conversacion: si el principal ya tiene uno, el del duplicado se descarta.
    IF EXISTS (SELECT 1 FROM public.agent_drafts WHERE conversation_id = v_conv.main_conv AND status IN ('pending', 'sending', 'failed')) THEN
      UPDATE public.agent_drafts SET status = 'discarded'
       WHERE conversation_id = v_conv.dup_conv AND status IN ('pending', 'sending', 'failed');
    END IF;
    UPDATE public.agent_drafts SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;

    UPDATE public.messages msg SET conversation_id = v_conv.main_conv
     WHERE msg.conversation_id = v_conv.dup_conv
       AND (msg.platform_message_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.messages o
              WHERE o.conversation_id = v_conv.main_conv AND o.platform_message_id = msg.platform_message_id));
    GET DIAGNOSTICS v_n = ROW_COUNT; v_msgs_moved := v_msgs_moved + v_n;
    SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv.dup_conv;
    v_msgs_left := v_msgs_left + v_n;

    UPDATE public.conversations m SET
      last_message_preview = CASE WHEN d.last_message_at IS NOT NULL AND (m.last_message_at IS NULL OR d.last_message_at > m.last_message_at)
                                  THEN d.last_message_preview ELSE m.last_message_preview END,
      last_message_at = GREATEST(m.last_message_at, d.last_message_at),
      unread_count = COALESCE(m.unread_count, 0) + COALESCE(d.unread_count, 0),
      status = CASE WHEN m.status = 'open' OR d.status = 'open' THEN 'open' ELSE m.status END,
      assigned_to = COALESCE(m.assigned_to, d.assigned_to),
      needs_human_reason = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_reason ELSE m.needs_human_reason END,
      needs_human_at = CASE WHEN NOT COALESCE(m.needs_human, false) AND COALESCE(d.needs_human, false) THEN d.needs_human_at ELSE m.needs_human_at END,
      needs_human = COALESCE(m.needs_human, false) OR COALESCE(d.needs_human, false),
      deleted_at = CASE WHEN m.deleted_at IS NOT NULL AND d.deleted_at IS NULL THEN NULL ELSE m.deleted_at END
     FROM public.conversations d
    WHERE m.id = v_conv.main_conv AND d.id = v_conv.dup_conv;

    UPDATE public.agent_runs SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.tasks SET conversation_id = v_conv.main_conv WHERE conversation_id = v_conv.dup_conv;
    UPDATE public.conversations SET deleted_at = COALESCE(deleted_at, now()), unread_count = 0 WHERE id = v_conv.dup_conv;

    v_merged_convs := v_merged_convs || v_conv.dup_conv;
    v_convs_merged := v_convs_merged + 1;
  END LOOP;

  -- Las demas conversaciones se mueven enteras.
  UPDATE public.conversations SET contact_id = p_main
   WHERE contact_id = p_duplicate AND NOT (id = ANY (v_merged_convs));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_moved := v_moved || jsonb_build_object('conversations', v_n, 'conversations_merged', v_convs_merged, 'messages_moved', v_msgs_moved, 'messages_left', v_msgs_left);

  -- Etiquetas: se mueven las que el principal no tiene (PK contact_id + tag_id).
  UPDATE public.contact_tags SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_tags o WHERE o.contact_id = p_main AND o.tag_id = public.contact_tags.tag_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_tags', v_n);

  -- Campos personalizados: en uno que ambos tienen, gana el del principal.
  UPDATE public.contact_custom_fields SET contact_id = p_main
   WHERE contact_id = p_duplicate
     AND NOT EXISTS (SELECT 1 FROM public.contact_custom_fields o WHERE o.contact_id = p_main AND o.field_id = public.contact_custom_fields.field_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_custom_fields', v_n);

  -- Secuencias: una inscripcion viva por secuencia. Si el principal ya esta activo o pausado en esa secuencia, la viva del
  -- duplicado se cancela (con el motivo); el resto se mueve.
  UPDATE public.sequence_enrollments d SET status = 'cancelled', paused_reason = 'fusion de contactos', next_step_at = NULL, locked_at = NULL
   WHERE d.contact_id = p_duplicate AND d.status IN ('active', 'paused')
     AND EXISTS (SELECT 1 FROM public.sequence_enrollments m WHERE m.contact_id = p_main AND m.sequence_id = d.sequence_id AND m.status IN ('active', 'paused'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments_cancelled', v_n);
  UPDATE public.sequence_enrollments SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('sequence_enrollments', v_n);

  -- Sesiones de flujo: las activas del duplicado se mueven, salvo que el principal ya tenga una activa del mismo flujo (la
  -- del duplicado se cancela). El historial se mueve siempre.
  UPDATE public.flow_sessions d SET status = 'cancelled'
   WHERE d.contact_id = p_duplicate AND d.status = 'active'
     AND EXISTS (SELECT 1 FROM public.flow_sessions m WHERE m.contact_id = p_main AND m.status = 'active' AND m.flow_id = d.flow_id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions_cancelled', v_n);
  UPDATE public.flow_sessions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('flow_sessions', v_n);

  -- Eventos de automatizacion: los pendientes del duplicado NO se mueven (podrian disparar otra vez un flujo para el
  -- principal): se marcan como cancelados. Los ya procesados (historial) se mueven.
  UPDATE public.automation_events SET processed_at = now(), error = 'fusion de contactos'
   WHERE contact_id = p_duplicate AND processed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events_cancelled', v_n);
  UPDATE public.automation_events SET contact_id = p_main
   WHERE contact_id = p_duplicate AND processed_at IS NOT NULL AND error IS DISTINCT FROM 'fusion de contactos';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('automation_events', v_n);

  -- Tareas: si los dos tienen un seguimiento para la misma fecha, el del duplicado pasa como tarea normal (sin la clave).
  UPDATE public.tasks d SET source_ref = NULL
   WHERE d.contact_id = p_duplicate AND d.source_ref LIKE 'followup:%' AND d.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.tasks m WHERE m.workspace_id = d.workspace_id AND m.contact_id = p_main AND m.source_ref = d.source_ref AND m.deleted_at IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks_detached', v_n);
  UPDATE public.tasks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('tasks', v_n);

  -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
  UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
  IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;

  -- Pipeline (00245): el historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
  UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);

  -- Formularios: "una vez por contacto" guarda `contact:<id>`; la respuesta que se mueve pasa a `contact:<principal>` salvo
  -- que el principal ya tenga una para ese formulario (el indice unico no deja dos).
  UPDATE public.form_submissions fs SET once_key = 'contact:' || p_main::text
   WHERE fs.contact_id = p_duplicate AND fs.once_key = 'contact:' || p_duplicate::text
     AND NOT EXISTS (SELECT 1 FROM public.form_submissions o WHERE o.form_id = fs.form_id AND o.once_key = 'contact:' || p_main::text AND o.status <> 'spam' AND fs.status <> 'spam');
  UPDATE public.form_submissions SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('form_submissions', v_n);

  -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las ventas llevan sus pagos; las agendas y
  -- las llamadas no cambian de estado ni de monto.
  FOREACH v_table IN ARRAY ARRAY[
    'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'calls', 'contact_notes',
    'contract_signatures', 'email_log', 'inbound_webhooks', 'sales', 'social_post_comments', 'trigger_fires'
  ] LOOP
    EXECUTE format('UPDATE public.%I SET contact_id = $1 WHERE contact_id = $2', v_table) USING p_main, p_duplicate;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_moved := v_moved || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- Los contactos que el duplicado habia referido pasan a ser referidos por el principal.
  UPDATE public.contacts SET referred_by_contact_id = NULL WHERE id = p_main AND referred_by_contact_id = p_duplicate;
  UPDATE public.contacts SET referred_by_contact_id = p_main WHERE referred_by_contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('referred_contacts', v_n);

  -- Los datos de identidad que el principal tiene vacios se completan con los del duplicado (nunca al reves), mas la fecha
  -- del proximo seguimiento.
  UPDATE public.contacts SET
    display_name = CASE WHEN NULLIF(btrim(COALESCE(display_name, '')), '') IS NULL THEN COALESCE(v_dup.display_name, display_name) ELSE display_name END,
    email = CASE WHEN NULLIF(btrim(COALESCE(email, '')), '') IS NULL THEN COALESCE(v_dup.email, email) ELSE email END,
    secondary_email = CASE WHEN NULLIF(btrim(COALESCE(secondary_email, '')), '') IS NULL THEN COALESCE(v_dup.secondary_email, secondary_email) ELSE secondary_email END,
    phone = CASE WHEN NULLIF(btrim(COALESCE(phone, '')), '') IS NULL THEN COALESCE(v_dup.phone, phone) ELSE phone END,
    whatsapp_phone = CASE WHEN NULLIF(btrim(COALESCE(whatsapp_phone, '')), '') IS NULL THEN COALESCE(v_dup.whatsapp_phone, whatsapp_phone) ELSE whatsapp_phone END,
    country = CASE WHEN NULLIF(btrim(COALESCE(country, '')), '') IS NULL THEN COALESCE(v_dup.country, country) ELSE country END,
    instagram_username = CASE WHEN NULLIF(btrim(COALESCE(instagram_username, '')), '') IS NULL THEN COALESCE(v_dup.instagram_username, instagram_username) ELSE instagram_username END,
    tiktok_username = CASE WHEN NULLIF(btrim(COALESCE(tiktok_username, '')), '') IS NULL THEN COALESCE(v_dup.tiktok_username, tiktok_username) ELSE tiktok_username END,
    twitter_username = CASE WHEN NULLIF(btrim(COALESCE(twitter_username, '')), '') IS NULL THEN COALESCE(v_dup.twitter_username, twitter_username) ELSE twitter_username END,
    facebook_id = CASE WHEN NULLIF(btrim(COALESCE(facebook_id, '')), '') IS NULL THEN COALESCE(v_dup.facebook_id, facebook_id) ELSE facebook_id END,
    youtube_channel_id = CASE WHEN NULLIF(btrim(COALESCE(youtube_channel_id, '')), '') IS NULL THEN COALESCE(v_dup.youtube_channel_id, youtube_channel_id) ELSE youtube_channel_id END,
    linkedin_profile_url = CASE WHEN NULLIF(btrim(COALESCE(linkedin_profile_url, '')), '') IS NULL THEN COALESCE(v_dup.linkedin_profile_url, linkedin_profile_url) ELSE linkedin_profile_url END,
    setter_id = COALESCE(setter_id, v_dup.setter_id),
    vendedor_id = COALESCE(vendedor_id, v_dup.vendedor_id),
    next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date),
    -- Producto de interes (00246): gana el del principal; si no tiene, el del duplicado con SU variante.
    interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
    interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
   WHERE id = p_main;

  -- Pipeline (00245): el estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula
  -- con la misma regla que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo
  -- se escriben con la marca de transaccion (`contacts_status_guard`).
  IF v_main.setter_status IS NOT NULL THEN
    v_setter := v_main.setter_status; v_setter_at := v_main.setter_status_at; v_setter_by_agent := v_main.setter_status_by_agent;
  ELSE
    v_setter := v_dup.setter_status; v_setter_at := v_dup.setter_status_at; v_setter_by_agent := COALESCE(v_dup.setter_status_by_agent, false);
  END IF;
  IF v_main.closer_status IS NOT NULL THEN
    v_closer := v_main.closer_status; v_closer_at := v_main.closer_status_at;
  ELSE
    v_closer := v_dup.closer_status; v_closer_at := v_dup.closer_status_at;
  END IF;
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;
  IF v_setter IS DISTINCT FROM v_main.setter_status OR v_closer IS DISTINCT FROM v_main.closer_status THEN
    PERFORM set_config('app.contact_status_internal', 'on', true);
    UPDATE public.contacts SET
      setter_status = v_setter, setter_status_at = v_setter_at, setter_status_by_agent = COALESCE(v_setter_by_agent, false),
      closer_status = v_closer, closer_status_at = v_closer_at,
      last_status_role = v_last_role, last_status = v_last, last_status_at = v_last_at
     WHERE id = p_main;
    PERFORM set_config('app.contact_status_internal', 'off', true);
  END IF;

  -- Las notas de los dos se juntan (dos textos de personas distintas sobre el mismo lead: quedarse con uno tira el otro).
  v_notes := concat_ws(E'\n\n---\n\n', NULLIF(btrim(COALESCE(v_main.notes, '')), ''), NULLIF(btrim(COALESCE(v_dup.notes, '')), ''));
  IF v_notes <> '' AND v_notes IS DISTINCT FROM btrim(COALESCE(v_main.notes, '')) THEN
    UPDATE public.contacts SET notes = v_notes WHERE id = p_main;
  END IF;

  -- La sugerencia de vinculacion ya no corresponde.
  UPDATE public.contacts SET metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb), '{link_suggestions}',
      COALESCE((SELECT jsonb_agg(s) FROM jsonb_array_elements(metadata -> 'link_suggestions') s WHERE s ->> 'contact_id' IS DISTINCT FROM p_duplicate::text), '[]'::jsonb))
   WHERE id = p_main AND jsonb_typeof(metadata -> 'link_suggestions') = 'array';

  -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
          jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);

  RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
END;
$fn$;

REVOKE ALL ON FUNCTION public.merge_contacts(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_contacts(uuid, uuid, uuid, uuid) TO service_role;
