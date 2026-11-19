-- ============================================================
-- 00411_trash_entities.sql
-- ============================================================
-- Que se lleva, que frena y que avisa eliminar cada tipo de registro
-- (docs/papelera.md). El motor (la foto, el borrado, la restauracion) es la 00410.
--
-- Tres funciones para la app, todas SECURITY DEFINER y con la sesion de la
-- persona (`authenticated`): la base mira la clave de eliminar de esa entidad
-- (`private.trash_can`) y que la persona VEA el registro (las mismas funciones de
-- visibilidad de la RLS). El workspace sale del registro, nunca de lo que mande el
-- navegador.
--
--   public.trash_preview(ws, entidad, id, opciones) -> lo que se va, lo que frena y los avisos. No escribe.
--   public.trash_delete(ws, entidad, id, opciones)  -> foto + borrado + lo que hay que recalcular.
--   public.trash_restore(ws, item)                  -> vuelve a poner las filas.
--
-- Codigos de bloqueo (los traduce lib/trash/messages.ts):
--   contract_signed        hay un contrato firmado (prueba legal)
--   commission_in_expense  una comision ya esta en un gasto (liquidada o por liquidar)
--   service_needs_permission  pidio eliminar el servicio de la venta sin poder eliminar servicios
--   expense_automatic      el gasto lo crea el sistema (se anula, no se elimina)
--   product_sold           el producto tiene ventas
--   content_scheduled      la pieza tiene una red programada o publicandose
--   in_use:<tabla>         otro registro lo usa (lo detecta el motor)
--
-- Aditiva: funciones nuevas. Puede ir antes o despues del codigo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. El plan de cada entidad
-- ------------------------------------------------------------
-- Devuelve {found, workspace_id, label, roots, nullify, blockers, warnings, contact_id, sale_id, external}.
-- `roots` va en el orden en que las filas se vuelven a insertar; se borran al reves.

CREATE OR REPLACE FUNCTION private.trash_plan(p_workspace_id uuid, p_entity text, p_id uuid, p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label text;
  v_roots jsonb := '[]'::jsonb;
  v_nullify jsonb := '[]'::jsonb;
  v_blockers text[] := ARRAY[]::text[];
  v_warnings text[] := ARRAY[]::text[];
  v_contact uuid;
  v_sale uuid;
  v_external jsonb;
  v_payment_ids uuid[];
  v_commission_ids uuid[];
  v_ids uuid[];
  v_visible boolean := false;
  v_with_service boolean := COALESCE((p_options ->> 'with_service')::boolean, false);
  r record;
BEGIN
  CASE p_entity
  -- ── Reunion ───────────────────────────────────────────────
  WHEN 'booking' THEN
    SELECT b.*, public.can_see_booking(b) AS visible INTO r
    FROM public.bookings b WHERE b.id = p_id AND b.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      v_label := left(COALESCE(NULLIF(btrim(r.booker_name), ''), NULLIF(btrim(r.title), ''), 'Reunión')
                      || ' · ' || to_char(r.start_at AT TIME ZONE COALESCE(NULLIF(r.host_timezone, ''), 'UTC'), 'DD/MM/YYYY HH24:MI'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.bookings', 'ids', jsonb_build_array(p_id)));
      IF r.status_group = 'active' AND r.start_at > now() THEN
        v_warnings := array_append(v_warnings, 'booking_active');
      END IF;
    END IF;

  -- ── Venta ─────────────────────────────────────────────────
  WHEN 'sale' THEN
    SELECT s.*, public.can_see_sale_id(s.id) AS visible INTO r
    FROM public.sales s WHERE s.id = p_id AND s.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      v_sale := r.id;
      SELECT left(COALESCE(NULLIF(btrim(ct.display_name), ''), 'Venta') || ' · '
                  || COALESCE(NULLIF(btrim(r.product_snapshot ->> 'product_name'), ''), NULLIF(btrim(r.product_snapshot ->> 'name'), ''), 'Producto')
                  || ' · ' || to_char(r.sale_date, 'DD/MM/YYYY'), 300)
        INTO v_label FROM public.contacts ct WHERE ct.id = r.contact_id;
      SELECT COALESCE(array_agg(p.id ORDER BY p.created_at, p.id), ARRAY[]::uuid[]) INTO v_payment_ids
      FROM public.payments p WHERE p.sale_id = p_id;
      SELECT COALESCE(array_agg(c.id ORDER BY c.created_at, c.id), ARRAY[]::uuid[]) INTO v_commission_ids
      FROM public.commissions c WHERE c.sale_id = p_id OR c.payment_id = ANY (v_payment_ids);
      v_roots := jsonb_build_array(
        jsonb_build_object('t', 'public.sales', 'ids', jsonb_build_array(p_id)),
        jsonb_build_object('t', 'public.payments', 'ids', to_jsonb(v_payment_ids)),
        jsonb_build_object('t', 'public.commissions', 'ids', to_jsonb(v_commission_ids)));
      IF EXISTS (SELECT 1 FROM public.contract_signatures cs WHERE cs.sale_id = p_id) THEN
        v_blockers := array_append(v_blockers, 'contract_signed');
      END IF;
      IF EXISTS (SELECT 1 FROM public.commissions c WHERE c.id = ANY (v_commission_ids) AND c.expense_id IS NOT NULL) THEN
        v_blockers := array_append(v_blockers, 'commission_in_expense');
      END IF;
      IF EXISTS (SELECT 1 FROM public.meta_capi_events m
                 WHERE m.workspace_id = p_workspace_id AND m.source_type = 'payment'
                   AND m.source_id = ANY (v_payment_ids) AND m.status = 'sent') THEN
        v_warnings := array_append(v_warnings, 'meta_sent');
      END IF;
      SELECT COALESCE(array_agg(sv.id), ARRAY[]::uuid[]) INTO v_ids FROM app_servicio.services sv WHERE sv.sale_id = p_id;
      IF cardinality(v_ids) > 0 THEN
        IF v_with_service THEN
          IF NOT private.trash_can(p_workspace_id, 'service') THEN
            v_blockers := array_append(v_blockers, 'service_needs_permission');
          ELSE
            v_roots := v_roots || jsonb_build_object('t', 'app_servicio.services', 'ids', to_jsonb(v_ids));
          END IF;
        ELSE
          v_warnings := array_append(v_warnings, 'service_stays');
        END IF;
        v_warnings := array_append(v_warnings, 'has_service');
      END IF;
      IF cardinality(v_commission_ids) > 0 THEN
        v_warnings := array_append(v_warnings, 'commissions_go');
      END IF;
    END IF;

  -- ── Pago ──────────────────────────────────────────────────
  WHEN 'payment' THEN
    SELECT p.*, public.can_see_sale_id(p.sale_id) AS visible INTO r
    FROM public.payments p WHERE p.id = p_id AND p.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_sale := r.sale_id;
      SELECT s.contact_id INTO v_contact FROM public.sales s WHERE s.id = r.sale_id;
      SELECT left('Pago · ' || COALESCE(NULLIF(btrim(ct.display_name), ''), 'Contacto') || ' · USD '
                  || to_char(r.amount, 'FM999G999G990D00') || ' · ' || to_char(COALESCE(r.paid_on, r.due_date), 'DD/MM/YYYY'), 300)
        INTO v_label FROM public.contacts ct WHERE ct.id = v_contact;
      -- El pago y sus reembolsos.
      SELECT COALESCE(array_agg(p.id ORDER BY p.created_at, p.id), ARRAY[]::uuid[]) INTO v_payment_ids
      FROM public.payments p WHERE p.id = p_id OR p.refund_of_payment_id = p_id;
      SELECT COALESCE(array_agg(c.id ORDER BY c.created_at, c.id), ARRAY[]::uuid[]) INTO v_commission_ids
      FROM public.commissions c WHERE c.payment_id = ANY (v_payment_ids);
      v_roots := jsonb_build_array(
        jsonb_build_object('t', 'public.payments', 'ids', to_jsonb(v_payment_ids)),
        jsonb_build_object('t', 'public.commissions', 'ids', to_jsonb(v_commission_ids)));
      IF EXISTS (SELECT 1 FROM public.commissions c WHERE c.id = ANY (v_commission_ids) AND c.expense_id IS NOT NULL) THEN
        v_blockers := array_append(v_blockers, 'commission_in_expense');
      END IF;
      IF EXISTS (SELECT 1 FROM public.meta_capi_events m
                 WHERE m.workspace_id = p_workspace_id AND m.source_type = 'payment'
                   AND m.source_id = ANY (v_payment_ids) AND m.status = 'sent') THEN
        v_warnings := array_append(v_warnings, 'meta_sent');
      END IF;
      IF cardinality(v_commission_ids) > 0 THEN
        v_warnings := array_append(v_warnings, 'commissions_go');
      END IF;
      IF cardinality(v_payment_ids) > 1 THEN
        v_warnings := array_append(v_warnings, 'refunds_go');
      END IF;
    END IF;

  -- ── Servicio ──────────────────────────────────────────────
  WHEN 'service' THEN
    SELECT sv.*, app_servicio.can_see_service(sv.id) AS visible INTO r
    FROM app_servicio.services sv WHERE sv.id = p_id AND sv.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      SELECT left(COALESCE(NULLIF(btrim(ct.display_name), ''), 'Cliente') || ' · '
                  || COALESCE(NULLIF(btrim(r.product_snapshot ->> 'product_name'), ''), NULLIF(btrim(r.product_snapshot ->> 'name'), ''), 'Servicio'), 300)
        INTO v_label FROM public.contacts ct WHERE ct.id = r.contact_id;
      v_roots := jsonb_build_array(jsonb_build_object('t', 'app_servicio.services', 'ids', jsonb_build_array(p_id)));
    END IF;

  -- ── Grabacion ─────────────────────────────────────────────
  WHEN 'call' THEN
    SELECT c.*, public.can_see_call_id(c.id) AS visible INTO r
    FROM public.calls c WHERE c.id = p_id AND c.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      v_label := left(COALESCE(NULLIF(btrim(r.title), ''), 'Grabación') || ' · '
                      || to_char(COALESCE(r.recorded_at, r.created_at), 'DD/MM/YYYY'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.calls', 'ids', jsonb_build_array(p_id)));
      IF r.external_id IS NOT NULL THEN
        v_external := jsonb_build_object('source', r.source, 'external_id', r.external_id);
        v_warnings := array_append(v_warnings, 'call_wont_return');
      END IF;
    END IF;

  -- ── Formulario ────────────────────────────────────────────
  WHEN 'form' THEN
    SELECT f.* INTO r FROM public.forms f WHERE f.id = p_id AND f.workspace_id = p_workspace_id;
    IF FOUND AND public.can_view_forms(p_workspace_id) THEN
      v_visible := true;
      v_label := left(COALESCE(NULLIF(btrim(r.name), ''), 'Formulario'), 300);
      SELECT COALESCE(array_agg(s.id ORDER BY s.created_at, s.id), ARRAY[]::uuid[]) INTO v_ids
      FROM public.form_submissions s WHERE s.form_id = p_id;
      v_roots := jsonb_build_array(
        jsonb_build_object('t', 'public.forms', 'ids', jsonb_build_array(p_id)),
        jsonb_build_object('t', 'public.form_submissions', 'ids', to_jsonb(v_ids)));
      IF EXISTS (SELECT 1 FROM public.contract_signatures cs WHERE cs.form_id = p_id) THEN
        v_blockers := array_append(v_blockers, 'contract_signed');
      END IF;
      IF cardinality(v_ids) > 0 THEN
        v_warnings := array_append(v_warnings, 'responses_go');
      END IF;
    END IF;

  -- ── Respuesta de formulario ───────────────────────────────
  WHEN 'form_submission' THEN
    SELECT s.*, public.can_see_form_submission(s) AS visible INTO r
    FROM public.form_submissions s WHERE s.id = p_id AND s.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      SELECT left(COALESCE(NULLIF(btrim(f.name), ''), 'Formulario') || ' · '
                  || COALESCE(NULLIF(btrim(ct.display_name), ''), 'Sin contacto') || ' · ' || to_char(r.created_at, 'DD/MM/YYYY'), 300)
        INTO v_label
      FROM public.forms f LEFT JOIN public.contacts ct ON ct.id = r.contact_id
      WHERE f.id = r.form_id;
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.form_submissions', 'ids', jsonb_build_array(p_id)));
      IF EXISTS (SELECT 1 FROM public.contract_signatures cs WHERE cs.submission_id = p_id) THEN
        v_blockers := array_append(v_blockers, 'contract_signed');
      END IF;
      IF r.contact_id IS NOT NULL THEN
        v_warnings := array_append(v_warnings, 'contact_stays');
      END IF;
    END IF;

  -- ── Reporte de fin de dia ─────────────────────────────────
  WHEN 'eod_report' THEN
    SELECT e.* INTO r FROM public.eod_reports e WHERE e.id = p_id AND e.workspace_id = p_workspace_id;
    IF FOUND THEN
      v_visible := true;
      SELECT left('Fin de día · ' || COALESCE(NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 'Persona del equipo')
                  || ' · ' || to_char(r.report_date, 'DD/MM/YYYY'), 300)
        INTO v_label FROM auth.users u WHERE u.id = r.user_id;
      v_label := COALESCE(v_label, 'Fin de día · ' || to_char(r.report_date, 'DD/MM/YYYY'));
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.eod_reports', 'ids', jsonb_build_array(p_id)));
    END IF;

  -- ── Gasto ─────────────────────────────────────────────────
  WHEN 'expense' THEN
    SELECT x.* INTO r FROM public.expenses x WHERE x.id = p_id AND x.workspace_id = p_workspace_id;
    IF FOUND THEN
      v_visible := true;
      v_label := left(COALESCE(NULLIF(btrim(r.concept), ''), 'Gasto') || ' · USD ' || to_char(r.amount, 'FM999G999G990D00'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.expenses', 'ids', jsonb_build_array(p_id)));
      IF r.origin NOT IN ('manual', 'adjustment') THEN
        v_blockers := array_append(v_blockers, 'expense_automatic');
      END IF;
    END IF;

  -- ── Comision ──────────────────────────────────────────────
  WHEN 'commission' THEN
    SELECT c.*, public.can_see_commission(c) AS visible INTO r
    FROM public.commissions c WHERE c.id = p_id AND c.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_label := left('Comisión · ' || COALESCE(NULLIF(btrim(r.role), ''), 'ajuste') || ' · USD ' || to_char(r.amount, 'FM999G999G990D00'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.commissions', 'ids', jsonb_build_array(p_id)));
      IF r.expense_id IS NOT NULL THEN
        v_blockers := array_append(v_blockers, 'commission_in_expense');
      END IF;
      IF r.kind = 'earned' AND r.voided_at IS NULL THEN
        v_warnings := array_append(v_warnings, 'commission_may_return');
      END IF;
    END IF;

  -- ── Producto ──────────────────────────────────────────────
  WHEN 'product' THEN
    SELECT pr.* INTO r FROM public.products pr WHERE pr.id = p_id AND pr.workspace_id = p_workspace_id;
    IF FOUND THEN
      v_visible := true;
      v_label := left(COALESCE(NULLIF(btrim(r.name), ''), 'Producto'), 300);
      SELECT COALESCE(array_agg(v.id ORDER BY v.display_order, v.id), ARRAY[]::uuid[]) INTO v_ids
      FROM public.product_variants v WHERE v.product_id = p_id;
      v_roots := jsonb_build_array(
        jsonb_build_object('t', 'public.products', 'ids', jsonb_build_array(p_id)),
        jsonb_build_object('t', 'public.product_variants', 'ids', to_jsonb(v_ids)));
      IF EXISTS (SELECT 1 FROM public.sales s WHERE s.product_variant_id = ANY (v_ids)) THEN
        v_blockers := array_append(v_blockers, 'product_sold');
      END IF;
      -- El producto de interes de un contacto se suelta (y vuelve al restaurar).
      v_nullify := jsonb_build_array(
        jsonb_build_object('t', 'public.contacts', 'col', 'interest_variant_id', 'match', to_jsonb(v_ids)),
        jsonb_build_object('t', 'public.contacts', 'col', 'interest_product_id', 'match', jsonb_build_array(p_id)));
    END IF;

  -- ── Pieza e idea de contenido ─────────────────────────────
  WHEN 'content_post' THEN
    SELECT cp.* INTO r FROM public.content_posts cp WHERE cp.id = p_id AND cp.workspace_id = p_workspace_id;
    IF FOUND THEN
      v_visible := true;
      v_label := left(COALESCE(NULLIF(btrim(r.title), ''), 'Pieza de contenido'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.content_posts', 'ids', jsonb_build_array(p_id)));
      IF EXISTS (SELECT 1 FROM public.social_posts sp WHERE sp.content_post_id = p_id AND sp.status IN ('scheduled', 'publishing', 'uploading')) THEN
        v_blockers := array_append(v_blockers, 'content_scheduled');
      END IF;
      IF EXISTS (SELECT 1 FROM public.social_posts sp WHERE sp.content_post_id = p_id AND sp.status = 'published') THEN
        v_warnings := array_append(v_warnings, 'content_published');
      END IF;
    END IF;

  WHEN 'content_idea' THEN
    SELECT ci.* INTO r FROM public.content_ideas ci WHERE ci.id = p_id AND ci.workspace_id = p_workspace_id;
    IF FOUND THEN
      v_visible := true;
      v_label := left(COALESCE(NULLIF(btrim(r.title), ''), 'Idea de contenido'), 300);
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.content_ideas', 'ids', jsonb_build_array(p_id)));
    END IF;

  -- ── Conversacion ──────────────────────────────────────────
  WHEN 'conversation' THEN
    SELECT cv.*, public.can_see_conversation(cv) AS visible INTO r
    FROM public.conversations cv WHERE cv.id = p_id AND cv.workspace_id = p_workspace_id;
    IF FOUND AND r.visible THEN
      v_visible := true;
      v_contact := r.contact_id;
      SELECT left(COALESCE(NULLIF(btrim(ct.display_name), ''), 'Contacto') || ' · ' || COALESCE(r.platform, 'chat'), 300)
        INTO v_label FROM public.contacts ct WHERE ct.id = r.contact_id;
      v_roots := jsonb_build_array(jsonb_build_object('t', 'public.conversations', 'ids', jsonb_build_array(p_id)));
      v_warnings := array_append(v_warnings, 'conversation_reopens');
    END IF;

  ELSE
    RETURN jsonb_build_object('found', false);
  END CASE;

  IF NOT v_visible THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'label', COALESCE(v_label, p_entity),
    'roots', v_roots,
    'nullify', v_nullify,
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings),
    'contact_id', v_contact,
    'sale_id', v_sale,
    'external', v_external);
END;
$$;

REVOKE ALL ON FUNCTION private.trash_plan(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Recalculos despues de borrar o restaurar plata
-- ------------------------------------------------------------

-- La marca «Cliente» que puso un cobro: se quita si no queda ningun cobro de ese contacto,
-- y vuelve si al restaurar hay uno. Una marca puesta a mano no se toca.
CREATE OR REPLACE FUNCTION private.trash_sync_customer(p_workspace_id uuid, p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_paid boolean;
BEGIN
  IF p_contact_id IS NULL THEN RETURN; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
    WHERE s.contact_id = p_contact_id AND s.workspace_id = p_workspace_id AND p.status = 'paid' AND p.amount > 0
  ) INTO v_paid;

  IF v_paid THEN
    UPDATE public.contacts SET is_customer = true, customer_marked_by = NULL, customer_marked_at = now(), customer_source = 'sale'
    WHERE id = p_contact_id AND workspace_id = p_workspace_id AND deleted_at IS NULL AND NOT is_customer;
  ELSE
    UPDATE public.contacts SET is_customer = false, customer_marked_by = NULL, customer_marked_at = NULL, customer_source = NULL
    WHERE id = p_contact_id AND workspace_id = p_workspace_id AND is_customer AND customer_source = 'sale';
  END IF;
END;
$$;

-- La comision del procesador del mes se recalcula con el trabajo diario de Finanzas.
CREATE OR REPLACE FUNCTION private.trash_enqueue_finance(p_workspace_id uuid, p_tag text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day date;
BEGIN
  BEGIN
    SELECT (now() AT TIME ZONE COALESCE(NULLIF(w.timezone, ''), 'UTC'))::date INTO v_day FROM public.workspaces w WHERE w.id = p_workspace_id;
  EXCEPTION WHEN OTHERS THEN
    v_day := (now() AT TIME ZONE 'UTC')::date;
  END;
  INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
  VALUES ('finance_daily', jsonb_build_object('workspace_id', p_workspace_id, 'local_date', v_day::text, 'manual', true), now(),
          'finance_daily:' || p_workspace_id::text || ':' || v_day::text || ':trash:' || p_tag)
  ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  -- Recalcular nunca puede costar el borrado: el trabajo diario lo corrige igual.
  RAISE WARNING 'trash_enqueue_finance: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION private.trash_sync_customer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_enqueue_finance(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Vista previa
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trash_preview(p_workspace_id uuid, p_entity text, p_id uuid, p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_capture jsonb;
  v_blockers jsonb;
  v_link jsonb;
  v_count bigint;
BEGIN
  IF NOT public.is_workspace_member(p_workspace_id) OR NOT private.trash_can(p_workspace_id, p_entity) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  v_plan := private.trash_plan(p_workspace_id, p_entity, p_id, COALESCE(p_options, '{}'::jsonb));
  IF NOT (v_plan ->> 'found')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  v_capture := private.trash_capture(v_plan -> 'roots');
  v_blockers := v_plan -> 'blockers';
  -- Lo que se suelta antes de borrar (por ejemplo, el producto de interes) no bloquea.
  SELECT v_blockers || COALESCE(jsonb_agg('in_use:' || (b ->> 't')), '[]'::jsonb) INTO v_blockers
  FROM jsonb_array_elements(v_capture -> 'blockers') AS b
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_plan -> 'nullify') AS n WHERE n ->> 't' = b ->> 't');

  RETURN jsonb_build_object(
    'ok', true,
    'label', v_plan ->> 'label',
    'counts', v_capture -> 'counts',
    'blockers', COALESCE((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements(v_blockers) AS x), '[]'::jsonb),
    'warnings', v_plan -> 'warnings');
END;
$$;

REVOKE ALL ON FUNCTION public.trash_preview(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_preview(uuid, text, uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Eliminar
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trash_delete(p_workspace_id uuid, p_entity text, p_id uuid, p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_capture jsonb;
  v_blocker jsonb;
  v_null jsonb;
  v_rel regclass;
  v_pk text[];
  v_rows jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_item uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_workspace_member(p_workspace_id) OR NOT private.trash_can(p_workspace_id, p_entity) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  -- Doble clic o dos personas a la vez: la segunda espera y despues ya no lo encuentra.
  PERFORM pg_advisory_xact_lock(hashtextextended('trash:' || p_entity || ':' || p_id::text, 0));

  v_plan := private.trash_plan(p_workspace_id, p_entity, p_id, COALESCE(p_options, '{}'::jsonb));
  IF NOT (v_plan ->> 'found')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF jsonb_array_length(v_plan -> 'blockers') > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'blockers', v_plan -> 'blockers');
  END IF;

  -- Antes de la foto: lo que hay que hacer con el registro todavia vivo.
  -- Los recordatorios y avisos pendientes de una reunion eliminada no salen.
  IF p_entity = 'booking' THEN
    UPDATE public.scheduled_jobs SET status = 'cancelled'
    WHERE status = 'pending' AND payload ->> 'booking_id' = p_id::text;
  END IF;

  -- Lo que se suelta (y vuelve al restaurar).
  FOR v_null IN SELECT value FROM jsonb_array_elements(v_plan -> 'nullify') LOOP
    CONTINUE WHEN jsonb_array_length(COALESCE(v_null -> 'match', '[]'::jsonb)) = 0;
    v_rel := (v_null ->> 't')::regclass;
    v_pk := private.trash_pk(v_rel);
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(jsonb_build_object(''t'', %L, ''pk'', private.trash_pick(to_jsonb(c), $2), ''set'', jsonb_build_object(%L, c.%I))), ''[]''::jsonb) '
      'FROM %s AS c WHERE c.workspace_id = $3 AND c.%I = ANY (SELECT (x #>> ''{}'')::uuid FROM jsonb_array_elements($1) AS x)',
      v_rel::text, v_null ->> 'col', v_null ->> 'col', v_rel, v_null ->> 'col')
      INTO v_rows USING v_null -> 'match', v_pk, p_workspace_id;
    v_relinks := v_relinks || v_rows;
    EXECUTE format(
      'UPDATE %s AS c SET %I = NULL WHERE c.workspace_id = $2 AND c.%I = ANY (SELECT (x #>> ''{}'')::uuid FROM jsonb_array_elements($1) AS x)',
      v_rel, v_null ->> 'col', v_null ->> 'col')
      USING v_null -> 'match', p_workspace_id;
  END LOOP;

  v_capture := private.trash_capture(v_plan -> 'roots');
  FOR v_blocker IN SELECT value FROM jsonb_array_elements(v_capture -> 'blockers') LOOP
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'blockers', jsonb_build_array('in_use:' || (v_blocker ->> 't')));
  END LOOP;

  INSERT INTO private.trash_items (workspace_id, entity, entity_id, label, snapshot, counts, deleted_by)
  VALUES (
    p_workspace_id, p_entity, p_id, v_plan ->> 'label',
    jsonb_build_object(
      'v', 1,
      'entries', v_capture -> 'entries',
      'relinks', (v_capture -> 'relinks') || v_relinks,
      'contact_id', v_plan -> 'contact_id',
      'sale_id', v_plan -> 'sale_id',
      'external', v_plan -> 'external'),
    v_capture -> 'counts',
    v_actor)
  RETURNING id INTO v_item;

  PERFORM private.trash_delete_roots(v_plan -> 'roots');

  -- Despues: lo que depende de lo que ya no esta.
  IF p_entity IN ('sale', 'payment') THEN
    IF p_entity = 'payment' AND (v_plan ->> 'sale_id') IS NOT NULL THEN
      PERFORM public.refresh_sale_status((v_plan ->> 'sale_id')::uuid);
    END IF;
    PERFORM private.trash_sync_customer(p_workspace_id, (v_plan ->> 'contact_id')::uuid);
    PERFORM private.trash_enqueue_finance(p_workspace_id, v_item::text);
  ELSIF p_entity = 'call' AND v_plan -> 'external' IS NOT NULL AND jsonb_typeof(v_plan -> 'external') = 'object' THEN
    INSERT INTO public.calls_deleted_external (workspace_id, source, external_id)
    VALUES (p_workspace_id, v_plan -> 'external' ->> 'source', v_plan -> 'external' ->> 'external_id')
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by, actor_type)
  VALUES (p_workspace_id, p_entity, p_id, 'trash.deleted',
          jsonb_build_object('trash_item_id', v_item, 'counts', v_capture -> 'counts', 'options', COALESCE(p_options, '{}'::jsonb)),
          v_actor, 'user');

  RETURN jsonb_build_object('ok', true, 'item_id', v_item, 'counts', v_capture -> 'counts');
END;
$$;

REVOKE ALL ON FUNCTION public.trash_delete(uuid, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_delete(uuid, text, uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. Restaurar
-- ------------------------------------------------------------
-- Codigos: forbidden, not_found, expired, busy (una tabla ocupada: reintentar), missing_parent:<tabla>,
-- conflict (unico o superposicion).

CREATE OR REPLACE FUNCTION public.trash_restore(p_workspace_id uuid, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item private.trash_items;
  v_actor uuid := auth.uid();
  v_msg text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_workspace_member(p_workspace_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT * INTO v_item FROM private.trash_items t
  WHERE t.id = p_item_id AND t.workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND OR v_item.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF NOT private.trash_can(p_workspace_id, v_item.entity) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;
  IF v_item.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  BEGIN
    PERFORM private.trash_restore_snapshot(v_item.snapshot);
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN jsonb_build_object('ok', false, 'code', 'busy');
    WHEN foreign_key_violation THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      IF v_msg LIKE 'trash_missing_parent:%' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'missing_parent:' || substr(v_msg, length('trash_missing_parent:') + 1));
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'conflict');
    WHEN unique_violation OR exclusion_violation OR check_violation OR not_null_violation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END;

  UPDATE private.trash_items SET restored_at = now(), restored_by = v_actor WHERE id = v_item.id;

  IF v_item.entity IN ('sale', 'payment') THEN
    IF v_item.entity = 'payment' AND (v_item.snapshot ->> 'sale_id') IS NOT NULL THEN
      PERFORM public.refresh_sale_status((v_item.snapshot ->> 'sale_id')::uuid);
    END IF;
    PERFORM private.trash_sync_customer(p_workspace_id, (v_item.snapshot ->> 'contact_id')::uuid);
    PERFORM private.trash_enqueue_finance(p_workspace_id, v_item.id::text || ':restore');
  ELSIF v_item.entity = 'call' AND jsonb_typeof(v_item.snapshot -> 'external') = 'object' THEN
    DELETE FROM public.calls_deleted_external
    WHERE workspace_id = p_workspace_id
      AND source = v_item.snapshot -> 'external' ->> 'source'
      AND external_id = v_item.snapshot -> 'external' ->> 'external_id';
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by, actor_type)
  VALUES (p_workspace_id, v_item.entity, v_item.entity_id, 'trash.restored',
          jsonb_build_object('trash_item_id', v_item.id), v_actor, 'user');

  RETURN jsonb_build_object('ok', true, 'entity', v_item.entity, 'entity_id', v_item.entity_id);
END;
$$;

REVOKE ALL ON FUNCTION public.trash_restore(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_restore(uuid, uuid) TO authenticated, service_role;
