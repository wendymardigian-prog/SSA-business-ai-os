-- ============================================================
-- 00271_email_status_functions
-- ============================================================
-- Suscripcion a emails (E1, M2). Todo cambio del estado de email pasa por aca.
--
-- Que suma:
--   1. private.email_status_rank / private.email_status_decide: la gravedad
--      (complained > bounced > unsubscribed > subscribed) y la tabla de
--      transiciones por modo. Gemela de lib/email/subscription.ts, con los casos
--      de lib/email/subscription-transitions.cases.json:
--        - system (importacion, webhooks, flujos, herencia, fusion): solo empeora;
--          NUNCA sube a 'subscribed' (devuelve kept_existing).
--        - person (la propia persona desde la pagina de baja): entre subscribed y
--          unsubscribed; desde bounced/complained, nada.
--        - admin (el equipo a mano): todo; sacar un rebote o una queja exige motivo.
--   2. public.email_address_status(ws, email): el PEOR estado entre TODOS los
--      contactos del workspace que tienen esa direccion (email o secundario),
--      INCLUIDOS los borrados. Es lo que mira la puerta de envio, en el momento
--      de enviar: no depende de la columna cacheada de un contacto.
--   3. public.email_address_send_state(ws, email, contact): el estado de la
--      direccion, si algun contacto VIVO con esa direccion esta en "no contactar",
--      y el token de baja para el pie (el del contacto si tiene esa direccion).
--   4. public.set_email_status(contacto, ...) y public.set_email_status_by_address
--      (ws, email, ...): aplican el cambio a TODOS los contactos del workspace con
--      esa direccion (vivos y borrados), en una transaccion, con
--      pg_advisory_xact_lock por (workspace, direccion normalizada). Idempotentes:
--      el mismo estado no escribe evento. Al pasar a un estado que no recibe
--      marketing, pausan en el momento las inscripciones activas sobre un canal de
--      email con algun paso de marketing pendiente (paused_reason
--      'email_unsubscribed' | 'email_bounced' | 'email_complained'); no se
--      reanudan solas. El historial va a audit_log (action 'email_status').
--   5. contacts_email_status_guard: nadie escribe las 5 columnas por fuera de estas
--      funciones (bandera de transaccion app.email_status_internal), ni el service
--      role. Una fila nueva solo puede nacer 'subscribed'.
--   6. contacts_email_inherit: si a un contacto se le pone una direccion que otro
--      contacto (vivo o borrado) tiene dada de baja, hereda ese estado (modo
--      system, source 'inherit'). Si falla, NUNCA en silencio: RAISE WARNING y una
--      entrada 'email_status_inherit_failed' en audit_log; el alta o la edicion no
--      se caen. La puerta de envio no depende de este trigger (punto 2).
--   7. contacts_email_on_merge: al fusionar, el principal se lleva el PEOR estado
--      de los dos (source 'merge'). Mismo patron que contacts_known_on_merge
--      (00256) y contacts_customer_on_merge (00268): merge_contacts NO se reescribe.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS contacts_email_on_merge ON public.contacts;
--   DROP TRIGGER IF EXISTS contacts_email_inherit ON public.contacts;
--   DROP TRIGGER IF EXISTS contacts_email_status_guard ON public.contacts;
--   DROP FUNCTION IF EXISTS private.contacts_email_on_merge();
--   DROP FUNCTION IF EXISTS private.contacts_email_inherit();
--   DROP FUNCTION IF EXISTS private.contacts_email_status_guard();
--   DROP FUNCTION IF EXISTS public.set_email_status_by_address(uuid, text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb);
--   DROP FUNCTION IF EXISTS public.set_email_status(uuid, text, text, timestamptz, text, uuid, text, text, timestamptz, jsonb);
--   DROP FUNCTION IF EXISTS public.email_address_send_state(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.email_address_status(uuid, text);
--   DROP FUNCTION IF EXISTS private.email_status_apply(uuid, uuid[], text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb);
--   DROP FUNCTION IF EXISTS private.email_pause_enrollments(uuid, text);
--   DROP FUNCTION IF EXISTS private.email_status_lock(uuid, text);
--   DROP FUNCTION IF EXISTS private.email_status_decide(text, text, text, text);
--   DROP FUNCTION IF EXISTS private.email_status_rank(text);
--   (Las inscripciones que se pausaron quedan pausadas: se reanudan a mano.)
--
-- Idempotente: CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Gravedad y transiciones
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.email_status_rank(p_status text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_status
    WHEN 'complained' THEN 4
    WHEN 'bounced' THEN 3
    WHEN 'unsubscribed' THEN 2
    WHEN 'subscribed' THEN 1
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION private.email_status_decide(p_from text, p_to text, p_mode text, p_reason text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin') THEN RETURN 'invalid'; END IF;
  IF private.email_status_rank(p_to) = 0 OR private.email_status_rank(p_from) = 0 THEN RETURN 'invalid'; END IF;
  IF p_from = p_to THEN RETURN 'noop'; END IF;

  IF p_mode = 'system' THEN
    IF p_to <> 'subscribed' AND private.email_status_rank(p_to) > private.email_status_rank(p_from) THEN
      RETURN 'apply';
    END IF;
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
$$;

REVOKE ALL ON FUNCTION private.email_status_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.email_status_decide(text, text, text, text) FROM PUBLIC, anon, authenticated;

-- El candado por (workspace, direccion normalizada).
CREATE OR REPLACE FUNCTION private.email_status_lock(p_workspace_id uuid, p_address text)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('email_status:' || p_workspace_id::text || ':' || coalesce(p_address, ''), 0));
$$;
REVOKE ALL ON FUNCTION private.email_status_lock(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Estado efectivo de una direccion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_address_status(p_workspace_id uuid, p_email text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT c.email_status
       FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id
        AND public.normalize_email(p_email) IS NOT NULL
        AND (public.normalize_email(c.email) = public.normalize_email(p_email)
             OR public.normalize_email(c.secondary_email) = public.normalize_email(p_email))
      ORDER BY private.email_status_rank(c.email_status) DESC
      LIMIT 1),
    'subscribed');
$$;

REVOKE ALL ON FUNCTION public.email_address_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_address_status(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 3. Lo que necesita la puerta de envio, en una sola consulta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.email_address_send_state(p_workspace_id uuid, p_email text, p_contact_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_addr text := public.normalize_email(p_email);
  v_token uuid;
  v_matched boolean;
  v_dnc boolean;
BEGIN
  IF v_addr IS NULL THEN
    RETURN jsonb_build_object('status', 'subscribed', 'do_not_contact', false, 'token', NULL, 'matched', false);
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.contacts c
            WHERE c.workspace_id = p_workspace_id
              AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)),
         EXISTS (
           SELECT 1 FROM public.contacts c
            WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND c.do_not_contact
              AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr))
    INTO v_matched, v_dnc;

  -- El token: el del contacto del envio si esa direccion es suya; si no, el de
  -- un contacto con esa direccion (los vivos primero, el mas antiguo).
  SELECT c.email_unsubscribe_token INTO v_token
    FROM public.contacts c
   WHERE c.workspace_id = p_workspace_id
     AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)
   ORDER BY (c.id = p_contact_id) DESC, (c.deleted_at IS NULL) DESC, c.created_at
   LIMIT 1;

  RETURN jsonb_build_object(
    'status', public.email_address_status(p_workspace_id, v_addr),
    'do_not_contact', coalesce(v_dnc, false),
    'token', v_token,
    'matched', coalesce(v_matched, false));
END;
$$;

REVOKE ALL ON FUNCTION public.email_address_send_state(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_address_send_state(uuid, text, uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. Pausar secuencias de email con marketing pendiente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.email_pause_enrollments(p_contact_id uuid, p_status text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_status NOT IN ('unsubscribed', 'bounced', 'complained') THEN RETURN 0; END IF;

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
$$;
REVOKE ALL ON FUNCTION private.email_pause_enrollments(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. El nucleo: aplica un estado a una lista de contactos (el que llama ya tomo el candado)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.email_status_apply(
  p_workspace_id uuid,
  p_contact_ids uuid[],
  p_address text,
  p_status text,
  p_source text,
  p_occurred_at timestamptz,
  p_reason text,
  p_performed_by uuid,
  p_mode text,
  p_subscribed_at timestamptz,
  p_extra jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
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
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin')
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
$$;
REVOKE ALL ON FUNCTION private.email_status_apply(uuid, uuid[], text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. Las dos puertas publicas (solo service_role)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_email_status(
  p_contact_id uuid,
  p_status text,
  p_source text,
  p_occurred_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_performed_by uuid DEFAULT NULL,
  p_mode text DEFAULT 'system',
  p_address text DEFAULT NULL,
  p_subscribed_at timestamptz DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid;
  v_addr text;
  v_ids uuid[];
  v_contact public.contacts%ROWTYPE;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;
  v_ws := v_contact.workspace_id;
  v_addr := coalesce(public.normalize_email(p_address), public.normalize_email(v_contact.email), public.normalize_email(v_contact.secondary_email));

  PERFORM private.email_status_lock(v_ws, coalesce(v_addr, 'contact:' || p_contact_id::text));

  -- El contacto y todos los del workspace que comparten la direccion (vivos y borrados).
  SELECT array_agg(DISTINCT c.id) INTO v_ids
    FROM public.contacts c
   WHERE c.id = p_contact_id
      OR (v_addr IS NOT NULL AND c.workspace_id = v_ws
          AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr));

  RETURN private.email_status_apply(v_ws, v_ids, v_addr, p_status, p_source, p_occurred_at, p_reason,
                                    p_performed_by, p_mode, p_subscribed_at, p_extra);
END;
$$;

REVOKE ALL ON FUNCTION public.set_email_status(uuid, text, text, timestamptz, text, uuid, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_email_status(uuid, text, text, timestamptz, text, uuid, text, text, timestamptz, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.set_email_status_by_address(
  p_workspace_id uuid,
  p_email text,
  p_status text,
  p_source text,
  p_occurred_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_performed_by uuid DEFAULT NULL,
  p_mode text DEFAULT 'system',
  p_subscribed_at timestamptz DEFAULT NULL,
  p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_addr text := public.normalize_email(p_email);
  v_ids uuid[];
BEGIN
  IF p_workspace_id IS NULL OR v_addr IS NULL THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;

  PERFORM private.email_status_lock(p_workspace_id, v_addr);

  SELECT array_agg(c.id) INTO v_ids
    FROM public.contacts c
   WHERE c.workspace_id = p_workspace_id
     AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr);

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;

  RETURN private.email_status_apply(p_workspace_id, v_ids, v_addr, p_status, p_source, p_occurred_at, p_reason,
                                    p_performed_by, p_mode, p_subscribed_at, p_extra);
END;
$$;

REVOKE ALL ON FUNCTION public.set_email_status_by_address(uuid, text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_email_status_by_address(uuid, text, text, text, timestamptz, text, uuid, text, timestamptz, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 7. La guardia
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contacts_email_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('app.email_status_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.email_status IS DISTINCT FROM 'subscribed' THEN
      RAISE EXCEPTION 'El estado de email de un contacto se cambia con set_email_status' USING ERRCODE = 'EM003';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.email_status IS DISTINCT FROM OLD.email_status
     OR NEW.email_status_at IS DISTINCT FROM OLD.email_status_at
     OR NEW.email_status_source IS DISTINCT FROM OLD.email_status_source
     OR NEW.email_subscribed_at IS DISTINCT FROM OLD.email_subscribed_at
     OR NEW.email_unsubscribe_token IS DISTINCT FROM OLD.email_unsubscribe_token THEN
    RAISE EXCEPTION 'El estado de email de un contacto se cambia con set_email_status' USING ERRCODE = 'EM003';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.contacts_email_status_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_email_status_guard ON public.contacts;
CREATE TRIGGER contacts_email_status_guard
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_email_status_guard();

-- ------------------------------------------------------------
-- 8. Herencia al poner una direccion (nunca en silencio, nunca tumba el alta)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contacts_email_inherit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_addr text;
  v_worst text;
  v_current text;
BEGIN
  BEGIN
    FOR v_addr IN
      SELECT DISTINCT a
        FROM unnest(ARRAY[public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email)]) AS a
       WHERE a IS NOT NULL
         AND (TG_OP = 'INSERT'
              OR (a IS DISTINCT FROM public.normalize_email(OLD.email)
                  AND a IS DISTINCT FROM public.normalize_email(OLD.secondary_email)))
    LOOP
      PERFORM private.email_status_lock(NEW.workspace_id, v_addr);

      SELECT c.email_status INTO v_worst
        FROM public.contacts c
       WHERE c.workspace_id = NEW.workspace_id
         AND c.id <> NEW.id
         AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)
       ORDER BY private.email_status_rank(c.email_status) DESC
       LIMIT 1;

      SELECT email_status INTO v_current FROM public.contacts WHERE id = NEW.id;

      IF v_worst IS NOT NULL AND private.email_status_rank(v_worst) > private.email_status_rank(v_current) THEN
        PERFORM private.email_status_apply(
          NEW.workspace_id, ARRAY[NEW.id], v_addr, v_worst, 'inherit', now(),
          'La direccion ya estaba dada de baja en otro contacto', NULL, 'system', NULL,
          jsonb_build_object('inherited', true));
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[email_status] no pude heredar el estado de email del contacto % (%): %', NEW.id, SQLSTATE, SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'email_status_inherit_failed', NULL,
              jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE,
                                 'address', coalesce(public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email))),
              NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[email_status] tampoco pude anotar el fallo de herencia del contacto %: %', NEW.id, SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.contacts_email_inherit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_email_inherit ON public.contacts;
CREATE TRIGGER contacts_email_inherit
  AFTER INSERT OR UPDATE OF email, secondary_email ON public.contacts
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION private.contacts_email_inherit();

-- ------------------------------------------------------------
-- 9. Fusion: el principal se lleva el peor estado
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contacts_email_on_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_main uuid;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL OR NEW.email_status = 'subscribed' THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  -- Sin candado por direccion: merge_contacts ya tiene bloqueadas las dos filas, y
  -- email_status_apply relee la del principal con FOR UPDATE.
  PERFORM private.email_status_apply(
    NEW.workspace_id, ARRAY[v_main],
    coalesce(public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email)),
    NEW.email_status, 'merge', coalesce(NEW.email_status_at, now()),
    'Fusion de contactos', NULL, 'system', NULL,
    jsonb_build_object('merged_from', NEW.id, 'original_source', NEW.email_status_source));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.contacts_email_on_merge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_email_on_merge ON public.contacts;
CREATE TRIGGER contacts_email_on_merge
  AFTER UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_email_on_merge();
