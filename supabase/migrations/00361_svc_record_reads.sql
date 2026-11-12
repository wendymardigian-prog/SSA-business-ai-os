-- ============================================================
-- 00361_svc_record_reads.sql
-- ============================================================
-- Servicios A2 (F130): lo que necesitan las fichas del cliente y del servicio y la lista de Clientes, leido del
-- esquema cerrado del portal (`app_servicio_portal`), que la pantalla no puede leer ni con el cliente de servicio.
--
-- Tres funciones de SOLO LECTURA, `SECURITY DEFINER`, `search_path = ''`:
--   * service_classroom(servicio)        el avance en el classroom: cada modulo, submodulo y clase activos del
--                                        programa, con lo que vio, entrego o aprobo esa persona y, por modulo, si
--                                        esta abierto y cuando se abre (la misma regla del portal:
--                                        program_item_unlocked).
--   * service_attendance(servicio)       las clases en vivo que ya pasaron desde que empezo el servicio y en las que
--                                        esa persona estaba en la base (attendance_base_members), con su asistencia.
--   * contacts_portal_summary(contactos) por contacto: la cuenta del portal (estado, ultimo ingreso, invitacion), las
--                                        entregas por revisar y el primer acceso por vencer (7 dias).
--
-- Quien llama tiene que poder ver el servicio (can_see_service_row, el mismo alcance de la lista) o, en el resumen,
-- algun servicio de ese contacto: lo demas se descarta en silencio (no revela que existe). Ninguna escribe nada.
--
-- Aditiva: tres funciones nuevas, sin tablas ni columnas. Puede ir antes o despues del codigo (sin ella, las fichas
-- no muestran el classroom ni la asistencia y la lista no sabe el ultimo ingreso).
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS app_servicio.service_classroom(uuid);
--   DROP FUNCTION IF EXISTS app_servicio.service_attendance(uuid);
--   DROP FUNCTION IF EXISTS app_servicio.contacts_portal_summary(uuid[]);
-- ============================================================

CREATE OR REPLACE FUNCTION app_servicio.service_classroom(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'parent_id', i.parent_id, 'kind', i.kind, 'lesson_type', i.lesson_type, 'title', i.title,
        'position', i.position, 'required', i.required,
        'viewed_at', pp.viewed_at, 'completed_at', pp.completed_at,
        -- La ultima entrega de una actividad o evaluacion de esa persona (sin revelar respuestas ni notas internas).
        'submission', CASE WHEN i.form_id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object('created_at', fs.created_at, 'review_status', fs.review_status)
            FROM public.form_submissions fs
           WHERE fs.form_id = i.form_id AND fs.contact_id = s.contact_id AND fs.workspace_id = s.workspace_id
           ORDER BY fs.created_at DESC LIMIT 1) END,
        -- Solo los modulos llevan su apertura: una clase hereda la de su modulo y el portal decide el resto.
        'unlock', CASE WHEN i.kind = 'module' THEN app_servicio.program_item_unlocked(s.contact_id, i.id) END)
        ORDER BY i.position, i.created_at)
        FROM app_servicio.program_items i
        LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = i.id AND pp.contact_id = s.contact_id
       WHERE i.product_id = s.product_id AND i.workspace_id = s.workspace_id AND i.status = 'active'), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.service_attendance(p_service_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s app_servicio.services;
  v_from date;
  v_to date;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF s.starts_on IS NULL THEN RETURN '[]'::jsonb; END IF;
  v_to := LEAST(app_servicio.today_in(s.workspace_id), COALESCE(s.ends_on, app_servicio.today_in(s.workspace_id)));
  -- Hasta un año para atras: una ficha no necesita mas y la cuenta queda acotada.
  v_from := GREATEST(s.starts_on, v_to - 366);
  IF v_to < v_from THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'live_session_id', o.live_session_id, 'title', ls.title, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at,
      'attended', a.id IS NOT NULL, 'source', a.source) ORDER BY o.starts_at DESC)
      FROM app_servicio.live_session_occurrences(s.product_id, v_from, v_to) o
      JOIN app_servicio.live_sessions ls ON ls.id = o.live_session_id
      LEFT JOIN app_servicio_portal.live_attendance a
        ON a.live_session_id = o.live_session_id AND a.occurs_on = o.occurs_on AND a.contact_id = s.contact_id AND a.removed_at IS NULL
     WHERE o.status <> 'cancelled' AND o.starts_at <= now()
       AND (a.id IS NOT NULL OR EXISTS (SELECT 1 FROM app_servicio.attendance_base_members(o.live_session_id, o.occurs_on) b WHERE b.contact_id = s.contact_id))
  ), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.contacts_portal_summary(p_contact_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_contact_ids IS NULL OR cardinality(p_contact_ids) = 0 THEN RETURN '[]'::jsonb; END IF;
  IF cardinality(p_contact_ids) > 500 THEN RAISE EXCEPTION 'Hasta 500 contactos por consulta' USING ERRCODE = 'SV004'; END IF;
  -- Solo los contactos con algun servicio que quien llama puede ver (el mismo alcance de Clientes).
  SELECT array_agg(DISTINCT s.contact_id) INTO v_ids
    FROM app_servicio.services s
   WHERE s.contact_id = ANY (p_contact_ids) AND (app_servicio.is_system() OR app_servicio.can_see_service_row(s));
  IF v_ids IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'contact_id', c,
      'account_status', pa.status,
      'last_login_at', pa.last_login_at,
      'invite_sent_at', pa.invite_sent_at,
      'pending_reviews', (
        SELECT count(*) FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id
         WHERE fs.contact_id = c AND f.type = 'activity' AND fs.context = 'portal'
           AND (fs.review_status IS NULL OR fs.review_status = 'pending')),
      'access_expiring_on', (
        SELECT min(app_servicio.local_date(x.ends_at, x.workspace_id)) FROM app_servicio_portal.portal_access x
         WHERE x.contact_id = c AND x.revoked_at IS NULL AND x.ends_at IS NOT NULL
           AND x.ends_at >= now() AND x.ends_at < now() + interval '7 days')))
      FROM unnest(v_ids) c
      LEFT JOIN LATERAL (
        SELECT a.status, a.last_login_at, a.invite_sent_at FROM app_servicio_portal.portal_accounts a
         WHERE a.contact_id = c ORDER BY a.created_at DESC LIMIT 1) pa ON true
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.service_classroom(uuid), app_servicio.service_attendance(uuid), app_servicio.contacts_portal_summary(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.service_classroom(uuid), app_servicio.service_attendance(uuid), app_servicio.contacts_portal_summary(uuid[]) TO authenticated, service_role;
