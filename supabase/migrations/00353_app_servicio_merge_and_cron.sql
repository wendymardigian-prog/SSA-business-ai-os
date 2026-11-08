-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00353_app_servicio_merge_and_cron  (Servicios v12, Corrida A1 · S16 · bloque X)
-- ============================================================================
-- (El plano la numeraba 00344; la 00344 y la 00347 a la 00350 las ocuparon otras sesiones.)
--
-- 1. `app_servicio.merge_contacts_hook(principal, duplicado)` (F89): mueve servicios, cuenta y accesos del portal,
--    avance, asistencia, clics, comunidad y las conversaciones del canal `portal`. Reglas: dos cuentas del portal ->
--    queda la del principal y se revocan las sesiones de la otra (que queda suspendida); avance repetido -> la fecha
--    mas vieja; asistencias repetidas -> una; dos servicios activos del mismo producto -> quedan los dos y se avisa.
--    Al final llama a `app_servicio_proyectos.merge_contacts_hook` si existe (Corrida C; en A1 no existe).
-- 2. `public.merge_contacts` copiada de LA BASE (8/11, huella 16f208bca5e1fb78b3e156fe7728dc00, con lo de afiliados de
--    la 00343) y una sola cosa sumada: al final, en la misma transaccion, llama al gancho si existe (`to_regprocedure`).
--    La definicion vieja completa, al final de esta cabecera.
-- 3. El barrido diario (F88): `app_servicio.svc_daily_run(negocio)`, cada paso en su bloque (si alguno falla, el job
--    lanza al final), `private.enqueue_svc_daily()` (uno por negocio con el modulo prendido, desde las 02:00 de su
--    zona, una vez por dia) y `cron.schedule('svc-daily', '23 * * * *')` por SQL directo (no `call_app_cron`; lo
--    procesa la cola de jobs, que ya tiene su guarda).
-- 4. Emitir el certificado al llegar al paso (F67, «Emitirlo solo»): al abrirse una fase, sus pasos Certificado con
--    `auto_issue` encolan `svc_certificate_issue`.
-- 5. `app_servicio.assistant_set_own_limit(servicio, limite)` (F85, `tutor.manage`): el limite propio de un estudiante.
-- 6. `app_servicio.program_card_metrics(productos, dias)` (F108): los 8 numeros de cada card de Portal › Programas, en
--    una consulta, con `services.view` o `program.manage`. Sin tablas nuevas; los servicios de prueba no cuentan.
--
-- Cómo volver atrás:
--   SELECT cron.unschedule('svc-daily');
--   DROP TRIGGER IF EXISTS trg_app_servicio_phase_certificate ON app_servicio.service_phases;
--   CREATE OR REPLACE FUNCTION public.merge_contacts ... <la definicion vieja de abajo>;
--   DROP FUNCTION de cada funcion nueva (merge_contacts_hook, svc_daily_run, private.enqueue_svc_daily,
--     phase_certificate_hook, assistant_set_own_limit, program_card_metrics).
--
-- Riesgo: medio (reescribe `merge_contacts`, de BAIOS; el cambio es una llamada condicional al final).
--
-- Definicion vieja de public.merge_contacts (leida de la base el 8/11/2026):
--   CREATE OR REPLACE FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
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
--     -- Pipeline (00245): el estado de cada rol despues de fusionar, y el ultimo.
--     v_setter text;
--     v_setter_at timestamptz;
--     v_setter_by_agent boolean;
--     v_closer text;
--     v_closer_at timestamptz;
--     v_last_role text;
--     v_last text;
--     v_last_at timestamptz;
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
--     -- Pipeline (00245): el historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
--     UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);
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
--     -- Afiliados (00343, F71-F75): lo que apuntaba al duplicado pasa al principal. Un contacto no es su propio afiliado
--     -- ni el afiliado de su propia venta: en esos casos queda vacio. El codigo se mueve si el principal no tiene.
--     PERFORM set_config('app.affiliates_internal', 'on', true);
--     UPDATE public.contacts SET affiliate_contact_id = NULL, affiliate_kind = NULL, affiliate_assigned_at = NULL, affiliate_expires_at = NULL, affiliate_source = NULL
--      WHERE id = p_main AND affiliate_contact_id = p_duplicate;
--     UPDATE public.contacts SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate AND id <> p_main;
--     GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('affiliate_contacts', v_n);
--     UPDATE public.sales SET affiliate_contact_id = NULL, affiliate_kind = NULL WHERE affiliate_contact_id = p_duplicate AND contact_id = p_main;
--     UPDATE public.sales SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate;
--     UPDATE public.commissions SET contact_id = p_main WHERE contact_id = p_duplicate;
--     IF EXISTS (SELECT 1 FROM public.vendors WHERE workspace_id = p_workspace_id AND contact_id = p_main) THEN
--       UPDATE public.vendors SET contact_id = NULL WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
--     ELSE
--       UPDATE public.vendors SET contact_id = p_main WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
--     END IF;
--     IF (SELECT affiliate_code FROM public.contacts WHERE id = p_main) IS NULL AND v_dup.affiliate_code IS NOT NULL THEN
--       UPDATE public.contacts SET affiliate_code = NULL WHERE id = p_duplicate;
--       UPDATE public.contacts SET affiliate_code = v_dup.affiliate_code WHERE id = p_main;
--     END IF;
--     IF (SELECT affiliate_user_id IS NULL AND affiliate_contact_id IS NULL FROM public.contacts WHERE id = p_main)
--        AND (v_dup.affiliate_user_id IS NOT NULL OR (v_dup.affiliate_contact_id IS NOT NULL AND v_dup.affiliate_contact_id <> p_main)) THEN
--       UPDATE public.contacts SET affiliate_user_id = v_dup.affiliate_user_id, affiliate_contact_id = v_dup.affiliate_contact_id,
--         affiliate_kind = v_dup.affiliate_kind, affiliate_assigned_at = v_dup.affiliate_assigned_at, affiliate_expires_at = v_dup.affiliate_expires_at,
--         affiliate_last_ref_at = v_dup.affiliate_last_ref_at, affiliate_source = v_dup.affiliate_source
--        WHERE id = p_main;
--     END IF;
--     PERFORM set_config('app.affiliates_internal', 'off', true);
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
--       next_followup_date = COALESCE(next_followup_date, v_dup.next_followup_date),
--       -- Producto de interes (00246): gana el del principal; si no tiene, el del duplicado con SU variante.
--       interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
--       interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
--      WHERE id = p_main;
--   
--     -- Pipeline (00245): el estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula
--     -- con la misma regla que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo
--     -- se escriben con la marca de transaccion (`contacts_status_guard`).
--     IF v_main.setter_status IS NOT NULL THEN
--       v_setter := v_main.setter_status; v_setter_at := v_main.setter_status_at; v_setter_by_agent := v_main.setter_status_by_agent;
--     ELSE
--       v_setter := v_dup.setter_status; v_setter_at := v_dup.setter_status_at; v_setter_by_agent := COALESCE(v_dup.setter_status_by_agent, false);
--     END IF;
--     IF v_main.closer_status IS NOT NULL THEN
--       v_closer := v_main.closer_status; v_closer_at := v_main.closer_status_at;
--     ELSE
--       v_closer := v_dup.closer_status; v_closer_at := v_dup.closer_status_at;
--     END IF;
--     IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
--       v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
--     ELSIF v_setter IS NOT NULL THEN
--       v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
--     ELSE
--       v_last_role := NULL; v_last := NULL; v_last_at := NULL;
--     END IF;
--     IF v_setter IS DISTINCT FROM v_main.setter_status OR v_closer IS DISTINCT FROM v_main.closer_status THEN
--       PERFORM set_config('app.contact_status_internal', 'on', true);
--       UPDATE public.contacts SET
--         setter_status = v_setter, setter_status_at = v_setter_at, setter_status_by_agent = COALESCE(v_setter_by_agent, false),
--         closer_status = v_closer, closer_status_at = v_closer_at,
--         last_status_role = v_last_role, last_status = v_last, last_status_at = v_last_at
--        WHERE id = p_main;
--       PERFORM set_config('app.contact_status_internal', 'off', true);
--     END IF;
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
--   $function$
-- ============================================================================

-- ─── 1. El gancho de la fusion ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_out jsonb := '{}'::jsonb;
  n integer;
  acc_main uuid;
  acc_dup uuid;
  dupe record;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.contacts WHERE id = p_main;
  -- Servicios: los dos quedan (si son del mismo producto y estan activos, se avisa).
  UPDATE app_servicio.services SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('services', n);
  FOR dupe IN SELECT product_id, count(*) c FROM app_servicio.services WHERE contact_id = p_main AND status IN ('active', 'paused') GROUP BY product_id HAVING count(*) > 1 LOOP
    PERFORM app_servicio.notify_admins(v_ws, 'svc_merge_two_services', 'Dos servicios del mismo producto',
      'Al unir dos contactos quedaron dos servicios activos del mismo producto. Revisá si hay que cancelar uno.', 'contact', p_main,
      jsonb_build_object('product_id', dupe.product_id));
  END LOOP;
  -- La cuenta del portal: si los dos tienen, queda la del principal; la otra se suspende y sus sesiones se revocan.
  SELECT id INTO acc_main FROM app_servicio_portal.portal_accounts WHERE contact_id = p_main;
  SELECT id INTO acc_dup FROM app_servicio_portal.portal_accounts WHERE contact_id = p_duplicate;
  IF acc_dup IS NOT NULL THEN
    IF acc_main IS NULL THEN
      UPDATE app_servicio_portal.portal_accounts SET contact_id = p_main, updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts', 1);
    ELSE
      UPDATE app_servicio_portal.portal_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = acc_dup;
      UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = COALESCE(suspended_at, now()),
             suspended_reason = 'Se unió con otro contacto', updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts_suspended', 1);
    END IF;
  END IF;
  UPDATE app_servicio_portal.portal_sessions SET preview_contact_id = p_main WHERE preview_contact_id = p_duplicate;
  UPDATE app_servicio_portal.portal_access SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('portal_access', n);
  -- Avance: si los dos vieron la misma clase, queda la fecha mas vieja.
  UPDATE app_servicio_portal.program_progress m
     SET viewed_at = LEAST(m.viewed_at, d.viewed_at), completed_at = LEAST(m.completed_at, d.completed_at),
         unlocked_at = LEAST(m.unlocked_at, d.unlocked_at), last_position_seconds = GREATEST(m.last_position_seconds, d.last_position_seconds), updated_at = now()
    FROM app_servicio_portal.program_progress d
   WHERE m.contact_id = p_main AND d.contact_id = p_duplicate AND d.program_item_id = m.program_item_id;
  DELETE FROM app_servicio_portal.program_progress d
   WHERE d.contact_id = p_duplicate AND EXISTS (SELECT 1 FROM app_servicio_portal.program_progress m WHERE m.contact_id = p_main AND m.program_item_id = d.program_item_id);
  UPDATE app_servicio_portal.program_progress SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('program_progress', n);
  -- Asistencia: una por sesion y fecha.
  DELETE FROM app_servicio_portal.live_attendance d
   WHERE d.contact_id = p_duplicate AND d.removed_at IS NULL
     AND EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance m WHERE m.contact_id = p_main AND m.live_session_id = d.live_session_id
                   AND m.occurs_on = d.occurs_on AND m.removed_at IS NULL);
  UPDATE app_servicio_portal.live_attendance SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('live_attendance', n);
  UPDATE app_servicio.link_clicks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('link_clicks', n);
  -- Comunidad: los posts pasan al principal; una reaccion repetida queda una.
  UPDATE app_servicio_portal.community_posts SET author_contact_id = p_main WHERE author_contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('community_posts', n);
  DELETE FROM app_servicio_portal.community_reactions d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions m WHERE m.contact_id = p_main AND m.post_id = d.post_id AND m.kind = d.kind);
  UPDATE app_servicio_portal.community_reactions SET contact_id = p_main WHERE contact_id = p_duplicate;
  -- Las conversaciones con el tutor.
  UPDATE public.ai_threads SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate AND channel = 'portal';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('ai_threads_portal', n);
  -- La extension de proyectos (Corrida C), si existe.
  IF to_regprocedure('app_servicio_proyectos.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT app_servicio_proyectos.merge_contacts_hook($1, $2)' INTO dupe USING p_main, p_duplicate;
  END IF;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.merge_contacts_hook(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.merge_contacts_hook(uuid, uuid) TO service_role;

-- ─── 2. merge_contacts (copiada de la base, con la llamada al gancho) ───────
CREATE OR REPLACE FUNCTION public.merge_contacts(p_workspace_id uuid, p_main uuid, p_duplicate uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main public.contacts%ROWTYPE;
  v_dup public.contacts%ROWTYPE;
  v_moved jsonb := '{}'::jsonb;
  v_svc_moved jsonb;
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

  -- Afiliados (00343, F71-F75): lo que apuntaba al duplicado pasa al principal. Un contacto no es su propio afiliado
  -- ni el afiliado de su propia venta: en esos casos queda vacio. El codigo se mueve si el principal no tiene.
  PERFORM set_config('app.affiliates_internal', 'on', true);
  UPDATE public.contacts SET affiliate_contact_id = NULL, affiliate_kind = NULL, affiliate_assigned_at = NULL, affiliate_expires_at = NULL, affiliate_source = NULL
   WHERE id = p_main AND affiliate_contact_id = p_duplicate;
  UPDATE public.contacts SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate AND id <> p_main;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('affiliate_contacts', v_n);
  UPDATE public.sales SET affiliate_contact_id = NULL, affiliate_kind = NULL WHERE affiliate_contact_id = p_duplicate AND contact_id = p_main;
  UPDATE public.sales SET affiliate_contact_id = p_main WHERE affiliate_contact_id = p_duplicate;
  UPDATE public.commissions SET contact_id = p_main WHERE contact_id = p_duplicate;
  IF EXISTS (SELECT 1 FROM public.vendors WHERE workspace_id = p_workspace_id AND contact_id = p_main) THEN
    UPDATE public.vendors SET contact_id = NULL WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
  ELSE
    UPDATE public.vendors SET contact_id = p_main WHERE workspace_id = p_workspace_id AND contact_id = p_duplicate;
  END IF;
  IF (SELECT affiliate_code FROM public.contacts WHERE id = p_main) IS NULL AND v_dup.affiliate_code IS NOT NULL THEN
    UPDATE public.contacts SET affiliate_code = NULL WHERE id = p_duplicate;
    UPDATE public.contacts SET affiliate_code = v_dup.affiliate_code WHERE id = p_main;
  END IF;
  IF (SELECT affiliate_user_id IS NULL AND affiliate_contact_id IS NULL FROM public.contacts WHERE id = p_main)
     AND (v_dup.affiliate_user_id IS NOT NULL OR (v_dup.affiliate_contact_id IS NOT NULL AND v_dup.affiliate_contact_id <> p_main)) THEN
    UPDATE public.contacts SET affiliate_user_id = v_dup.affiliate_user_id, affiliate_contact_id = v_dup.affiliate_contact_id,
      affiliate_kind = v_dup.affiliate_kind, affiliate_assigned_at = v_dup.affiliate_assigned_at, affiliate_expires_at = v_dup.affiliate_expires_at,
      affiliate_last_ref_at = v_dup.affiliate_last_ref_at, affiliate_source = v_dup.affiliate_source
     WHERE id = p_main;
  END IF;
  PERFORM set_config('app.affiliates_internal', 'off', true);

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

  -- Servicios (00353, S16): si el modulo esta instalado, mueve lo suyo (servicios, portal, asistencia, comunidad y
  -- conversaciones del portal) en esta misma transaccion. En una instalacion sin el modulo no existe y no se llama.
  IF to_regprocedure('app_servicio.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT app_servicio.merge_contacts_hook($1, $2)' INTO v_svc_moved USING p_main, p_duplicate;
    v_moved := v_moved || COALESCE(v_svc_moved, '{}'::jsonb);
  END IF;

  -- El historial del contacto principal, en la misma transaccion (sin datos sensibles: solo cuentas).
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (p_workspace_id, 'contact', p_main, 'link', NULL,
          jsonb_build_object('merged_from', p_duplicate, 'automatic', false, 'moved', v_moved), p_actor);

  RETURN jsonb_build_object('ok', true, 'main', p_main, 'duplicate', p_duplicate, 'moved', v_moved);
END;
$function$;

-- ─── 3. El barrido diario (F88) ─────────────────────────────────────────────
-- Cada paso en su bloque: uno que falla no frena a los demas, y queda en `errors`. Dos veces el mismo dia no duplica
-- nada (cada evento se mira contra lo ya emitido; cada estado, contra lo que ya cambio).
CREATE OR REPLACE FUNCTION app_servicio.svc_daily_run(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date;
  v_out jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  n integer;
  s app_servicio.services;
  it record;
  r record;
  d integer;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('skipped', 'module_off'); END IF;
  PERFORM app_servicio.as_system();
  v_today := app_servicio.today_in(p_workspace_id);

  -- Repeticiones (F21) y Retos de fecha fija (F22).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' LOOP
      PERFORM app_servicio.svc_generate_occurrences(s.id);
      n := n + app_servicio.svc_open_due_challenges(s.id);
    END LOOP;
    v_out := v_out || jsonb_build_object('challenges_opened', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('occurrences: ' || SQLERRM);
  END;

  -- Pasos vencidos y su evento (F25), una vez por paso.
  BEGIN
    n := 0;
    FOR it IN SELECT i.id, i.service_id, i.template_key, i.name FROM app_servicio.service_items i JOIN app_servicio.services sv ON sv.id = i.service_id
               WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test AND i.status = 'pending' AND NOT i.is_recurring_template
                 AND i.due_on IS NOT NULL AND i.due_on < v_today
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_item_overdue'
                                   AND e.payload ->> 'item_id' = i.id::text) LOOP
      PERFORM app_servicio.emit_service(it.service_id, 'service_item_overdue', jsonb_build_object('item_id', it.id, 'item_key', it.template_key, 'item_name', it.name));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('items_overdue', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('overdue: ' || SQLERRM);
  END;

  -- Semaforo (F24).
  BEGIN
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status IN ('active', 'paused') LOOP
      PERFORM app_servicio.svc_compute_light(s.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('light: ' || SQLERRM);
  END;

  -- Accesos que se abren con el tiempo y mora (F39).
  BEGIN
    v_out := v_out || jsonb_build_object('access', app_servicio.svc_access_tick(p_workspace_id));
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access: ' || SQLERRM);
  END;

  -- Renovados que llegan a su fin (F9): el anterior pasa a «renovado» y lo que el nuevo tambien da pasa al nuevo.
  BEGIN
    n := 0;
    FOR s IN SELECT o.* FROM app_servicio.services o
              WHERE o.workspace_id = p_workspace_id AND o.status IN ('active', 'paused') AND o.ends_on IS NOT NULL AND o.ends_on < v_today
                AND EXISTS (SELECT 1 FROM app_servicio.services nx WHERE nx.previous_service_id = o.id AND nx.status IN ('active', 'paused', 'pending_confirmation')) LOOP
      PERFORM app_servicio.svc_cut_access(s.id, 'renewed');
      UPDATE app_servicio.services SET status = 'renewed', completed_at = COALESCE(completed_at, now()), updated_at = now() WHERE id = s.id;
      PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.renewed', '{}'::jsonb, 'system');
      PERFORM app_servicio.emit_service(s.id, 'service_status_changed', jsonb_build_object('previous_status', s.status));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('renewed_closed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('renewed: ' || SQLERRM);
  END;

  -- Accesos por vencer (7 dias) y vencidos (ayer), una vez por acceso.
  BEGIN
    n := 0;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at > now() AND a.ends_at <= now() + interval '7 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expiring'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expiring', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    FOR r IN SELECT a.id, a.service_id, a.section, a.ends_at FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
              WHERE a.workspace_id = p_workspace_id AND a.revoked_at IS NULL AND a.ends_at IS NOT NULL AND NOT sv.is_test
                AND a.ends_at <= now() AND a.ends_at > now() - interval '3 days'
                AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'portal_access_expired'
                                  AND e.payload ->> 'access_id' = a.id::text) LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'portal_access_expired', jsonb_build_object('access_id', r.id, 'section', r.section, 'ends_at', r.ends_at));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('access_events', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('access_events: ' || SQLERRM);
  END;

  -- «Faltó» (F61): fechas de ayer con la ventana cerrada, para quien tiene acceso Calendario vigente, la sesion es de su
  -- variante, el servicio no esta pausado y no tiene asistencia. Una vez por persona, sesion y fecha.
  BEGIN
    n := 0;
    FOR r IN
      SELECT ls.id AS session_id, (o ->> 'occursOn')::date AS occurs_on, sv.id AS service_id, sv.contact_id
        FROM app_servicio.live_sessions ls
        CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
          'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                        'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                        'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
          'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', x.occurs_on, 'status', x.status, 'moved_to', x.moved_to))
                                    FROM app_servicio.live_session_dates x WHERE x.live_session_id = ls.id), '[]'::jsonb),
          'from', v_today - 2, 'to', v_today))) o
        JOIN app_servicio.services sv ON sv.product_id = ls.product_id AND sv.status = 'active' AND NOT sv.is_test
       WHERE ls.workspace_id = p_workspace_id AND ls.archived_at IS NULL AND o ->> 'status' <> 'cancelled'
         AND (o ->> 'endsAt')::timestamptz + interval '30 minutes' < now()
         AND (ls.variant_ids IS NULL OR sv.product_variant_id = ANY (ls.variant_ids))
         AND EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.service_id = sv.id AND a.section = 'calendar' AND a.revoked_at IS NULL
                       AND a.starts_at <= (o ->> 'startsAt')::timestamptz AND (a.ends_at IS NULL OR a.ends_at > (o ->> 'startsAt')::timestamptz))
         AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance la WHERE la.live_session_id = ls.id AND la.occurs_on = (o ->> 'occursOn')::date
                           AND la.contact_id = sv.contact_id AND la.removed_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'live_session_missed'
                           AND e.contact_id = sv.contact_id AND e.payload ->> 'live_session_id' = ls.id::text AND e.payload ->> 'occurs_on' = (o ->> 'occursOn'))
    LOOP
      PERFORM app_servicio.emit_service(r.service_id, 'live_session_missed', jsonb_build_object('live_session_id', r.session_id, 'occurs_on', r.occurs_on::text));
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('missed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('missed: ' || SQLERRM);
  END;

  -- «Reanudar sola» (F94).
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'paused' AND pause_resume_on IS NOT NULL AND pause_resume_on <= v_today LOOP
      PERFORM app_servicio.svc_resume(s.id, '{}'::jsonb);
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('resumed', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('resume: ' || SQLERRM);
  END;

  -- Servicios que empiezan hoy (F14, F115): `service_started` una vez.
  BEGIN
    n := 0;
    FOR s IN SELECT * FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' AND starts_on IS NOT NULL AND starts_on <= v_today
               AND NOT COALESCE((flags ->> 'started_emitted')::boolean, false) LOOP
      PERFORM app_servicio.emit(s, 'service_started');
      UPDATE app_servicio.services SET flags = flags || '{"started_emitted": true}'::jsonb WHERE id = s.id;
      n := n + 1;
    END LOOP;
    v_out := v_out || jsonb_build_object('started', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('started: ' || SQLERRM);
  END;

  -- `service_ending_soon` (F25): N dias antes de `ends_on`, una vez por servicio y por N. Los N salen de los
  -- disparadores activos del negocio (si no hay ninguno, no se emite nada).
  BEGIN
    n := 0;
    FOR d IN SELECT DISTINCT (t.config ->> 'days')::integer FROM public.triggers t
              WHERE t.workspace_id = p_workspace_id AND t.type = 'service_ending_soon' AND t.is_active
                AND jsonb_typeof(t.config -> 'days') = 'number' AND (t.config ->> 'days')::integer BETWEEN 0 AND 365 LOOP
      FOR s IN SELECT * FROM app_servicio.services sv WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND NOT sv.is_test
                 AND sv.ends_on = v_today + d
                 AND NOT EXISTS (SELECT 1 FROM public.automation_events e WHERE e.workspace_id = p_workspace_id AND e.event_type = 'service_ending_soon'
                                   AND e.payload ->> 'service_id' = sv.id::text AND e.payload ->> 'days' = d::text) LOOP
        PERFORM app_servicio.emit(s, 'service_ending_soon', jsonb_build_object('days', d));
        n := n + 1;
      END LOOP;
    END LOOP;
    v_out := v_out || jsonb_build_object('ending_soon', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('ending_soon: ' || SQLERRM);
  END;

  -- Purga de la comunidad (F76): lo borrado hace mas de 30 dias.
  BEGIN
    DELETE FROM app_servicio_portal.community_posts WHERE workspace_id = p_workspace_id AND deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
    GET DIAGNOSTICS n = ROW_COUNT;
    v_out := v_out || jsonb_build_object('community_purged', n);
  EXCEPTION WHEN OTHERS THEN v_errors := v_errors || to_jsonb('community: ' || SQLERRM);
  END;

  RETURN v_out || jsonb_build_object('errors', v_errors, 'day', v_today);
END;
$$;

-- Uno por negocio con el modulo prendido, desde las 02:00 de su zona, una vez por dia.
CREATE OR REPLACE FUNCTION private.enqueue_svc_daily(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws record;
  v_local timestamp;
  v_key text;
  v_n integer := 0;
BEGIN
  FOR v_ws IN SELECT w.id, COALESCE(w.timezone, 'UTC') AS tz FROM public.workspaces w WHERE w.services_enabled IS TRUE LOOP
    BEGIN
      BEGIN
        v_local := p_now AT TIME ZONE v_ws.tz;
      EXCEPTION WHEN OTHERS THEN
        v_local := p_now AT TIME ZONE 'UTC';
      END;
      CONTINUE WHEN v_local::time < time '02:00';
      v_key := 'svc_daily:' || v_ws.id::text || ':' || v_local::date::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('svc_daily', jsonb_build_object('workspace_id', v_ws.id, 'local_date', v_local::date::text), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN v_n := v_n + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_svc_daily: no pude encolar el negocio %: %', v_ws.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_daily_run(uuid), private.enqueue_svc_daily(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_daily_run(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'svc-daily') THEN PERFORM cron.unschedule('svc-daily'); END IF;
  PERFORM cron.schedule('svc-daily', '23 * * * *', $c$SELECT private.enqueue_svc_daily()$c$);
END $$;

-- ─── 4. Emitir el certificado al llegar al paso (F67) ───────────────────────
CREATE OR REPLACE FUNCTION app_servicio.phase_certificate_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  FOR it IN SELECT i.id FROM app_servicio.service_items i
             WHERE i.phase_id = NEW.id AND i.kind = 'certificate' AND i.status = 'pending' AND NOT i.is_recurring_template
               AND COALESCE((i.ref ->> 'auto_issue')::boolean, false) LOOP
    INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
    VALUES ('svc_certificate_issue', jsonb_build_object('service_id', NEW.service_id, 'workspace_id', NEW.workspace_id, 'item_id', it.id), now(),
            'svc_certificate_issue:' || it.id::text)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.phase_certificate_hook: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.phase_certificate_hook() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_app_servicio_phase_certificate ON app_servicio.service_phases;
CREATE TRIGGER trg_app_servicio_phase_certificate AFTER INSERT OR UPDATE OF status ON app_servicio.service_phases
  FOR EACH ROW WHEN (NEW.status = 'in_progress') EXECUTE FUNCTION app_servicio.phase_certificate_hook();

-- ─── 5. El limite propio del asistente (F85) ────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.assistant_set_own_limit(p_service_id uuid, p_limit_usd numeric)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  n integer;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'tutor.manage');
  IF p_limit_usd IS NOT NULL AND (p_limit_usd < 0 OR p_limit_usd > 10000) THEN RAISE EXCEPTION 'El límite va de 0 a 10.000 dólares' USING ERRCODE = 'IA002'; END IF;
  UPDATE app_servicio_portal.portal_access SET ai_monthly_limit_usd = p_limit_usd, updated_at = now()
   WHERE service_id = s.id AND section = 'assistant' AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'El servicio no tiene acceso al Asistente IA' USING ERRCODE = 'IA002'; END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'tutor.own_limit', jsonb_build_object('limit_usd', p_limit_usd));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.assistant_set_own_limit(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.assistant_set_own_limit(uuid, numeric) TO authenticated, service_role;

-- ─── 6. Las cards de Portal › Programas (F108) ──────────────────────────────
-- Los 8 numeros de cada programa en una consulta. Una seccion apagada da null («—»). «Por revisar» y «por corregir»
-- son la cola de HOY; el resto, del periodo. Los servicios de prueba no cuentan.
CREATE OR REPLACE FUNCTION app_servicio.program_card_metrics(p_product_ids uuid[], p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_days integer := CASE WHEN p_days IN (7, 30) THEN p_days ELSE 30 END;
  v_from timestamptz := now() - make_interval(days => CASE WHEN p_days IN (7, 30) THEN p_days ELSE 30 END);
BEGIN
  SELECT DISTINCT workspace_id INTO v_ws FROM public.products WHERE id = ANY (p_product_ids) LIMIT 1;
  IF v_ws IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE id = ANY (p_product_ids) AND workspace_id <> v_ws) THEN
    RAISE EXCEPTION 'Los programas tienen que ser del mismo negocio' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'services.view') OR public.has_permission(v_ws, 'program.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(pr.id, jsonb_build_object(
    'new_students', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'program') THEN (
        SELECT count(DISTINCT a.contact_id)::int FROM app_servicio_portal.portal_access a JOIN app_servicio.services sv ON sv.id = a.service_id
         WHERE a.product_id = pr.id AND a.section = 'program' AND a.starts_at >= v_from AND a.starts_at <= now() AND NOT sv.is_test) END,
    'lessons_completed', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'program') THEN (
        SELECT count(*)::int FROM app_servicio_portal.program_progress g JOIN app_servicio.program_items i ON i.id = g.program_item_id
         WHERE i.product_id = pr.id AND i.kind = 'lesson' AND g.completed_at >= v_from
           AND NOT EXISTS (SELECT 1 FROM app_servicio.services sv WHERE sv.contact_id = g.contact_id AND sv.product_id = pr.id AND sv.is_test)) END,
    'to_review', (SELECT count(*)::int FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id JOIN public.form_versions v ON v.id = fs.form_version_id
         WHERE f.product_id = pr.id AND f.type = 'activity' AND fs.review_status = 'pending'
           AND NOT COALESCE((v.definition #>> '{grading,enabled}')::boolean, false)),
    'to_grade', (SELECT count(*)::int FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id JOIN public.form_versions v ON v.id = fs.form_version_id
         WHERE f.product_id = pr.id AND f.type = 'activity' AND fs.review_status = 'pending'
           AND COALESCE((v.definition #>> '{grading,enabled}')::boolean, false)),
    'certificates', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'certificate') THEN (
        SELECT count(*)::int FROM public.designs dz JOIN public.design_templates t ON t.id = dz.template_id
          JOIN app_servicio.services sv ON sv.id::text = dz.subject_ref ->> 'id'
         WHERE dz.workspace_id = v_ws AND t.doc_type = 'certificado' AND dz.subject_ref ->> 'module' = 'service' AND sv.product_id = pr.id
           AND NOT sv.is_test AND dz.status IN ('queued', 'rendering', 'ready') AND dz.created_at >= v_from) END,
    'community_posts', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'community') THEN (
        SELECT count(*)::int FROM app_servicio_portal.community_posts c
         WHERE c.product_id = pr.id AND c.parent_id IS NULL AND c.deleted_at IS NULL AND c.hidden_at IS NULL AND c.created_at >= v_from) END,
    'attendance_pct', CASE WHEN app_servicio.portal_section_enabled(pr.id, 'calendar') THEN (
        SELECT CASE WHEN sum(x.base) > 0 THEN round(100.0 * sum(x.att) / sum(x.base))::int END FROM (
          SELECT (SELECT count(*) FROM app_servicio.attendance_base_members(ls.id, (o ->> 'occursOn')::date)) AS base,
                 (SELECT count(*) FROM app_servicio_portal.live_attendance la
                   WHERE la.live_session_id = ls.id AND la.occurs_on = (o ->> 'occursOn')::date AND la.removed_at IS NULL
                     AND la.contact_id IN (SELECT b.contact_id FROM app_servicio.attendance_base_members(ls.id, (o ->> 'occursOn')::date) b)) AS att
            FROM app_servicio.live_sessions ls
            CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
              'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                            'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                            'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
              'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', z.occurs_on, 'status', z.status, 'moved_to', z.moved_to))
                                        FROM app_servicio.live_session_dates z WHERE z.live_session_id = ls.id), '[]'::jsonb),
              'from', (v_from AT TIME ZONE ls.timezone)::date, 'to', (now() AT TIME ZONE ls.timezone)::date))) o
           WHERE ls.product_id = pr.id AND ls.archived_at IS NULL AND o ->> 'status' <> 'cancelled'
             AND (o ->> 'endsAt')::timestamptz + interval '30 minutes' < now()) x) END,
    'inactive_14d', (SELECT count(DISTINCT a.contact_id)::int FROM app_servicio_portal.portal_access a
         JOIN app_servicio.services sv ON sv.id = a.service_id
         LEFT JOIN app_servicio_portal.portal_accounts pa ON pa.contact_id = a.contact_id AND pa.workspace_id = a.workspace_id
        WHERE a.product_id = pr.id AND a.revoked_at IS NULL AND a.starts_at <= now() - interval '14 days' AND (a.ends_at IS NULL OR a.ends_at > now())
          AND NOT sv.is_test AND (pa.last_login_at IS NULL OR pa.last_login_at < now() - interval '14 days')),
    'days', v_days))
    FROM public.products pr WHERE pr.id = ANY (p_product_ids)), '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.program_card_metrics(uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.program_card_metrics(uuid[], integer) TO authenticated, service_role;
