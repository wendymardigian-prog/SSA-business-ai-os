-- ============================================================
-- 00278_email_not_subscribed.sql
--
-- Suscripcion a emails: un quinto estado, 'not_subscribed' ("Sin suscribir"), para
-- la persona que dejo un formulario SIN marcar la casilla de emails de marketing.
--
-- Que cambia:
--   1. CHECK de contacts.email_status: suma 'not_subscribed'.
--   2. CHECK de email_log.status: suma 'skipped_not_subscribed' (un marketing que no
--      salio porque la persona no acepto).
--   3. private.email_status_rank: la gravedad pasa a
--      complained 5 > bounced 4 > unsubscribed 3 > not_subscribed 2 > subscribed 1.
--      "El peor estado de una direccion", la herencia y la fusion lo ordenan solos.
--   4. private.email_status_decide: un modo nuevo, 'consent' (la casilla MARCADA de un
--      formulario), que solo saca de 'not_subscribed' a 'subscribed'. Los otros tres
--      modos no cambian: 'system' solo empeora (puede poner not_subscribed sobre
--      subscribed, nunca sobre una baja), 'person' y 'admin' como siempre.
--   5. private.email_status_apply: acepta el modo 'consent' (es la UNICA linea que cambia).
--   6. private.email_pause_enrollments: tambien pausa con 'not_subscribed'
--      (paused_reason 'email_not_subscribed'; la columna no tiene CHECK).
--
-- Quien pone 'not_subscribed': el envio de un formulario con la pregunta mapeada a
-- "Suscripcion a emails de marketing", SOLO si la respuesta CREO el contacto y la casilla
-- vino sin marcar (lib/forms/submit.ts, despues de guardar). Un contacto que ya existia
-- no se toca. Gemelas TypeScript en lib/email/subscription.ts, con los casos de
-- lib/email/subscription-transitions.cases.json.
--
-- La guardia (contacts_email_status_guard) no cambia: una fila nueva sigue naciendo
-- 'subscribed'. submit_form_response (protegida) no se toca.
--
-- Aditiva en datos (no cambia ninguna fila). Se aplica ANTES de desplegar el codigo
-- (el codigo escribe el estado nuevo).
--
-- Definiciones vigentes ANTES de esta migracion (leidas de la base el 2/11/2026,
-- iguales a la 00271; md5 de pg_get_functiondef: rank 7f23e632…, decide bcb76d29…,
-- apply 4202ba8d…, pause 93241439…), letra por letra, para volver atras:
--
--   CREATE OR REPLACE FUNCTION private.email_status_rank(p_status text)
--    RETURNS integer
--    LANGUAGE sql
--    IMMUTABLE
--    SET search_path TO ''
--   AS $function$
--     SELECT CASE p_status
--       WHEN 'complained' THEN 4
--       WHEN 'bounced' THEN 3
--       WHEN 'unsubscribed' THEN 2
--       WHEN 'subscribed' THEN 1
--       ELSE 0
--     END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION private.email_status_decide(p_from text, p_to text, p_mode text, p_reason text)
--    RETURNS text
--    LANGUAGE plpgsql
--    IMMUTABLE
--    SET search_path TO ''
--   AS $function$
--   BEGIN
--     IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin') THEN RETURN 'invalid'; END IF;
--     IF private.email_status_rank(p_to) = 0 OR private.email_status_rank(p_from) = 0 THEN RETURN 'invalid'; END IF;
--     IF p_from = p_to THEN RETURN 'noop'; END IF;
--
--     IF p_mode = 'system' THEN
--       IF p_to <> 'subscribed' AND private.email_status_rank(p_to) > private.email_status_rank(p_from) THEN
--         RETURN 'apply';
--       END IF;
--       RETURN 'kept';
--     END IF;
--
--     IF p_mode = 'person' THEN
--       IF p_from IN ('bounced', 'complained') THEN RETURN 'kept'; END IF;
--       IF p_to IN ('subscribed', 'unsubscribed') THEN RETURN 'apply'; END IF;
--       RETURN 'kept';
--     END IF;
--
--     -- admin
--     IF p_to = 'subscribed' AND p_from IN ('bounced', 'complained')
--        AND NULLIF(btrim(coalesce(p_reason, '')), '') IS NULL THEN
--       RETURN 'reason_required';
--     END IF;
--     RETURN 'apply';
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION private.email_pause_enrollments(p_contact_id uuid, p_status text)
--    RETURNS integer
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_n integer := 0;
--   BEGIN
--     IF p_status NOT IN ('unsubscribed', 'bounced', 'complained') THEN RETURN 0; END IF;
--
--     UPDATE public.sequence_enrollments e
--        SET status = 'paused',
--            paused_reason = 'email_' || p_status,
--            paused_at = now(),
--            locked_at = NULL
--       FROM public.channels ch, public.sequences s
--      WHERE e.contact_id = p_contact_id
--        AND e.status = 'active'
--        AND ch.id = e.channel_id
--        AND ch.provider = 'resend'
--        AND s.id = e.sequence_id
--        AND EXISTS (
--          SELECT 1
--            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.steps) = 'array' THEN s.steps ELSE '[]'::jsonb END)
--                 WITH ORDINALITY AS st(step, ord)
--           WHERE st.ord - 1 >= e.current_step_index
--             AND st.step ->> 'type' IN ('message', 'aiMessage', 'asset')
--             AND coalesce(st.step ->> 'emailCategory', 'marketing') = 'marketing');
--     GET DIAGNOSTICS v_n = ROW_COUNT;
--     RETURN v_n;
--   END;
--   $function$;
--
--   CREATE OR REPLACE FUNCTION private.email_status_apply(p_workspace_id uuid, p_contact_ids uuid[], p_address text, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamp with time zone, p_extra jsonb)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_at timestamptz := LEAST(coalesce(p_occurred_at, now()), now());
--     v_sub_at timestamptz := CASE WHEN p_subscribed_at IS NULL THEN NULL ELSE LEAST(p_subscribed_at, now()) END;
--     v_c record;
--     v_decision text;
--     v_changed integer := 0;
--     v_kept boolean := false;
--     v_paused integer;
--     v_paused_total integer := 0;
--     v_before text := NULL;
--     v_after text := NULL;
--   BEGIN
--     IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin')
--        OR private.email_status_rank(p_status) = 0 THEN
--       RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
--     END IF;
--     IF NULLIF(btrim(coalesce(p_source, '')), '') IS NULL THEN
--       RAISE EXCEPTION 'Falta el origen del cambio de estado de email' USING ERRCODE = 'EM001';
--     END IF;
--
--     FOR v_c IN
--       SELECT c.id, c.workspace_id, c.email_status, c.email_subscribed_at, c.email_status_at, c.email_status_source
--         FROM public.contacts c
--        WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[]))
--          AND c.workspace_id = p_workspace_id
--        ORDER BY c.id
--          FOR UPDATE
--     LOOP
--       IF v_before IS NULL OR private.email_status_rank(v_c.email_status) > private.email_status_rank(v_before) THEN
--         v_before := v_c.email_status;
--       END IF;
--
--       v_decision := private.email_status_decide(v_c.email_status, p_status, p_mode, p_reason);
--
--       IF v_decision = 'reason_required' THEN
--         RAISE EXCEPTION 'Para volver a suscribir una direccion que rebota o marco spam hace falta un motivo' USING ERRCODE = 'EM002';
--       ELSIF v_decision = 'invalid' THEN
--         RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
--       ELSIF v_decision = 'apply' THEN
--         PERFORM set_config('app.email_status_internal', 'on', true);
--         UPDATE public.contacts
--            SET email_status = p_status,
--                email_status_at = v_at,
--                email_status_source = p_source,
--                email_subscribed_at = CASE WHEN p_status = 'subscribed' THEN coalesce(v_sub_at, v_at) ELSE email_subscribed_at END
--          WHERE id = v_c.id;
--         PERFORM set_config('app.email_status_internal', 'off', true);
--
--         v_paused := private.email_pause_enrollments(v_c.id, p_status);
--         v_paused_total := v_paused_total + v_paused;
--
--         INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--         VALUES (
--           v_c.workspace_id, 'contact', v_c.id, 'email_status',
--           jsonb_build_object('email_status', jsonb_build_object('old', v_c.email_status, 'new', p_status)),
--           coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
--             'source', p_source,
--             'reason', NULLIF(btrim(coalesce(p_reason, '')), ''),
--             'address', p_address,
--             'mode', p_mode,
--             'occurred_at', v_at,
--             'enrollments_paused', v_paused),
--           p_performed_by);
--         v_changed := v_changed + 1;
--       ELSIF v_decision = 'kept' THEN
--         v_kept := true;
--       ELSIF v_decision = 'noop' AND p_status = 'subscribed' AND v_sub_at IS NOT NULL
--             AND v_sub_at < coalesce(v_c.email_subscribed_at, 'infinity'::timestamptz) THEN
--         -- La misma suscripcion, pero con un consentimiento mas viejo (una importacion
--         -- con su fecha original): se corrige la fecha. No es un cambio de estado.
--         PERFORM set_config('app.email_status_internal', 'on', true);
--         UPDATE public.contacts
--            SET email_subscribed_at = v_sub_at,
--                email_status_at = LEAST(coalesce(email_status_at, v_sub_at), v_sub_at),
--                email_status_source = coalesce(NULLIF(email_status_source, 'backfill'), p_source)
--          WHERE id = v_c.id;
--         PERFORM set_config('app.email_status_internal', 'off', true);
--       END IF;
--     END LOOP;
--
--     SELECT c.email_status INTO v_after
--       FROM public.contacts c
--      WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[])) AND c.workspace_id = p_workspace_id
--      ORDER BY private.email_status_rank(c.email_status) DESC
--      LIMIT 1;
--
--     RETURN jsonb_build_object(
--       'status', v_after,
--       'previous_status', v_before,
--       'changed', v_changed > 0,
--       'kept_existing', v_kept AND v_changed = 0,
--       'contacts_changed', v_changed,
--       'enrollments_paused', v_paused_total);
--   END;
--   $function$;
--
--   ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_email_status_check;
--   ALTER TABLE public.contacts ADD CONSTRAINT contacts_email_status_check
--     CHECK (email_status IN ('subscribed', 'unsubscribed', 'bounced', 'complained'));
--   ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
--   ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
--     CHECK (status = ANY (ARRAY['sent', 'failed', 'skipped_not_configured', 'skipped_unsubscribed',
--       'skipped_bounced', 'skipped_complained', 'skipped_do_not_contact', 'skipped_unverifiable']));
--   Volver atras solo si no quedo ninguna fila con los valores nuevos:
--     SELECT count(*) FROM public.contacts WHERE email_status = 'not_subscribed';
--     SELECT count(*) FROM public.email_log WHERE status = 'skipped_not_subscribed';
--
-- Idempotente: los CHECK se borran y se vuelven a crear con la lista completa; las
-- funciones son CREATE OR REPLACE con la misma firma (los permisos se conservan).
-- ============================================================

SET search_path = '';

-- 1 y 2. Los CHECK -------------------------------------------------------------

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_email_status_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_email_status_check
  CHECK (email_status IN ('subscribed', 'not_subscribed', 'unsubscribed', 'bounced', 'complained'));

COMMENT ON COLUMN public.contacts.email_status IS
  'Estado de las direcciones de email del contacto: subscribed | not_subscribed | unsubscribed | bounced | complained. Se cambia SOLO con public.set_email_status / set_email_status_by_address (00271, 00278). No es is_subscribed (difusiones por chat).';

ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;
ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
  CHECK (status = ANY (ARRAY[
    'sent', 'failed', 'skipped_not_configured',
    'skipped_unsubscribed', 'skipped_bounced', 'skipped_complained',
    'skipped_do_not_contact', 'skipped_unverifiable',
    'skipped_not_subscribed'
  ]));

-- 3. La gravedad ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.email_status_rank(p_status text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_status
    WHEN 'complained' THEN 5
    WHEN 'bounced' THEN 4
    WHEN 'unsubscribed' THEN 3
    -- 00278: nunca acepto marketing. Mas grave que suscripto, menos que una baja.
    WHEN 'not_subscribed' THEN 2
    WHEN 'subscribed' THEN 1
    ELSE 0
  END;
$function$;

-- 4. Las transiciones ----------------------------------------------------------

CREATE OR REPLACE FUNCTION private.email_status_decide(p_from text, p_to text, p_mode text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin', 'consent') THEN RETURN 'invalid'; END IF;
  IF private.email_status_rank(p_to) = 0 OR private.email_status_rank(p_from) = 0 THEN RETURN 'invalid'; END IF;
  IF p_from = p_to THEN RETURN 'noop'; END IF;

  IF p_mode = 'system' THEN
    IF p_to <> 'subscribed' AND private.email_status_rank(p_to) > private.email_status_rank(p_from) THEN
      RETURN 'apply';
    END IF;
    RETURN 'kept';
  END IF;

  -- 00278: la casilla de marketing de un formulario. Solo saca de 'not_subscribed' a 'subscribed':
  -- nunca levanta una baja, un rebote ni una queja (cualquiera puede llenar un formulario con un
  -- email ajeno). Cualquier otro destino tampoco.
  IF p_mode = 'consent' THEN
    IF p_from = 'not_subscribed' AND p_to = 'subscribed' THEN RETURN 'apply'; END IF;
    RETURN 'kept';
  END IF;

  IF p_mode = 'person' THEN
    IF p_from IN ('bounced', 'complained') THEN RETURN 'kept'; END IF;
    IF p_to IN ('subscribed', 'unsubscribed') THEN RETURN 'apply'; END IF;
    RETURN 'kept';
  END IF;

  -- admin
  IF p_to = 'subscribed' AND p_from IN ('bounced', 'complained')
     AND NULLIF(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN 'reason_required';
  END IF;
  RETURN 'apply';
END;
$function$;

-- 5. El nucleo (solo cambia la lista de modos) ----------------------------------

CREATE OR REPLACE FUNCTION private.email_status_apply(p_workspace_id uuid, p_contact_ids uuid[], p_address text, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamp with time zone, p_extra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_at timestamptz := LEAST(coalesce(p_occurred_at, now()), now());
  v_sub_at timestamptz := CASE WHEN p_subscribed_at IS NULL THEN NULL ELSE LEAST(p_subscribed_at, now()) END;
  v_c record;
  v_decision text;
  v_changed integer := 0;
  v_kept boolean := false;
  v_paused integer;
  v_paused_total integer := 0;
  v_before text := NULL;
  v_after text := NULL;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin', 'consent') -- 00278: suma 'consent'
     OR private.email_status_rank(p_status) = 0 THEN
    RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
  END IF;
  IF NULLIF(btrim(coalesce(p_source, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el origen del cambio de estado de email' USING ERRCODE = 'EM001';
  END IF;

  FOR v_c IN
    SELECT c.id, c.workspace_id, c.email_status, c.email_subscribed_at, c.email_status_at, c.email_status_source
      FROM public.contacts c
     WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[]))
       AND c.workspace_id = p_workspace_id
     ORDER BY c.id
       FOR UPDATE
  LOOP
    IF v_before IS NULL OR private.email_status_rank(v_c.email_status) > private.email_status_rank(v_before) THEN
      v_before := v_c.email_status;
    END IF;

    v_decision := private.email_status_decide(v_c.email_status, p_status, p_mode, p_reason);

    IF v_decision = 'reason_required' THEN
      RAISE EXCEPTION 'Para volver a suscribir una direccion que rebota o marco spam hace falta un motivo' USING ERRCODE = 'EM002';
    ELSIF v_decision = 'invalid' THEN
      RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
    ELSIF v_decision = 'apply' THEN
      PERFORM set_config('app.email_status_internal', 'on', true);
      UPDATE public.contacts
         SET email_status = p_status,
             email_status_at = v_at,
             email_status_source = p_source,
             email_subscribed_at = CASE WHEN p_status = 'subscribed' THEN coalesce(v_sub_at, v_at) ELSE email_subscribed_at END
       WHERE id = v_c.id;
      PERFORM set_config('app.email_status_internal', 'off', true);

      v_paused := private.email_pause_enrollments(v_c.id, p_status);
      v_paused_total := v_paused_total + v_paused;

      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        v_c.workspace_id, 'contact', v_c.id, 'email_status',
        jsonb_build_object('email_status', jsonb_build_object('old', v_c.email_status, 'new', p_status)),
        coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
          'source', p_source,
          'reason', NULLIF(btrim(coalesce(p_reason, '')), ''),
          'address', p_address,
          'mode', p_mode,
          'occurred_at', v_at,
          'enrollments_paused', v_paused),
        p_performed_by);
      v_changed := v_changed + 1;
    ELSIF v_decision = 'kept' THEN
      v_kept := true;
    ELSIF v_decision = 'noop' AND p_status = 'subscribed' AND v_sub_at IS NOT NULL
          AND v_sub_at < coalesce(v_c.email_subscribed_at, 'infinity'::timestamptz) THEN
      -- La misma suscripcion, pero con un consentimiento mas viejo (una importacion
      -- con su fecha original): se corrige la fecha. No es un cambio de estado.
      PERFORM set_config('app.email_status_internal', 'on', true);
      UPDATE public.contacts
         SET email_subscribed_at = v_sub_at,
             email_status_at = LEAST(coalesce(email_status_at, v_sub_at), v_sub_at),
             email_status_source = coalesce(NULLIF(email_status_source, 'backfill'), p_source)
       WHERE id = v_c.id;
      PERFORM set_config('app.email_status_internal', 'off', true);
    END IF;
  END LOOP;

  SELECT c.email_status INTO v_after
    FROM public.contacts c
   WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[])) AND c.workspace_id = p_workspace_id
   ORDER BY private.email_status_rank(c.email_status) DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'status', v_after,
    'previous_status', v_before,
    'changed', v_changed > 0,
    'kept_existing', v_kept AND v_changed = 0,
    'contacts_changed', v_changed,
    'enrollments_paused', v_paused_total);
END;
$function$;

-- 6. Pausar secuencias de marketing ----------------------------------------------

CREATE OR REPLACE FUNCTION private.email_pause_enrollments(p_contact_id uuid, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_status NOT IN ('not_subscribed', 'unsubscribed', 'bounced', 'complained') THEN RETURN 0; END IF; -- 00278: suma not_subscribed

  UPDATE public.sequence_enrollments e
     SET status = 'paused',
         paused_reason = 'email_' || p_status,
         paused_at = now(),
         locked_at = NULL
    FROM public.channels ch, public.sequences s
   WHERE e.contact_id = p_contact_id
     AND e.status = 'active'
     AND ch.id = e.channel_id
     AND ch.provider = 'resend'
     AND s.id = e.sequence_id
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.steps) = 'array' THEN s.steps ELSE '[]'::jsonb END)
              WITH ORDINALITY AS st(step, ord)
        WHERE st.ord - 1 >= e.current_step_index
          AND st.step ->> 'type' IN ('message', 'aiMessage', 'asset')
          AND coalesce(st.step ->> 'emailCategory', 'marketing') = 'marketing');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION private.email_status_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.email_status_decide(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.email_status_apply(uuid, uuid[], text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.email_pause_enrollments(uuid, text) FROM PUBLIC, anon, authenticated;
