-- ============================================================================
-- Poda de la plantilla de estudiantes
-- ============================================================================
--
-- Se corre sobre una base que tiene TODAS las migraciones del proyecto y la deja
-- como tiene que quedar la plantilla: sin Llamadas (Fathom), Formularios (con el
-- reporte de fin de dia y los contratos), Ventas (ventas y pagos), Tareas,
-- Finanzas (gastos, gastos que se repiten y proveedores), Comisiones ni Webhooks
-- entrantes.
--
-- Se QUEDAN, aunque nacieron junto con esos modulos:
--   - El catalogo de productos (products y product_variants) y su historial.
--   - La Asignacion automatica de leads: assignment_rules, el disparador
--     contacts_enqueue_sales_eval de contacts y su job 'sales_contact_eval'
--     (los nombres quedaron de cuando vivia en Ventas), y las reglas de la
--     bandeja (conversation_assignment_rules).
--
-- Reglas de este archivo:
--   - Nunca CASCADE: cada cosa se borra con su nombre, asi un objeto que
--     dependa de algo borrado hace fallar la poda en vez de irse en silencio.
--   - Todo en una sola transaccion: o se aplica entero, o nada.
--   - Orden: (1) redefinir lo que se queda, (2) sacar disparadores, cron,
--     storage y politicas de los modulos, (3) columnas, (4) funciones atadas a
--     la forma de una tabla del modulo, (5) tablas, (6) el resto de las
--     funciones de los modulos.
--
-- Despues de correrlo: node scripts/plantilla/check-residue.mjs
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Lo que se queda, sin las partes de los modulos
-- ============================================================================

-- 1.1 La lista de permisos del Member de sistema (gemela de MEMBER_PERMISSION_KEYS
-- en lib/auth/permissions.ts): sin las claves de Llamadas, Formularios, Ventas,
-- Pagos, Tareas y Comisiones.
CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage'
  ]::text[]
$function$;

-- 1.2 De donde salio una sesion o un evento de automatizacion: sin el envio de
-- webhook (la columna inbound_webhook_id se borra mas abajo).
CREATE OR REPLACE FUNCTION private.fill_automation_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.source_type IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Sin contacto y con una persona del equipo: la persona. Con contacto: el contacto.
  IF NEW.member_user_id IS NOT NULL AND NEW.contact_id IS NULL THEN
    NEW.source_type := 'member';
    NEW.source_id := NEW.member_user_id::text;
  ELSIF NEW.contact_id IS NOT NULL THEN
    NEW.source_type := 'contact';
    NEW.source_id := NEW.contact_id::text;
  END IF;
  RETURN NEW;
END;
$function$;

-- 1.3 La purga diaria de lo borrado: un contacto borrado se purga siempre (ya
-- no hay ventas que lo retengan).
CREATE OR REPLACE FUNCTION public.purge_soft_deleted(p_retention_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cutoff     timestamptz := now() - make_interval(days => GREATEST(p_retention_days, 0));
  v_contacts   integer := 0;
  v_notes      integer := 0;
  v_convs      integer := 0;
  v_assets     integer := 0;
  v_schedules  integer := 0;
  v_ooo        integer := 0;
  v_events     integer := 0;
BEGIN
  DELETE FROM public.contacts c
   WHERE c.deleted_at IS NOT NULL AND c.deleted_at < v_cutoff;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;

  DELETE FROM public.conversations WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_convs = ROW_COUNT;

  DELETE FROM public.contact_notes WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_notes = ROW_COUNT;

  DELETE FROM public.response_assets WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_assets = ROW_COUNT;

  DELETE FROM public.availability_schedules WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_schedules = ROW_COUNT;

  DELETE FROM public.out_of_office WHERE deleted_at IS NOT NULL AND deleted_at < v_cutoff;
  GET DIAGNOSTICS v_ooo = ROW_COUNT;

  -- Un evento con agendas NO se purga: la agenda guarda su historia y apunta al evento.
  DELETE FROM public.event_types e
   WHERE e.deleted_at IS NOT NULL AND e.deleted_at < v_cutoff
     AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.event_type_id = e.id);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'contacts', v_contacts,
    'conversations', v_convs,
    'contact_notes', v_notes,
    'response_assets', v_assets,
    'availability_schedules', v_schedules,
    'out_of_office', v_ooo,
    'event_types', v_events
  );
END;
$function$;

-- 1.4 La fusion de contactos: igual que en el proyecto, sin mover tareas,
-- respuestas de formularios, firmas, llamadas, envios de webhook ni ventas
-- (esas tablas no existen en la plantilla).
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
  v_n integer;
  v_conv record;
  v_merged_convs uuid[] := '{}';
  v_convs_merged integer := 0;
  v_msgs_moved integer := 0;
  v_msgs_left integer := 0;
  v_notes text;
  v_table text;
  -- El estado de cada rol despues de fusionar, y el ultimo.
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

  -- Toques de atribucion: se mueven todos y la atribucion del principal se recalcula con TODOS (primer y ultimo toque).
  UPDATE public.contact_touches SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_touches', v_n);
  IF v_n > 0 THEN PERFORM private.refresh_contact_attribution(p_main); END IF;

  -- El historial de estados del duplicado pasa al principal (los cambios siguen siendo de quien los hizo).
  UPDATE public.contact_status_changes SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_moved := v_moved || jsonb_build_object('contact_status_changes', v_n);

  -- Lo que solo cambia de dueno (sin indices unicos que dependan del contacto). Las agendas no cambian de estado.
  FOREACH v_table IN ARRAY ARRAY[
    'agent_drafts', 'agent_runs', 'analytics_events', 'bookings', 'broadcast_recipients', 'contact_notes',
    'email_log', 'social_post_comments', 'trigger_fires'
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
    -- Producto de interes: gana el del principal; si no tiene, el del duplicado con SU variante.
    interest_variant_id = CASE WHEN interest_product_id IS NULL THEN v_dup.interest_variant_id ELSE interest_variant_id END,
    interest_product_id = COALESCE(interest_product_id, v_dup.interest_product_id)
   WHERE id = p_main;

  -- El estado de cada rol es el del principal; si no tiene, el del duplicado. El ultimo se recalcula con la misma regla
  -- que `set_contact_status` (el mas reciente; empatados, el del vendedor). Las columnas de estado solo se escriben con
  -- la marca de transaccion (`contacts_status_guard`).
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
$function$;

-- 1.5 La tabla de anuncios contra el CRM. Las tres funciones conservan su firma
-- y las columnas que devuelven (asi la pantalla sigue andando), pero solo saben
-- de leads y agendas: no hay ventas ni pagos que atribuir.
--   - ads_crm_items y ads_crm_cell_detail: metricas leads_new, leads_total y bookings.
--   - ads_crm_metrics_v2: las cuatro columnas de plata y cierres vuelven en NULL
--     (un dato que no existe es NULL, nunca un cero inventado).
CREATE OR REPLACE FUNCTION public.ads_crm_items(p_level text, p_metric text, p_since date, p_until date, p_workspace_id uuid, p_ad_account_id text DEFAULT NULL::text, p_object_id text DEFAULT NULL::text, p_object_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(obj text, contact_id uuid, item_id uuid, occurred_at timestamp with time zone, origin text, detail_at timestamp with time zone, amount_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_acct      text;
  v_filter    text;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings') THEN
    RAISE EXCEPTION 'ads_crm_items: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_items: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- Los objetos de la cuenta: el catálogo Y los insights (con el catálogo vacío, solo el catálogo los dejaba a todos afuera).
  v_acct := format($q$
    WITH acct AS (
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    )
  $q$, v_cat_col, v_cat_table);

  -- Los mismos tres filtros en cada métrica: cuenta, un objeto, o una lista de objetos.
  v_filter := $q$
    ($6::text IS NULL OR x.obj IN (SELECT a.obj FROM acct a))
    AND ($8::text IS NULL OR x.obj = $8)
    AND ($9::text[] IS NULL OR x.obj = ANY($9))
  $q$;

  -- La columna del nivel viene de una lista fija (nunca del pedido): %1$I la cita como identificador, %2$L como texto.
  IF p_metric = 'leads_new' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT c.attribution -> 'first_touch' ->> %2$L AS obj,
                 c.id AS contact_id,
                 nullif(c.attribution -> 'first_touch' ->> 'occurred_at', '')::timestamptz AS occurred_at,
                 c.attribution -> 'first_touch' ->> 'origin' AS origin
            FROM public.contacts c
           WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
             AND c.created_at >= $2 AND c.created_at < $3
             AND c.attribution -> 'first_touch' ->> %2$L IS NOT NULL
        ) x
       WHERE %3$s
    $q$, v_col, v_col, v_filter);

  ELSIF p_metric = 'leads_total' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT DISTINCT ON (t.%1$I, t.contact_id)
                 t.%1$I AS obj, t.contact_id, t.occurred_at, t.origin
            FROM public.contact_touches t
            JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
           WHERE t.workspace_id = $1 AND t.%1$I IS NOT NULL
             AND t.occurred_at >= $2 AND t.occurred_at < $3
           ORDER BY t.%1$I, t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
        ) x
       WHERE %2$s
    $q$, v_col, v_filter);

  ELSE -- bookings
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, x.start_at, NULL::bigint
        FROM (
          SELECT b.id, b.contact_id, b.start_at,
                 coalesce(bt.obj, lt.obj) AS obj,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.occurred_at ELSE lt.occurred_at END AS touch_at,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.origin ELSE lt.origin END AS origin
            FROM public.bookings b
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%1$I IS NOT NULL
               LIMIT 1
            ) bt ON true
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE bt.obj IS NULL
                 AND t.contact_id = b.contact_id AND t.%1$I IS NOT NULL AND t.occurred_at <= b.created_at
               ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
               LIMIT 1
            ) lt ON true
           WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
             AND b.slot_released_at IS NULL
        ) x
       WHERE x.obj IS NOT NULL AND %2$s
    $q$, v_col, v_filter);
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ads_crm_metrics_v2(p_level text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid, p_object_ids text[] DEFAULT NULL::text[])
 RETURNS TABLE(object_id text, is_total boolean, leads_first integer, leads_total integer, leads_with_booking integer, bookings integer, bookings_attended integer, sales integer, revenue_cents bigint, cash_cents bigint, uf_cash_cents bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_metrics_v2: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_metrics_v2: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- Las cuatro ultimas columnas (cierres y plata) vuelven en NULL: en la plantilla no hay de donde sacarlas.
  v_sql := format($q$
    WITH
    acct AS (
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    ),
    new_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_new',   $4, $5, $1, $6, NULL, $8)),
    tot_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_total', $4, $5, $1, $6, NULL, $8)),
    bk_items  AS (
      SELECT i.obj, i.contact_id, b.status_group
        FROM public.ads_crm_items($7, 'bookings', $4, $5, $1, $6, NULL, $8) i
        JOIN public.bookings b ON b.id = i.item_id
    ),
    new_agg  AS (SELECT obj, count(*)::int AS n FROM new_items GROUP BY obj),
    tot_agg  AS (SELECT obj, count(*)::int AS n FROM tot_items GROUP BY obj),
    bk_agg   AS (
      SELECT obj, count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk_items GROUP BY obj
    ),
    objs AS (
      SELECT obj FROM new_agg UNION SELECT obj FROM tot_agg UNION SELECT obj FROM bk_agg
    )
    SELECT o.obj, false,
           coalesce(n.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
      FROM objs o
      LEFT JOIN new_agg n ON n.obj = o.obj
      LEFT JOIN tot_agg tl ON tl.obj = o.obj
      LEFT JOIN bk_agg ba ON ba.obj = o.obj
     WHERE ($6::text IS NULL OR o.obj IN (SELECT a.obj FROM acct a))
       AND ($8::text[] IS NULL OR o.obj = ANY($8))
    UNION ALL
    -- La fila de total: personas DISTINTAS. Lo demas del total lo suma quien llama (es exacto).
    SELECT NULL::text, true,
           NULL::int,
           (SELECT count(DISTINCT contact_id)::int FROM tot_items),
           (SELECT count(DISTINCT contact_id)::int FROM bk_items),
           NULL::int, NULL::int, NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
    ORDER BY 2, 1
  $q$, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_ids;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ads_crm_cell_detail(p_level text, p_metric text, p_since date, p_until date, p_ad_account_id text DEFAULT NULL::text, p_workspace_id uuid DEFAULT NULL::uuid, p_object_id text DEFAULT NULL::text, p_object_ids text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, contact_id uuid, contact_name text, occurred_at timestamp with time zone, origin text, detail_at timestamp with time zone, amount_cents bigint, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings') THEN
    RAISE EXCEPTION 'ads_crm_cell_detail: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;

  -- La lista del TOTAL de «Leads totales» (sin un objeto): una persona que tocó dos anuncios es UNA fila, igual que en el número
  -- (la fila `is_total` de ads_crm_metrics_v2 cuenta personas distintas). En cualquier otra celda, una fila por registro.
  RETURN QUERY
  WITH src AS (
    SELECT i.item_id AS s_item, i.contact_id AS s_contact, i.occurred_at AS s_occurred, i.origin AS s_origin,
           i.detail_at AS s_detail, i.amount_cents AS s_amount,
           CASE WHEN p_metric = 'leads_total' AND p_object_id IS NULL
                THEN row_number() OVER (PARTITION BY i.contact_id ORDER BY i.occurred_at DESC NULLS LAST, i.obj)
                ELSE 1
           END AS rn
      FROM public.ads_crm_items(p_level, p_metric, p_since, p_until, p_workspace_id, p_ad_account_id, p_object_id, p_object_ids) i
  )
  SELECT s.s_item, s.s_contact, c.display_name, s.s_occurred, s.s_origin, s.s_detail, s.s_amount,
         count(*) OVER ()
    FROM src s
    LEFT JOIN public.contacts c ON c.id = s.s_contact
   WHERE s.rn = 1
   ORDER BY s.s_occurred DESC NULLS LAST, s.s_item
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$function$;

-- 1.6 Listas de valores (CHECK) sin los valores de los modulos. Mismo nombre de
-- restriccion que en el proyecto.

-- Disparadores de automatizaciones: sin llamadas, formularios, encuestas,
-- contratos, ventas, pagos, fin de dia, webhooks ni tareas.
ALTER TABLE public.triggers DROP CONSTRAINT triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check
  CHECK (type = ANY (ARRAY[
    'keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event',
    'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated',
    'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created'
  ]::text[]));

-- Origen de una corrida de IA: sin las tareas de Llamadas.
ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_source_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
  CHECK (source = ANY (ARRAY[
    'agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary', 'message_classification',
    'message_classification_eval', 'content_copy', 'ads_analysis', 'audio_transcription', 'media_description'
  ]::text[]));

-- Tareas de IA con instrucciones versionadas: sin las de Llamadas.
ALTER TABLE public.ai_task_prompt_versions DROP CONSTRAINT ai_task_prompt_versions_task_check;
ALTER TABLE public.ai_task_prompt_versions ADD CONSTRAINT ai_task_prompt_versions_task_check
  CHECK (task = ANY (ARRAY[
    'message_classification', 'conversation_summary', 'close_classification', 'media_description', 'ads_analysis'
  ]::text[]));

-- De donde sale una idea de contenido: sin 'call' (la llamada de la que salia).
ALTER TABLE public.content_ideas DROP CONSTRAINT content_ideas_source_check;
ALTER TABLE public.content_ideas ADD CONSTRAINT content_ideas_source_check
  CHECK (source = ANY (ARRAY['manual', 'agent']::text[]));

-- Proveedores OAuth: sin Fathom.
ALTER TABLE public.oauth_connections DROP CONSTRAINT oauth_connections_provider_check;
ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
  CHECK (provider = ANY (ARRAY['google', 'linkedin', 'threads', 'google_calendar']::text[]));

-- Origen de un toque de atribucion: sin 'form' (formulario) ni 'webhook' (webhook entrante).
ALTER TABLE public.contact_touches DROP CONSTRAINT contact_touches_origin_check;
ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_origin_check
  CHECK (origin = ANY (ARRAY['dm', 'comment', 'booking', 'manual', 'import', 'link_click']::text[]));

-- Que disparo una sesion o un evento de automatizacion: contacto, persona, agenda o sistema.
ALTER TABLE public.automation_events DROP CONSTRAINT automation_events_source_type_check;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_source_type_check
  CHECK (source_type IS NULL OR source_type = ANY (ARRAY['contact', 'member', 'booking', 'system']::text[]));
ALTER TABLE public.flow_sessions DROP CONSTRAINT flow_sessions_source_type_check;
ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_source_type_check
  CHECK (source_type IS NULL OR source_type = ANY (ARRAY['contact', 'member', 'booking', 'system']::text[]));

-- Un evento sin contacto tiene que decir de donde salio. Ya no hay eventos de una
-- persona sin contacto (eran los del fin de dia y las tareas).
ALTER TABLE public.automation_events DROP CONSTRAINT automation_events_contact_or_source;
ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_source
  CHECK (contact_id IS NOT NULL OR (member_user_id IS NULL AND source_type IS NOT NULL));

-- Una sesion tiene contacto, persona u origen. Se redefine ANTES de borrar
-- inbound_webhook_id: si no, borrar la columna se llevaria la restriccion entera.
ALTER TABLE public.flow_sessions DROP CONSTRAINT flow_sessions_contact_or_source;
ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_source
  CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL OR source_type IS NOT NULL);

-- 1.7 Politicas que se quedan, sin las claves de los modulos.

-- Instrucciones de las tareas de IA: solo ai_tasks.manage (ya no calls.configure).
ALTER POLICY ai_task_prompt_versions_select ON public.ai_task_prompt_versions
  USING ((SELECT public.has_permission(ai_task_prompt_versions.workspace_id, 'ai_tasks.manage'::text)));
ALTER POLICY ai_task_prompt_versions_insert ON public.ai_task_prompt_versions
  WITH CHECK ((SELECT public.has_permission(ai_task_prompt_versions.workspace_id, 'ai_tasks.manage'::text))
              AND created_by = auth.uid());

-- El historial del catalogo de productos lo ve cualquier miembro (la parte del
-- catalogo de la politica de Ventas, que se borra en el paso 2).
CREATE POLICY audit_log_select_catalog ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id)
         AND entity_type = ANY (ARRAY['product', 'product_variant']::text[]));

-- 1.8 Comentarios que describian valores de los modulos.
COMMENT ON COLUMN public.flow_sessions.source_type IS
  'Que disparo la sesion: contact | member | booking | system. Lo completa fill_automation_source si viene vacio.';
COMMENT ON COLUMN public.flow_sessions.member_user_id IS
  'La persona del equipo de un flujo sin contacto. Una sesion tiene contacto, persona u origen, nunca ninguno.';
COMMENT ON COLUMN public.automation_events.member_user_id IS
  'La persona del equipo de un evento. Sin contacto, un evento tiene que traer su origen (source_type).';
COMMENT ON COLUMN public.audit_log.actor_label IS
  'Nombre legible del actor cuando no es una persona (ej: "Analisis automatico").';
COMMENT ON TABLE public.assignment_rules IS
  'Reglas de asignacion automatica de un contacto: una fila por workspace y kind (setter, vendedor, referido). Arrancan en manual.';
COMMENT ON TABLE public.products IS
  'Catalogo de productos. Un producto no se borra: pasa a inactivo o discontinuado.';
COMMENT ON TABLE public.whatsapp_calls IS
  'Llamadas de WhatsApp recibidas: lo que avisa Evolution por el evento CALL. Se ven en el hilo; no son mensajes.';

-- ============================================================================
-- 2. Disparadores, cron, storage y politicas de los modulos
-- ============================================================================

-- 2.1 Disparadores de los modulos que viven en tablas que se quedan.
DROP TRIGGER tasks_clean_member_refs ON public.workspace_members;
DROP TRIGGER workspaces_commission_settings_guard ON public.workspaces;

-- 2.2 Tareas programadas (pg_cron) de los modulos.
SELECT cron.unschedule(jobname)
  FROM cron.job
 WHERE jobname IN ('fathom-sync', 'payments-overdue-enqueue', 'eod-reminders-enqueue', 'tasks-due-enqueue', 'finance-daily');

-- 2.3 Storage: la politica de los comprobantes de gastos y los cuatro buckets
-- de los modulos (vacios en una base nueva). Supabase no deja borrar filas de
-- storage sin esta marca, que vale solo para esta transaccion.
DROP POLICY expense_receipts_select ON storage.objects;
SET LOCAL storage.allow_delete_query = 'true';
DELETE FROM storage.buckets WHERE id IN ('form-uploads', 'contracts', 'payment-receipts', 'expense-receipts');

-- 2.4 Politicas adicionales del historial (audit_log) de los modulos.
DROP POLICY audit_log_select_calls ON public.audit_log;
DROP POLICY audit_log_select_sales ON public.audit_log;
DROP POLICY audit_log_select_tasks ON public.audit_log;
DROP POLICY audit_log_select_finance ON public.audit_log;
DROP POLICY audit_log_select_commissions ON public.audit_log;

-- 2.5 Politicas de tablas de los modulos que usan funciones atadas a la forma de
-- una fila (paso 4): se sacan antes para poder borrar esas funciones. El resto de
-- las politicas de esas tablas se va con la tabla.
DROP POLICY calls_select ON public.calls;
DROP POLICY commissions_select ON public.commissions;
DROP POLICY form_submissions_select ON public.form_submissions;
DROP POLICY contract_signatures_select ON public.contract_signatures;
DROP POLICY sales_select ON public.sales;
DROP POLICY tasks_select ON public.tasks;
DROP POLICY tasks_update ON public.tasks;

-- ============================================================================
-- 3. Columnas de los modulos en tablas que se quedan
-- ============================================================================
-- Al borrar una columna se van con ella sus indices y su llave foranea.

-- Enlaces a tablas de los modulos.
ALTER TABLE public.content_ideas DROP COLUMN call_id;            -- la llamada de la que salio la idea
ALTER TABLE public.flows DROP COLUMN form_id;                    -- el formulario desde el que se creo el flujo
ALTER TABLE public.flow_sessions DROP COLUMN inbound_webhook_id; -- el envio de webhook que arranco la sesion

-- Contacto: la salud de pago (la calculaban los pagos).
ALTER TABLE public.contacts DROP COLUMN payment_health;

-- Equipo: quien graba llamadas en Fathom y con que correos.
ALTER TABLE public.workspace_members DROP COLUMN is_closer;
ALTER TABLE public.workspace_members DROP COLUMN closer_emails;

-- Conexiones OAuth: la sincronizacion de Fathom y su candado de renovacion.
ALTER TABLE public.oauth_connections DROP COLUMN last_synced_at;
ALTER TABLE public.oauth_connections DROP COLUMN sync_watermark;
ALTER TABLE public.oauth_connections DROP COLUMN sync_cursor;
ALTER TABLE public.oauth_connections DROP COLUMN sync_last_error;
ALTER TABLE public.oauth_connections DROP COLUMN refresh_locked_until;

-- Negocio: ajustes de Ventas, Pagos, Finanzas y Comisiones (con sus CHECK).
ALTER TABLE public.workspaces DROP CONSTRAINT workspaces_enabled_payment_methods_check;
ALTER TABLE public.workspaces DROP CONSTRAINT workspaces_payment_methods_check;
ALTER TABLE public.workspaces DROP CONSTRAINT workspaces_finance_settings_check;
ALTER TABLE public.workspaces DROP CONSTRAINT workspaces_commission_settings_check;
ALTER TABLE public.workspaces DROP COLUMN enabled_payment_methods;
ALTER TABLE public.workspaces DROP COLUMN max_discount_percent;
ALTER TABLE public.workspaces DROP COLUMN overdue_grace_days;
ALTER TABLE public.workspaces DROP COLUMN sales_auto_create_flows;
ALTER TABLE public.workspaces DROP COLUMN payment_methods;
ALTER TABLE public.workspaces DROP COLUMN finance_settings;
ALTER TABLE public.workspaces DROP COLUMN commission_settings;

-- Negocio: tres interruptores que el sistema ya no lee (en el proyecto quedan con el
-- comentario "Sin uso"). El alcance de leads sale del rol (scopes.leads = own,
-- own_unassigned o all) y los mensajes entrantes se guardan siempre. Ninguna funcion
-- ni politica los nombra; en el codigo, solo los tipos y dos scripts de verificacion,
-- marcados para la plantilla.
ALTER TABLE public.workspaces DROP COLUMN lead_scope_enabled;
ALTER TABLE public.workspaces DROP COLUMN unassigned_leads_visible_to_members;
ALTER TABLE public.workspaces DROP COLUMN persist_zernio_inbound;

-- Indices de tablas que se quedan que solo servian a los modulos.
DROP INDEX public.idx_analytics_forms;         -- eventos de vista y envio de formularios
DROP INDEX public.idx_scheduled_jobs_payment;  -- jobs de un pago

-- ============================================================================
-- 4. Funciones atadas a la forma de una fila de una tabla de los modulos
-- ============================================================================
-- Reciben una fila (o una regla) de esas tablas: hay que borrarlas antes que las tablas.
DROP FUNCTION public.can_see_call(c public.calls);
DROP FUNCTION public.can_see_commission(c public.commissions);
DROP FUNCTION public.can_see_form_submission(s public.form_submissions);
DROP FUNCTION public.can_see_sale(s public.sales);
DROP FUNCTION public.can_see_task(t public.tasks);
DROP FUNCTION public.payments_event_payload(p public.payments);
DROP FUNCTION public.sales_event_payload(s public.sales);
DROP FUNCTION public.commission_amount_cents(p_rule public.commission_rules, p_facts jsonb);
DROP FUNCTION public.commission_base_cents(p_rule public.commission_rules, p_facts jsonb);
DROP FUNCTION public.commission_payee(p_role jsonb, p_rule public.commission_rules, p_facts jsonb);
DROP FUNCTION public.commission_rule_matches(p_rule public.commission_rules, p_facts jsonb, p_payee text);
DROP FUNCTION private.commission_failed_dimension(p_rule public.commission_rules, p_facts jsonb, p_payee text);

-- ============================================================================
-- 5. Las tablas de los modulos
-- ============================================================================
-- En una sola orden: asi las llaves foraneas entre ellas (por ejemplo formularios
-- y sus versiones, que se apuntan mutuamente) no obligan a un orden. Sus
-- disparadores, politicas, indices y permisos se van con ellas.
DROP TABLE
  public.calls,
  public.forms,
  public.form_versions,
  public.form_submissions,
  public.contract_signatures,
  public.eod_reports,
  public.sales,
  public.payments,
  public.tasks,
  public.expenses,
  public.recurring_expenses,
  public.vendors,
  public.commissions,
  public.commission_rules,
  public.webhook_endpoints,
  public.inbound_webhooks;

-- ============================================================================
-- 6. El resto de las funciones de los modulos
-- ============================================================================

-- Llamadas (Fathom).
DROP FUNCTION public.calls_protect_analysis_ai();
DROP FUNCTION public.can_see_call_id(p_call_id uuid);
DROP FUNCTION private.enqueue_fathom_sync();
DROP FUNCTION public.set_ai_background_task_settings(p_workspace_id uuid, p_task text, p_value jsonb); -- solo la usaban las tareas de Llamadas
DROP FUNCTION public.claim_oauth_refresh(p_connection_id uuid, p_seconds integer);                   -- candado del token de Fathom
DROP FUNCTION public.release_oauth_refresh(p_connection_id uuid);

-- Formularios, encuestas, contratos y fin de dia.
DROP FUNCTION public.can_view_forms(p_workspace_id uuid);
DROP FUNCTION public.can_view_eod_all(p_workspace_id uuid);
DROP FUNCTION public.get_public_form(p_slug text);
DROP FUNCTION public.publish_form_version(p_form_id uuid, p_actor uuid);
DROP FUNCTION public.form_metrics_daily(p_form_id uuid, p_from date, p_to date);
DROP FUNCTION public.form_versions_protect_published();
DROP FUNCTION public.submit_form_response(p_form_id uuid, p_version_id uuid, p_idempotency_key uuid, p_answers jsonb, p_attribution jsonb, p_meta jsonb, p_contact_hint jsonb, p_extra jsonb);
DROP FUNCTION public.find_contact_for_form(p_workspace_id uuid, p_phone text, p_email text, p_social jsonb);
DROP FUNCTION public.record_contract_signature(p_submission_id uuid, p_signature_path text, p_legal jsonb, p_signer_name text, p_signer_email text);
DROP FUNCTION public.contract_render_matches(p_template text, p_rendered text);
DROP FUNCTION public.contract_signatures_protect_evidence();
DROP FUNCTION public.save_eod_draft(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_answers jsonb, p_channels jsonb, p_report_mode text);
DROP FUNCTION public.submit_eod_report(p_workspace_id uuid, p_form_id uuid, p_user_id uuid, p_report_date date, p_rev integer, p_form_version_id uuid, p_answers jsonb, p_channels jsonb, p_metrics jsonb, p_report_mode text, p_audit_changes jsonb);
DROP FUNCTION private.enqueue_eod_reminders();

-- Ventas y pagos.
DROP FUNCTION public.can_see_sale_id(p_sale_id uuid);
DROP FUNCTION public.create_sale(p_payload jsonb, p_actor_id uuid);
DROP FUNCTION public.cancel_sale(p_sale_id uuid, p_reason text, p_actor_id uuid);
DROP FUNCTION public.refresh_sale_status(p_sale_id uuid, p_change_id uuid);
DROP FUNCTION public.derive_sale_status(p_current_status text, p_financing_type text, p_final_amount numeric, p_payments jsonb);
DROP FUNCTION public.sales_emit_status_change();
DROP FUNCTION public.emit_sales_event(p_workspace_id uuid, p_event_type text, p_contact_id uuid, p_payload jsonb);
DROP FUNCTION public.sale_attribution_from_touch(t public.contact_touches);
DROP FUNCTION public.find_contact_by_phone_or_email(p_workspace_id uuid, p_phone text, p_email text); -- solo la usaba Ventas
DROP FUNCTION public.payments_emit_events();
DROP FUNCTION public.payments_protect_original_due_date();
DROP FUNCTION public.payments_refresh_sale_status();
DROP FUNCTION public.workspace_payment_method(p_workspace uuid, p_key text);
DROP FUNCTION private.payments_fee_spec_from_snapshot();
DROP FUNCTION private.payments_validate_method();
DROP FUNCTION private.payments_mark_customer(); -- el cliente se marca a mano (sin Ventas no hay cobros)
DROP FUNCTION private.enqueue_payments_overdue_sweep();
DROP FUNCTION public.ads_crm_metrics(p_level text, p_since date, p_until date, p_ad_account_id text, p_workspace_id uuid); -- version 1, reemplazada por la v2

-- Tareas.
DROP FUNCTION public.can_see_task_id(p_task_id uuid);
DROP FUNCTION public.can_view_tasks(p_workspace_id uuid);
DROP FUNCTION public.can_edit_tasks(p_workspace_id uuid);
DROP FUNCTION public.can_delete_tasks(p_workspace_id uuid);
DROP FUNCTION public.delete_task(p_task_id uuid);
DROP FUNCTION public.set_task_blockers(p_task_id uuid, p_blockers jsonb);
DROP FUNCTION public.task_shift_context(p_task_id uuid);
DROP FUNCTION public.complete_task_with_shifts(p_task_id uuid, p_shifts jsonb, p_expected jsonb);
DROP FUNCTION public.tasks_before_write();
DROP FUNCTION public.tasks_clean_member_refs();
DROP FUNCTION private.enqueue_tasks_due_sweep();

-- Finanzas (gastos, gastos que se repiten, proveedores).
DROP FUNCTION public.upsert_auto_expense(p_workspace uuid, p_auto_key text, p_origin text, p_total_cents bigint, p_concept text, p_month text, p_vendor_id uuid, p_category_key text, p_charge_mode text, p_source_ref jsonb, p_today date);
DROP FUNCTION public.decide_auto_expense_action(p_existing jsonb, p_total_cents bigint, p_ctx jsonb);
DROP FUNCTION public.mark_expenses_overdue(p_workspace_id uuid, p_today date);
DROP FUNCTION private.expenses_guard();
DROP FUNCTION private.expenses_validate_category();
DROP FUNCTION private.expenses_release_commissions();
DROP FUNCTION private.enqueue_finance_daily(p_now timestamp with time zone);

-- Comisiones.
DROP FUNCTION public.commission_facts(p_payment_id uuid);
DROP FUNCTION public.commission_content_owner(p_social_post_id uuid, p_content_post_id uuid, p_workspace uuid);
DROP FUNCTION public.commission_pick_rule(p_workspace uuid, p_facts jsonb, p_role text);
DROP FUNCTION public.generate_commissions_for_payment(p_payment_id uuid);
DROP FUNCTION public.revert_commissions_for_payment(p_payment_id uuid);
DROP FUNCTION public.create_commission_payout(p_workspace uuid, p_commission_ids uuid[], p_mode text, p_scheduled_date date, p_concepts jsonb, p_notes text, p_actor uuid, p_today date);
DROP FUNCTION private.commission_role_valid(p_workspace_id uuid, p_role text, p_require_active boolean);
DROP FUNCTION private.commission_rules_validate();
DROP FUNCTION private.commission_settings_guard();
DROP FUNCTION private.commissions_guard();
DROP FUNCTION private.commissions_validate();
DROP FUNCTION private.enqueue_commissions_for_payment();
DROP FUNCTION private.cm_audit(p_workspace uuid, p_entity text, p_entity_id uuid, p_action text, p_changes jsonb, p_metadata jsonb, p_actor uuid);
DROP FUNCTION private.cm_in_list(p_values text[], p_actual text);
DROP FUNCTION private.cm_list(p_json jsonb);
DROP FUNCTION private.cm_norm(p_value text);
DROP FUNCTION private.cm_sale_person(p_payee text, p_facts jsonb);

-- Webhooks entrantes.
DROP FUNCTION public.receive_inbound_webhook(p_row jsonb, p_duplicate_window_seconds integer);

COMMIT;
