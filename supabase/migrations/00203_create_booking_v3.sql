-- ============================================================================
-- 00203 — create_booking v3: la agenda sobre la regla central (C2)
-- ============================================================================
-- Parte de la definicion VIVA (la 00190; el md5 esta abajo), misma firma (25 parametros). Cambia SOLO el
-- paso "a. El contacto":
--   * busca y crea con `find_or_create_contact` (bloqueo por dato; antes la busqueda y el INSERT no
--     tenian ninguno);
--   * el telefono se normaliza con `normalize_phone`; el email, con `normalize_email` en los dos lados
--     (antes el lado guardado no se recortaba);
--   * una reserva SIN email ni telefono se rechaza (SQLSTATE CB001): antes creaba un contacto con solo
--     el nombre. `createBooking` lo traduce a un mensaje claro;
--   * al completar vacios de un contacto que ya existia, un telefono o email que es de OTRO contacto
--     no se escribe.
-- Todo lo demas (asignacion, la agenda, el toque de atribucion, el historial, el evento, los jobs) es la
-- definicion vigente letra por letra. `booker_phone` sigue guardando lo que escribio la persona.
-- Como volver atras: pegar la definicion de abajo (CREATE OR REPLACE).
--
-- DEFINICIONES VIGENTES ANTES DE ESTA MIGRACION (copiadas de la base con pg_get_functiondef).
-- Para volver atras: pegar la que corresponda (CREATE OR REPLACE).
--
-- ==== create_booking (md5 57b486fed13f20a0db3af410d1aa91ac) ====
-- CREATE OR REPLACE FUNCTION public.create_booking(p_workspace_id uuid, p_event_type_id uuid, p_host_user_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_title text, p_name text, p_email text, p_phone text, p_timezone text, p_host_timezone text, p_location_type text, p_location_text text, p_responses jsonb, p_origin text, p_utm jsonb, p_referrer_url text, p_uid text, p_category_id uuid, p_category_snapshot jsonb, p_contact_assignment text, p_created_by uuid DEFAULT NULL::uuid, p_contact_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_landing_page text DEFAULT NULL::text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_contact_id   uuid := p_contact_id;
--   v_created      boolean := false;
--   v_booking_id   uuid;
--   v_email        text := nullif(btrim(lower(p_email)), '');
--   v_phone        text := nullif(btrim(p_phone), '');
--   v_dnc          boolean := false;
--   v_setter       uuid;
--   v_vendedor     uuid;
--   v_assigned     boolean := false;
-- BEGIN
--   -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
--   PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));
--
--   -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
--   IF v_contact_id IS NULL THEN
--     IF v_phone IS NOT NULL THEN
--       SELECT id INTO v_contact_id FROM public.contacts
--       WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
--         AND (phone = v_phone OR whatsapp_phone = v_phone)
--       ORDER BY created_at ASC LIMIT 1;
--     END IF;
--
--     IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
--       SELECT id INTO v_contact_id FROM public.contacts
--       WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
--         AND (lower(email) = v_email OR lower(secondary_email) = v_email)
--       ORDER BY created_at ASC LIMIT 1;
--     END IF;
--
--     IF v_contact_id IS NULL THEN
--       INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
--       VALUES (
--         p_workspace_id,
--         nullif(btrim(p_name), ''),
--         v_email,
--         v_phone,
--         nullif(p_timezone, ''),
--         coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
--         now()
--       )
--       RETURNING id INTO v_contact_id;
--       v_created := true;
--     END IF;
--   END IF;
--
--   -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
--   IF NOT v_created THEN
--     UPDATE public.contacts
--     SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
--         email        = coalesce(email, v_email),
--         phone        = coalesce(phone, v_phone),
--         timezone     = coalesce(timezone, nullif(p_timezone, '')),
--         last_interaction_at = now()
--     WHERE id = v_contact_id;
--   END IF;
--
--   SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
--   FROM public.contacts WHERE id = v_contact_id;
--
--   -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
--   -- trigger de la 00039, que emite assignment_changed en automation_events.
--   IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
--     UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
--     v_assigned := true;
--   ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
--     UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
--     v_assigned := true;
--   END IF;
--
--   -- c. La agenda.
--   INSERT INTO public.bookings (
--     workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
--     host_user_id, contact_id, title, start_at, end_at, status,
--     booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
--     location_type, location_text, responses, origin, utm, referrer_url,
--     created_by, is_do_not_contact_at_booking, google_sync_status
--   ) VALUES (
--     p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
--     p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
--     nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
--     p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
--     coalesce(p_utm, '{}'::jsonb), p_referrer_url,
--     p_created_by, coalesce(v_dnc, false), 'pending'
--   )
--   RETURNING id INTO v_booking_id;
--
--   -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el
--   -- contacto nuevo Y para el que ya existia: una reserva es una interaccion
--   -- mas de esa persona. NO se registra para 'manual' ni 'agent': ahi no hay
--   -- forma de saber de donde vino el lead, y un toque `web/booking` inventado
--   -- pisaria el toque real (el DM o el comentario que lo trajo).
--   -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
--   IF p_origin NOT IN ('manual', 'agent') THEN
--     BEGIN
--       PERFORM public.record_contact_touch(
--         p_workspace_id,
--         v_contact_id,
--         jsonb_build_object(
--           'occurred_at',  now(),
--           'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
--           'medium',       'booking',
--           'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
--           'content',      nullif(btrim(p_utm->>'utm_content'), ''),
--           'term',         nullif(btrim(p_utm->>'utm_term'), ''),
--           'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
--           'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
--           'ttclid',       nullif(btrim(p_utm->>'ttclid'), ''),
--           'li_fat_id',    nullif(btrim(p_utm->>'li_fat_id'), ''),
--           'ad_id',        nullif(btrim(p_utm->>'ad_id'), ''),
--           'adset_id',     nullif(btrim(p_utm->>'adset_id'), ''),
--           'campaign_id',  nullif(btrim(p_utm->>'campaign_id'), ''),
--           'referrer_url', nullif(btrim(p_referrer_url), ''),
--           'landing_page', nullif(btrim(p_landing_page), ''),
--           'origin',       'booking',
--           'dedupe_key',   'booking:' || v_booking_id::text,
--           'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
--                           || jsonb_strip_nulls(jsonb_build_object(
--                                'utm_id',       nullif(btrim(p_utm->>'utm_id'), ''),
--                                'placement',    nullif(btrim(p_utm->>'placement'), ''),
--                                'fbp',          nullif(btrim(p_utm->>'fbp'), ''),
--                                'fbc',          nullif(btrim(p_utm->>'fbc'), ''),
--                                'ga_client_id', nullif(btrim(p_utm->>'ga_client_id'), ''),
--                                'first_visit',  CASE WHEN jsonb_typeof(p_utm->'first_visit') = 'object' THEN p_utm->'first_visit' END))
--         )
--       );
--     EXCEPTION WHEN OTHERS THEN
--       RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
--     END;
--   END IF;
--
--   -- d. El historial.
--   INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--   VALUES (
--     p_workspace_id, 'booking', v_booking_id, 'booking.created',
--     jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
--     jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
--     p_created_by
--   );
--
--   -- e. El evento de automatizacion.
--   INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
--   VALUES (
--     p_workspace_id, 'booking_created', v_contact_id,
--     jsonb_build_object(
--       'booking_id', v_booking_id,
--       'event_type_id', p_event_type_id,
--       'host_user_id', p_host_user_id,
--       'origin', p_origin
--     )
--   );
--
--   -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
--   INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
--   VALUES (
--     'booking_google_sync',
--     jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
--     now(), 'pending'
--   );
--   INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
--   VALUES (
--     'booking_ended',
--     jsonb_build_object('booking_id', v_booking_id),
--     p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
--   );
--
--   RETURN jsonb_build_object(
--     'booking_id', v_booking_id,
--     'contact_id', v_contact_id,
--     'created_contact', v_created,
--     'assignment_changed', v_assigned,
--     'do_not_contact', coalesce(v_dnc, false)
--   );
-- END;
-- $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_booking(p_workspace_id uuid, p_event_type_id uuid, p_host_user_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_title text, p_name text, p_email text, p_phone text, p_timezone text, p_host_timezone text, p_location_type text, p_location_text text, p_responses jsonb, p_origin text, p_utm jsonb, p_referrer_url text, p_uid text, p_category_id uuid, p_category_snapshot jsonb, p_contact_assignment text, p_created_by uuid DEFAULT NULL::uuid, p_contact_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_landing_page text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := public.normalize_email(p_email);
  v_phone        text := nullif(btrim(p_phone), '');
  v_nphone       text := public.normalize_phone(p_phone);
  v_central      jsonb;
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual. Si no, la regla central
  -- (C2, 00200): busca por telefono y email y, si no esta, lo crea, con bloqueo por dato (dos reservas
  -- simultaneas de la misma persona dan UN contacto). Sin email ni telefono NO se crea nada: la reserva
  -- se rechaza con el codigo CB001 (createBooking lo traduce a "Necesitamos un email o un telefono").
  IF v_contact_id IS NULL THEN
    v_central := public.find_or_create_contact(
      p_workspace_id,
      jsonb_build_object('phone', p_phone, 'email', p_email),
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', nullif(btrim(p_name), ''),
        'timezone', nullif(p_timezone, ''),
        'attribution', coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        'last_interaction_at', now()
      )),
      'create'
    );
    IF v_central ->> 'status' = 'no_identity' THEN
      RAISE EXCEPTION 'Necesitamos un email o un telefono para agendar' USING ERRCODE = 'CB001';
    END IF;
    v_contact_id := (v_central ->> 'contact_id')::uuid;
    v_created := (v_central ->> 'created')::boolean;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay. Un telefono o email que ya es de OTRO
  -- contacto no se escribe en este.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = CASE WHEN private.contact_value_taken(p_workspace_id, v_contact_id, 'email', v_email) THEN email ELSE coalesce(email, v_email) END,
        phone        = CASE WHEN private.contact_value_taken(p_workspace_id, v_contact_id, 'phone', v_nphone) THEN phone ELSE coalesce(phone, v_nphone) END,
        timezone     = coalesce(timezone, nullif(p_timezone, '')),
        last_interaction_at = now()
    WHERE id = v_contact_id;
  END IF;

  SELECT do_not_contact, setter_id, vendedor_id INTO v_dnc, v_setter, v_vendedor
  FROM public.contacts WHERE id = v_contact_id;

  -- b. La asignacion (F22): solo si el campo esta vacio. El UPDATE dispara el
  -- trigger de la 00039, que emite assignment_changed en automation_events.
  IF p_contact_assignment = 'setter_if_empty' AND v_setter IS NULL THEN
    UPDATE public.contacts SET setter_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  ELSIF p_contact_assignment = 'vendedor_if_empty' AND v_vendedor IS NULL THEN
    UPDATE public.contacts SET vendedor_id = p_host_user_id WHERE id = v_contact_id;
    v_assigned := true;
  END IF;

  -- c. La agenda.
  INSERT INTO public.bookings (
    workspace_id, uid, event_type_id, category_id, category_snapshot, metadata,
    host_user_id, contact_id, title, start_at, end_at, status,
    booker_name, booker_email, booker_phone, booker_timezone, host_timezone,
    location_type, location_text, responses, origin, utm, referrer_url,
    created_by, is_do_not_contact_at_booking, google_sync_status
  ) VALUES (
    p_workspace_id, p_uid, p_event_type_id, p_category_id, p_category_snapshot, coalesce(p_metadata, '{}'::jsonb),
    p_host_user_id, v_contact_id, p_title, p_start_at, p_end_at, 'scheduled',
    nullif(btrim(p_name), ''), v_email, v_phone, nullif(p_timezone, ''), nullif(p_host_timezone, ''),
    p_location_type, p_location_text, coalesce(p_responses, '{}'::jsonb), p_origin,
    coalesce(p_utm, '{}'::jsonb), p_referrer_url,
    p_created_by, coalesce(v_dnc, false), 'pending'
  )
  RETURNING id INTO v_booking_id;

  -- c2. El toque de atribucion (Contenido v3, F87; Agenda v2). Vale para el
  -- contacto nuevo Y para el que ya existia: una reserva es una interaccion
  -- mas de esa persona. NO se registra para 'manual' ni 'agent': ahi no hay
  -- forma de saber de donde vino el lead, y un toque `web/booking` inventado
  -- pisaria el toque real (el DM o el comentario que lo trajo).
  -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
  IF p_origin NOT IN ('manual', 'agent') THEN
    BEGIN
      PERFORM public.record_contact_touch(
        p_workspace_id,
        v_contact_id,
        jsonb_build_object(
          'occurred_at',  now(),
          'source',       coalesce(nullif(lower(btrim(p_utm->>'utm_source')), ''), 'web'),
          'medium',       'booking',
          'campaign',     nullif(btrim(p_utm->>'utm_campaign'), ''),
          'content',      nullif(btrim(p_utm->>'utm_content'), ''),
          'term',         nullif(btrim(p_utm->>'utm_term'), ''),
          'fbclid',       nullif(btrim(p_utm->>'fbclid'), ''),
          'gclid',        nullif(btrim(p_utm->>'gclid'), ''),
          'ttclid',       nullif(btrim(p_utm->>'ttclid'), ''),
          'li_fat_id',    nullif(btrim(p_utm->>'li_fat_id'), ''),
          'ad_id',        nullif(btrim(p_utm->>'ad_id'), ''),
          'adset_id',     nullif(btrim(p_utm->>'adset_id'), ''),
          'campaign_id',  nullif(btrim(p_utm->>'campaign_id'), ''),
          'referrer_url', nullif(btrim(p_referrer_url), ''),
          'landing_page', nullif(btrim(p_landing_page), ''),
          'origin',       'booking',
          'dedupe_key',   'booking:' || v_booking_id::text,
          'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
                          || jsonb_strip_nulls(jsonb_build_object(
                               'utm_id',       nullif(btrim(p_utm->>'utm_id'), ''),
                               'placement',    nullif(btrim(p_utm->>'placement'), ''),
                               'fbp',          nullif(btrim(p_utm->>'fbp'), ''),
                               'fbc',          nullif(btrim(p_utm->>'fbc'), ''),
                               'ga_client_id', nullif(btrim(p_utm->>'ga_client_id'), ''),
                               'first_visit',  CASE WHEN jsonb_typeof(p_utm->'first_visit') = 'object' THEN p_utm->'first_visit' END))
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
    END;
  END IF;

  -- d. El historial.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    p_workspace_id, 'booking', v_booking_id, 'booking.created',
    jsonb_build_object('start_at', p_start_at, 'end_at', p_end_at),
    jsonb_build_object('origin', p_origin, 'actor_type', CASE WHEN p_created_by IS NULL THEN 'invitee' ELSE 'user' END),
    p_created_by
  );

  -- e. El evento de automatizacion.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (
    p_workspace_id, 'booking_created', v_contact_id,
    jsonb_build_object(
      'booking_id', v_booking_id,
      'event_type_id', p_event_type_id,
      'host_user_id', p_host_user_id,
      'origin', p_origin
    )
  );

  -- f. Los jobs: crear el evento en Google y avisar cuando la agenda termine.
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status)
  VALUES (
    'booking_google_sync',
    jsonb_build_object('booking_id', v_booking_id, 'action', 'create', 'attempt', 0),
    now(), 'pending'
  );
  INSERT INTO public.scheduled_jobs (type, payload, run_at, status, dedupe_key)
  VALUES (
    'booking_ended',
    jsonb_build_object('booking_id', v_booking_id),
    p_end_at, 'pending', 'ended:' || v_booking_id::text || ':0'
  );

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'contact_id', v_contact_id,
    'created_contact', v_created,
    'assignment_changed', v_assigned,
    'do_not_contact', coalesce(v_dnc, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb, text) TO service_role;
