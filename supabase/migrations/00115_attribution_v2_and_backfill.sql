-- 00115: atribucion v2 y el backfill de los contactos existentes (Contenido v3,
-- B11: F84, F87).
--
-- Aditiva con backfill. Escribe SOLO donde `contacts.attribution` esta vacio:
-- nunca pisa un valor. Idempotente: correrla dos veces no duplica toques.
--
-- 1. `create_booking` es la de la 00099 LETRA POR LETRA, con un unico agregado:
--    despues de crear la reserva registra el toque (medium `booking`). El resto
--    de la funcion, incluida la atribucion plana del contacto nuevo, no cambia:
--    esa plana es la que lee el trigger de alta y sigue diciendo 'scheduling'.
--    La definicion anterior esta completa en `00099_bookings.sql` por si hace
--    falta volver atras.
-- 2. Los dos triggers de la 00039 leen `first_touch.source` con respaldo en la
--    clave plana `source`, asi un contacto viejo emite lo mismo que antes.
-- 3. Backfill: un toque por cada evento `contact_created`, con la fuente que
--    tenia el evento o, si no la traia, la del canal de la primera conversacion.

-- ---------------------------------------------------------------------------
-- 1. create_booking: la de la 00099 + el toque
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_booking(
  p_workspace_id   uuid,
  p_event_type_id  uuid,
  p_host_user_id   uuid,
  p_start_at       timestamptz,
  p_end_at         timestamptz,
  p_title          text,
  p_name           text,
  p_email          text,
  p_phone          text,
  p_timezone       text,
  p_host_timezone  text,
  p_location_type  text,
  p_location_text  text,
  p_responses      jsonb,
  p_origin         text,
  p_utm            jsonb,
  p_referrer_url   text,
  p_uid            text,
  p_category_id    uuid,
  p_category_snapshot jsonb,
  p_contact_assignment text,
  p_created_by     uuid DEFAULT NULL,
  p_contact_id     uuid DEFAULT NULL,
  p_metadata       jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id   uuid := p_contact_id;
  v_created      boolean := false;
  v_booking_id   uuid;
  v_email        text := nullif(btrim(lower(p_email)), '');
  v_phone        text := nullif(btrim(p_phone), '');
  v_dnc          boolean := false;
  v_setter       uuid;
  v_vendedor     uuid;
  v_assigned     boolean := false;
BEGIN
  -- Serializa los pedidos del mismo anfitrion dentro de la transaccion.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_host_user_id::text, 0));

  -- a. El contacto. Si viene dado (agendar manual, agente), se usa tal cual.
  IF v_contact_id IS NULL THEN
    IF v_phone IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (phone = v_phone OR whatsapp_phone = v_phone)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL AND v_email IS NOT NULL THEN
      SELECT id INTO v_contact_id FROM public.contacts
      WHERE workspace_id = p_workspace_id AND deleted_at IS NULL
        AND (lower(email) = v_email OR lower(secondary_email) = v_email)
      ORDER BY created_at ASC LIMIT 1;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (workspace_id, display_name, email, phone, timezone, attribution, last_interaction_at)
      VALUES (
        p_workspace_id,
        nullif(btrim(p_name), ''),
        v_email,
        v_phone,
        nullif(p_timezone, ''),
        coalesce(p_utm, '{}'::jsonb) || jsonb_build_object('source', 'scheduling', 'referrer', p_referrer_url),
        now()
      )
      RETURNING id INTO v_contact_id;
      v_created := true;
    END IF;
  END IF;

  -- Completa SOLO los campos vacios: nunca pisa lo que ya hay.
  IF NOT v_created THEN
    UPDATE public.contacts
    SET display_name = coalesce(display_name, nullif(btrim(p_name), '')),
        email        = coalesce(email, v_email),
        phone        = coalesce(phone, v_phone),
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

  -- c2. El toque de atribucion (Contenido v3, F87). Vale para el contacto nuevo
  -- Y para el que ya existia: una reserva es una interaccion mas de esa persona.
  -- Va protegido: una falla de atribucion NUNCA puede impedir una reserva.
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
        'referrer_url', nullif(btrim(p_referrer_url), ''),
        'origin',       'booking',
        'dedupe_key',   'booking:' || v_booking_id::text,
        'raw',          jsonb_build_object('utm', coalesce(p_utm, '{}'::jsonb), 'booking_origin', p_origin)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'create_booking: no pude registrar el toque de atribucion: %', SQLERRM;
  END;

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
$$;

REVOKE ALL ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, text, text, text, text, jsonb, text, jsonb, text, text, uuid, jsonb, text, uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Los triggers de alta leen la forma canonica, con respaldo en la plana
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contacts_emit_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_automation_event(
    NEW.workspace_id,
    'contact_created',
    NEW.id,
    jsonb_build_object(
      'source',
      COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown')
    )
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.contacts_emit_deanonymized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(OLD.is_anonymous, false) AND NOT COALESCE(NEW.is_anonymous, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id,
      'contact_created',
      NEW.id,
      jsonb_build_object(
        'source',
        COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown'),
        'deanonymized', true
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Backfill desde los eventos de alta
-- ---------------------------------------------------------------------------
-- Un toque por contacto vivo con evento `contact_created`. La fuente sale del
-- evento (`metadata.platform`) y, si el evento no la traia, del canal de la
-- primera conversacion. Si no se puede saber, NO se inventa: el contacto queda
-- sin toque.
INSERT INTO public.contact_touches (
  workspace_id, contact_id, occurred_at, source, medium, origin, dedupe_key, raw
)
SELECT
  e.workspace_id,
  e.contact_id,
  e.created_at,
  src.platform,
  'dm',
  'dm',
  'event:' || e.id::text,
  jsonb_build_object('backfill', true, 'event_id', e.id)
FROM public.analytics_events e
JOIN public.contacts c
  ON c.id = e.contact_id AND c.workspace_id = e.workspace_id AND c.deleted_at IS NULL
CROSS JOIN LATERAL (
  SELECT lower(nullif(btrim(coalesce(
    e.metadata->>'platform',
    (SELECT ch.platform
       FROM public.conversations cv
       JOIN public.channels ch ON ch.id = cv.channel_id
      WHERE cv.contact_id = e.contact_id
      ORDER BY cv.created_at ASC
      LIMIT 1)
  )), '')) AS platform
) src
WHERE e.event_type = 'contact_created'
  AND src.platform IS NOT NULL
ON CONFLICT (workspace_id, dedupe_key) DO NOTHING;

-- La copia derivada, SOLO donde la atribucion esta vacia.
WITH first_touch AS (
  SELECT DISTINCT ON (t.contact_id) t.contact_id, public.contact_touch_json(t) AS j
  FROM public.contact_touches t
  ORDER BY t.contact_id, t.occurred_at ASC, t.created_at ASC, t.id ASC
), last_touch AS (
  SELECT DISTINCT ON (t.contact_id) t.contact_id, public.contact_touch_json(t) AS j
  FROM public.contact_touches t
  ORDER BY t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
)
UPDATE public.contacts c
SET attribution = jsonb_build_object('version', 2, 'first_touch', f.j, 'last_touch', l.j)
FROM first_touch f
JOIN last_touch l USING (contact_id)
WHERE c.id = f.contact_id
  AND c.attribution = '{}'::jsonb;
