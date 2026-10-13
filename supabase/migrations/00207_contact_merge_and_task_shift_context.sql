-- ============================================================================
-- 00207 — Tareas × CRM (M2): fusion de contactos y regla de fechas del sistema
-- ============================================================================
-- Tres funciones, todas SECURITY DEFINER con `SET search_path = ''`, nombres calificados con `public.`/`private.`.
--
--   1. `public.merge_contacts(p_workspace_id, p_main, p_duplicate, p_actor)` — NUEVA. Solo `service_role`. En UNA transaccion
--      mueve todo lo que cuelga del duplicado al contacto principal (las 24 relaciones con `contacts`, con reglas explicitas
--      para cada indice unico), rellena los datos vacios del principal, junta las notas, deja al duplicado con borrado
--      logico (`metadata.merged_into`), recalcula la atribucion del principal con TODOS los toques, escribe el historial y
--      devuelve cuantas filas movio por tabla. No toca datos hasta que se la llama: aplicarla no cambia nada existente.
--   2. `public.task_shift_context(p_task_id)` — NUEVA. Para `authenticated`. Verifica adentro que quien llama puede completar
--      ese bloqueante (`can_edit_tasks` y `can_see_task`) y devuelve, por cada tarea que depende de el (transitivas) y por los
--      demas bloqueantes de esas, solo lo que la regla de fechas necesita: ids, estado, fechas, hora, dependencias, responsable
--      y seguidores, y el TITULO solo si quien llama puede ver esa tarea (si no, null). Nunca descripciones.
--   3. `public.complete_task_with_shifts(uuid, jsonb, jsonb)` — REEMPLAZO. Misma firma, mismo JSON. Lo unico que cambia: cada
--      corrimiento se valida contra el ARBOL DE DEPENDIENTES del bloqueante que se completa (no contra lo que la persona
--      ve): solo dependientes de esa tarea, abiertas, no borradas, del mismo workspace, que solo atrasan y con el `updated_at`
--      esperado. Cualquier corrimiento fuera del arbol sigue rechazando TODA la operacion. La hora y la duracion se conservan
--      (la funcion solo toca fechas). La auditoria suma el motivo y la tarea bloqueante.
--
-- Permisos: no se debilita ninguno. Quien completa necesita seguir pudiendo editar y ver el bloqueante; solo la regla del
-- sistema mueve la fecha de una dependiente ajena, y solo como consecuencia de eso. Nada mas se abre.
--
-- Compatible con el codigo viejo: las firmas no cambian. El codigo nuevo NO funciona con la base vieja (llama a las dos
-- funciones nuevas), asi que esta migracion se aplica ANTES de desplegar.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.merge_contacts(uuid, uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.task_shift_context(uuid);
--   -- y restaurar complete_task_with_shifts con la definicion VIGENTE antes de esta migracion (leida con pg_get_functiondef):
--   CREATE OR REPLACE FUNCTION public.complete_task_with_shifts(p_task_id uuid, p_shifts jsonb DEFAULT '[]'::jsonb, p_expected jsonb DEFAULT '[]'::jsonb)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_uid uuid := auth.uid();
--     v_task public.tasks%ROWTYPE;
--     v_ids uuid[];
--     v_shift jsonb;
--     v_target public.tasks%ROWTYPE;
--     v_new_due date;
--     v_new_start date;
--     v_exp jsonb;
--     v_seen uuid[] := '{}';
--     v_applied jsonb := '[]'::jsonb;
--   BEGIN
--     BEGIN
--       IF v_uid IS NULL THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
--       END IF;
--       IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR p_expected IS NULL OR jsonb_typeof(p_expected) <> 'array' THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
--       END IF;
--
--       -- Las tareas involucradas, bloqueadas en un orden fijo (sin interbloqueos).
--       SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id), '{}')
--         INTO v_ids
--         FROM (
--           SELECT p_task_id AS id
--           UNION
--           SELECT NULLIF(e ->> 'task_id', '')::uuid FROM jsonb_array_elements(p_shifts) e
--         ) x
--        WHERE x.id IS NOT NULL;
--
--       PERFORM 1 FROM public.tasks WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
--
--       SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
--       IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'not_found');
--       END IF;
--       IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
--       END IF;
--       IF v_task.status = 'completed' THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'already_completed');
--       END IF;
--
--       -- La tarea que se completa no cambio desde que se armo el plan.
--       SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = p_task_id::text LIMIT 1;
--       IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_task.updated_at THEN
--         RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', p_task_id);
--       END IF;
--
--       -- Validar TODOS los corrimientos antes de escribir cualquiera.
--       FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
--         IF jsonb_typeof(v_shift) <> 'object' OR NULLIF(v_shift ->> 'task_id', '') IS NULL OR NULLIF(v_shift ->> 'due_date', '') IS NULL THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
--         END IF;
--
--         BEGIN
--           v_new_due := (v_shift ->> 'due_date')::date;
--           v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;
--         EXCEPTION WHEN OTHERS THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
--         END;
--
--         IF (v_shift ->> 'task_id')::uuid = ANY (v_seen) OR (v_shift ->> 'task_id')::uuid = p_task_id THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
--         END IF;
--         v_seen := v_seen || (v_shift ->> 'task_id')::uuid;
--
--         SELECT * INTO v_target FROM public.tasks
--          WHERE id = (v_shift ->> 'task_id')::uuid AND deleted_at IS NULL;
--         -- Inexistente, de otro workspace, borrada: todas son lo mismo para quien llama.
--         IF NOT FOUND OR v_target.workspace_id <> v_task.workspace_id THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
--         END IF;
--         IF NOT COALESCE(public.can_edit_tasks(v_target.workspace_id) AND public.can_see_task(v_target), false) THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'task_id', v_target.id);
--         END IF;
--         IF v_target.status = 'completed' OR v_target.due_date IS NULL THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
--         END IF;
--         -- Solo atrasa.
--         IF v_new_due <= v_target.due_date THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
--         END IF;
--         IF v_new_start IS NOT NULL AND (v_target.start_date IS NULL OR v_new_start < v_target.start_date OR v_new_start > v_new_due) THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
--         END IF;
--
--         SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = v_target.id::text LIMIT 1;
--         IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_target.updated_at THEN
--           RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', v_target.id);
--         END IF;
--       END LOOP;
--
--       -- Escribir: todo o nada (esto es una sola transaccion).
--       UPDATE public.tasks SET status = 'completed' WHERE id = p_task_id;
--       INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--       VALUES (
--         v_task.workspace_id, 'task', p_task_id, 'task.completed',
--         jsonb_build_object('status', jsonb_build_object('old', v_task.status, 'new', 'completed')),
--         jsonb_build_object('shifted', jsonb_array_length(p_shifts)),
--         v_uid
--       );
--
--       FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
--         SELECT * INTO v_target FROM public.tasks WHERE id = (v_shift ->> 'task_id')::uuid;
--         v_new_due := (v_shift ->> 'due_date')::date;
--         v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;
--
--         UPDATE public.tasks
--            SET due_date = v_new_due,
--                start_date = COALESCE(v_new_start, start_date)
--          WHERE id = v_target.id;
--
--         INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--         VALUES (
--           v_task.workspace_id, 'task', v_target.id, 'task.date_shifted',
--           jsonb_strip_nulls(jsonb_build_object(
--             'due_date', jsonb_build_object('old', v_target.due_date, 'new', v_new_due),
--             'start_date', CASE WHEN v_new_start IS NOT NULL
--                                THEN jsonb_build_object('old', v_target.start_date, 'new', v_new_start) END
--           )),
--           jsonb_build_object('caused_by_task_id', p_task_id),
--           v_uid
--         );
--
--         v_applied := v_applied || jsonb_build_array(jsonb_build_object(
--           'task_id', v_target.id, 'from_due', v_target.due_date, 'to_due', v_new_due
--         ));
--       END LOOP;
--
--       RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'shifted', v_applied);
--     EXCEPTION WHEN data_exception THEN
--       -- Un id o una fecha que no son lo que dicen: es un pedido invalido, no un error del servidor.
--       RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
--     END;
--   END;
--   $function$
--   REVOKE ALL ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) TO authenticated, service_role;
-- Riesgo: medio (reemplaza una funcion de permisos). La vuelta atras es exacta.
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. merge_contacts
-- ------------------------------------------------------------
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
    next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date)
   WHERE id = p_main;

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

-- ------------------------------------------------------------
-- 2. task_shift_context: todo lo que la regla de fechas necesita, sin filtrar lo que la persona no ve
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.task_shift_context(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  -- Solo quien puede completar ese bloqueante (editar y verlo) conoce el contexto de sus dependientes.
  IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  WITH RECURSIVE tree(id) AS (
    SELECT t.id
      FROM public.tasks t
     WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = p_task_id::text)
    UNION
    SELECT t.id
      FROM public.tasks t
      JOIN tree ON EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = tree.id::text)
     WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
  ),
  dep_ids AS (
    SELECT id FROM tree WHERE id <> p_task_id
  ),
  -- Los demas bloqueantes de esas dependientes (para saber su fecha): solo estado y fechas.
  other_ids AS (
    SELECT DISTINCT (b ->> 'task_id')::uuid AS id
      FROM public.tasks d
      CROSS JOIN LATERAL jsonb_array_elements(d.blocked_by) b
     WHERE d.id IN (SELECT id FROM dep_ids)
       AND (b ->> 'task_id')::uuid <> p_task_id
       AND (b ->> 'task_id')::uuid NOT IN (SELECT id FROM dep_ids)
  )
  SELECT COALESCE(jsonb_agg(row_json), '[]'::jsonb) INTO v_rows FROM (
    SELECT jsonb_build_object(
             'id', d.id, 'in_tree', true, 'status', d.status,
             'start_date', d.start_date, 'due_date', d.due_date, 'due_time', d.due_time, 'duration_minutes', d.duration_minutes,
             'completed_at', d.completed_at, 'blocked_by', d.blocked_by, 'owner_id', d.owner_id, 'follower_ids', d.follower_ids,
             'updated_at', d.updated_at,
             'visible', public.can_see_task(d),
             'title', CASE WHEN public.can_see_task(d) THEN d.title END
           ) AS row_json
      FROM public.tasks d
     WHERE d.id IN (SELECT id FROM dep_ids)
    UNION ALL
    SELECT jsonb_build_object(
             'id', o.id, 'in_tree', false, 'status', o.status,
             'start_date', o.start_date, 'due_date', o.due_date, 'due_time', NULL, 'duration_minutes', NULL,
             'completed_at', o.completed_at, 'blocked_by', '[]'::jsonb, 'owner_id', NULL, 'follower_ids', '[]'::jsonb,
             'updated_at', o.updated_at,
             'visible', public.can_see_task(o),
             'title', CASE WHEN public.can_see_task(o) THEN o.title END
           )
      FROM public.tasks o
     WHERE o.id IN (SELECT id FROM other_ids) AND o.workspace_id = v_task.workspace_id AND o.deleted_at IS NULL
  ) x;

  RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'workspace_id', v_task.workspace_id, 'tasks', v_rows);
END;
$fn$;

REVOKE ALL ON FUNCTION public.task_shift_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_shift_context(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. complete_task_with_shifts: la regla de fechas valida contra el ARBOL de dependientes, no contra lo que se ve
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_task_with_shifts(p_task_id uuid, p_shifts jsonb DEFAULT '[]'::jsonb, p_expected jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_task public.tasks%ROWTYPE;
  v_ids uuid[];
  v_tree uuid[];
  v_shift jsonb;
  v_target public.tasks%ROWTYPE;
  v_new_due date;
  v_new_start date;
  v_exp jsonb;
  v_seen uuid[] := '{}';
  v_applied jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    IF v_uid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' OR p_expected IS NULL OR jsonb_typeof(p_expected) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
    END IF;

    -- Las tareas involucradas, bloqueadas en un orden fijo (sin interbloqueos).
    SELECT COALESCE(array_agg(DISTINCT x.id ORDER BY x.id), '{}')
      INTO v_ids
      FROM (
        SELECT p_task_id AS id
        UNION
        SELECT NULLIF(e ->> 'task_id', '')::uuid FROM jsonb_array_elements(p_shifts) e
      ) x
     WHERE x.id IS NOT NULL;

    PERFORM 1 FROM public.tasks WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF NOT FOUND OR NOT public.is_workspace_member(v_task.workspace_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    -- Quien completa necesita poder editar y ver ESE bloqueante. Nada mas se abre.
    IF NOT COALESCE(public.can_edit_tasks(v_task.workspace_id) AND public.can_see_task(v_task), false) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
    IF v_task.status = 'completed' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'already_completed');
    END IF;

    -- La tarea que se completa no cambio desde que se armo el plan.
    SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = p_task_id::text LIMIT 1;
    IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_task.updated_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', p_task_id);
    END IF;

    -- El arbol de dependientes (transitivas) del bloqueante: lo unico que la regla de fechas puede mover.
    WITH RECURSIVE tree(id) AS (
      SELECT t.id
        FROM public.tasks t
       WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = p_task_id::text)
      UNION
      SELECT t.id
        FROM public.tasks t
        JOIN tree ON EXISTS (SELECT 1 FROM jsonb_array_elements(t.blocked_by) b WHERE b ->> 'task_id' = tree.id::text)
       WHERE t.workspace_id = v_task.workspace_id AND t.deleted_at IS NULL
    )
    SELECT COALESCE(array_agg(id), '{}') INTO v_tree FROM tree;

    -- Validar TODOS los corrimientos antes de escribir cualquiera.
    FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
      IF jsonb_typeof(v_shift) <> 'object' OR NULLIF(v_shift ->> 'task_id', '') IS NULL OR NULLIF(v_shift ->> 'due_date', '') IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
      END IF;

      BEGIN
        v_new_due := (v_shift ->> 'due_date')::date;
        v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
      END;

      IF (v_shift ->> 'task_id')::uuid = ANY (v_seen) OR (v_shift ->> 'task_id')::uuid = p_task_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      v_seen := v_seen || (v_shift ->> 'task_id')::uuid;

      -- Solo dependientes de esta tarea. Inexistente, de otro workspace, borrada o de otra cadena: todo es lo mismo.
      IF NOT ((v_shift ->> 'task_id')::uuid = ANY (v_tree)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      SELECT * INTO v_target FROM public.tasks
       WHERE id = (v_shift ->> 'task_id')::uuid AND deleted_at IS NULL AND workspace_id = v_task.workspace_id;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_shift ->> 'task_id');
      END IF;
      IF v_target.status = 'completed' OR v_target.due_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;
      -- Solo atrasa.
      IF v_new_due <= v_target.due_date THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;
      IF v_new_start IS NOT NULL AND (v_target.start_date IS NULL OR v_new_start < v_target.start_date OR v_new_start > v_new_due) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift', 'task_id', v_target.id);
      END IF;

      SELECT e INTO v_exp FROM jsonb_array_elements(p_expected) e WHERE e ->> 'task_id' = v_target.id::text LIMIT 1;
      IF v_exp IS NULL OR (v_exp ->> 'updated_at')::timestamptz IS DISTINCT FROM v_target.updated_at THEN
        RETURN jsonb_build_object('ok', false, 'error', 'stale', 'task_id', v_target.id);
      END IF;
    END LOOP;

    -- Escribir: todo o nada (esto es una sola transaccion).
    UPDATE public.tasks SET status = 'completed' WHERE id = p_task_id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      v_task.workspace_id, 'task', p_task_id, 'task.completed',
      jsonb_build_object('status', jsonb_build_object('old', v_task.status, 'new', 'completed')),
      jsonb_build_object('shifted', jsonb_array_length(p_shifts)),
      v_uid
    );

    FOR v_shift IN SELECT e FROM jsonb_array_elements(p_shifts) e LOOP
      SELECT * INTO v_target FROM public.tasks WHERE id = (v_shift ->> 'task_id')::uuid;
      v_new_due := (v_shift ->> 'due_date')::date;
      v_new_start := NULLIF(v_shift ->> 'start_date', '')::date;

      -- Solo fechas: la hora y la duracion de la tarea se conservan.
      UPDATE public.tasks
         SET due_date = v_new_due,
             start_date = COALESCE(v_new_start, start_date)
       WHERE id = v_target.id;

      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        v_task.workspace_id, 'task', v_target.id, 'task.date_shifted',
        jsonb_strip_nulls(jsonb_build_object(
          'due_date', jsonb_build_object('old', v_target.due_date, 'new', v_new_due),
          'start_date', CASE WHEN v_new_start IS NOT NULL
                             THEN jsonb_build_object('old', v_target.start_date, 'new', v_new_start) END
        )),
        jsonb_build_object('caused_by_task_id', p_task_id, 'reason', 'dependencia completada'),
        v_uid
      );

      v_applied := v_applied || jsonb_build_array(jsonb_build_object(
        'task_id', v_target.id, 'from_due', v_target.due_date, 'to_due', v_new_due
      ));
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'task_id', p_task_id, 'shifted', v_applied);
  EXCEPTION WHEN data_exception THEN
    -- Un id o una fecha que no son lo que dicen: es un pedido invalido, no un error del servidor.
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_shift');
  END;
END;
$function$;

-- Mismos permisos que tenia (CREATE OR REPLACE los conserva; se repiten para que el archivo se lea completo).
REVOKE ALL ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_task_with_shifts(uuid, jsonb, jsonb) TO authenticated, service_role;
