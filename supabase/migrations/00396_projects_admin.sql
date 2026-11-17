-- @plantilla-quitar(proyectos)
-- ============================================================================
-- 00396_projects_admin  (Corrida C · C2: lo que usa el equipo en el panel, F79–F81, F118, F120)
-- ============================================================================
-- El esquema `app_servicio_proyectos` está cerrado: el equipo lee y escribe SOLO con estas funciones, que validan el
-- negocio, el permiso y que la extensión esté prendida (apagada devuelven vacío o SV005).
--
--   Lectura (services.view):
--     projects_admin_payments(product, filter, limit)   Pagos reportados: all · unverified · no_receipt.
--     projects_admin_projects(product)                  Todos los proyectos del programa.
--     projects_admin_fame(product, period)              Sala de la fama con nombres (fame.manage o services.view).
--     projects_admin_service(service)                   Ficha del servicio › Proyectos e ingresos (F79).
--     projects_admin_contact_revenue(contact)           «Facturación como builder» de la ficha del cliente (F81).
--     projects_admin_ideas(product)                     Banco de ideas (projects.templates).
--   Escritura:
--     projects_admin_payment_add(service, p)            Cargar un pago a nombre del estudiante (student_revenue.manage).
--     projects_admin_payment_verify(entry, verified)    Verificar / quitar la verificación (student_revenue.manage).
--     projects_admin_adjust_total(service, target, why) Ajustar el total: un `adjustment` por la diferencia (F79).
--     projects_admin_request_receipt(entry)             «Pedir comprobante» (F120): marca el pago y queda en audit_log.
--     projects_admin_save_idea(id, p)                   Crear o editar una idea (projects.templates).
--     projects_admin_save_workbench(product, patch, rev) Mesa de trabajo (F118): pasos y rangos; cada texto que cambia
--                                                        suma 1 a su versión y deja el anterior y el nuevo en audit_log.
--   `portal_admin_save_program_settings`: la clave `fame` pide `fame.manage`; `projects` se guarda solo desde la Mesa
--   de trabajo (así el revisor y las versiones no se pisan).
--   Columna nueva: `student_revenue_entries.receipt_requested_at` (el aviso al estudiante lo lee el portal, C3).
--
-- Volver atrás: DROP FUNCTION de las 13 funciones nuevas; portal_admin_save_program_settings de la 00381;
--   ALTER TABLE app_servicio_proyectos.student_revenue_entries DROP COLUMN receipt_requested_at.
-- ============================================================================

ALTER TABLE app_servicio_proyectos.student_revenue_entries ADD COLUMN IF NOT EXISTS receipt_requested_at timestamptz NULL;

-- El producto del negocio con la extensión prendida y el permiso pedido. Devuelve el workspace.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.admin_product(p_product_id uuid, p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() THEN
    IF NOT public.is_workspace_member(v_ws) THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
    PERFORM app_servicio.require_permission(v_ws, p_permission);
  END IF;
  IF NOT app_servicio_proyectos.enabled(v_ws) THEN RAISE EXCEPTION 'La extensión de proyectos está apagada' USING ERRCODE = 'SV005'; END IF;
  RETURN v_ws;
END;
$$;

-- El estado de un pago para mostrar: verified · pending · no_receipt (adjustment: verified).
CREATE OR REPLACE FUNCTION app_servicio_proyectos.payment_state(r app_servicio_proyectos.student_revenue_entries)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN r.kind = 'adjustment' OR r.verified_at IS NOT NULL THEN 'verified'
              WHEN r.receipt_path IS NULL THEN 'no_receipt' ELSE 'pending' END;
$$;

-- ─── Lectura ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.projects_admin_payments(p_product_id uuid, p_filter text DEFAULT 'all', p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_proyectos.admin_product(p_product_id, 'services.view');
BEGIN
  RETURN jsonb_build_object(
    'counts', (SELECT jsonb_build_object('unverified', count(*) FILTER (WHERE app_servicio_proyectos.payment_state(r) = 'pending'),
                                         'no_receipt', count(*) FILTER (WHERE app_servicio_proyectos.payment_state(r) = 'no_receipt'))
                 FROM app_servicio_proyectos.student_revenue_entries r WHERE r.product_id = p_product_id AND r.deleted_at IS NULL),
    'rows', COALESCE((SELECT jsonb_agg(x ORDER BY x ->> 'received_on' DESC, x ->> 'created_at' DESC) FROM (
      SELECT jsonb_build_object('id', r.id, 'contact_id', r.contact_id, 'name', c.display_name, 'kind', r.kind, 'title', r.title,
               'description', r.description, 'amount_cents', r.amount_cents, 'currency', r.currency, 'received_on', r.received_on,
               'before_program', r.before_program, 'project_title', pj.title, 'state', app_servicio_proyectos.payment_state(r),
               'has_receipt', r.receipt_path IS NOT NULL, 'receipt_requested_at', r.receipt_requested_at, 'entered_by_kind', r.entered_by_kind,
               'adjust_reason', r.adjust_reason, 'created_at', r.created_at,
               'service_id', (SELECT s.id FROM app_servicio.services s WHERE s.contact_id = r.contact_id AND s.product_id = r.product_id
                               ORDER BY (s.status IN ('active', 'paused')) DESC, s.created_at DESC LIMIT 1)) AS x
        FROM app_servicio_proyectos.student_revenue_entries r
        JOIN public.contacts c ON c.id = r.contact_id
        LEFT JOIN app_servicio_proyectos.student_projects pj ON pj.id = r.project_id
       WHERE r.product_id = p_product_id AND r.workspace_id = v_ws AND r.deleted_at IS NULL
         AND (COALESCE(p_filter, 'all') = 'all'
              OR (p_filter = 'unverified' AND app_servicio_proyectos.payment_state(r) = 'pending')
              OR (p_filter = 'no_receipt' AND app_servicio_proyectos.payment_state(r) = 'no_receipt'))
       ORDER BY r.received_on DESC, r.created_at DESC
       LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000)) q), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_projects(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_proyectos.admin_product(p_product_id, 'services.view');
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pj.id, 'contact_id', pj.contact_id, 'name', c.display_name, 'kind', pj.kind,
             'title', pj.title, 'status', pj.status, 'client', pj.client ->> 'company', 'sold_cents', pj.sold_cents, 'closed_on', pj.closed_on,
             'steps_done', (SELECT count(*) FROM jsonb_each(COALESCE(pj.builder -> 'steps', '{}'::jsonb)) s WHERE s.value ->> 'state' = 'done'),
             'current_step', pj.builder ->> 'current_step', 'paid_cents',
             (SELECT COALESCE(sum(r.amount_cents), 0) FROM app_servicio_proyectos.student_revenue_entries r WHERE r.project_id = pj.id AND r.deleted_at IS NULL),
             'updated_at', pj.updated_at) ORDER BY pj.updated_at DESC)
    FROM app_servicio_proyectos.student_projects pj JOIN public.contacts c ON c.id = pj.contact_id
   WHERE pj.product_id = p_product_id AND pj.workspace_id = v_ws AND pj.archived_at IS NULL), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_fame(p_product_id uuid, p_period text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF NOT app_servicio.is_system() AND v_ws IS NOT NULL AND public.is_workspace_member(v_ws) AND NOT public.has_permission(v_ws, 'fame.manage') THEN
    v_ws := app_servicio_proyectos.admin_product(p_product_id, 'services.view');
  ELSE
    v_ws := app_servicio_proyectos.admin_product(p_product_id, 'fame.manage');
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', f ->> 'contact_id', 'name', c.display_name,
             'amount_cents', (f ->> 'amount_cents')::bigint, 'projects_won', (f ->> 'projects_won')::integer,
             'show_amount', COALESCE(a.show_amount_in_fame, false)) ORDER BY o)
    FROM jsonb_array_elements(app_servicio_proyectos.fame_ranking(p_product_id, p_period)) WITH ORDINALITY x(f, o)
    JOIN public.contacts c ON c.id = (f ->> 'contact_id')::uuid
    LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id AND a.workspace_id = v_ws), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_service(p_service_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR (NOT app_servicio.is_system() AND NOT app_servicio.can_see_service(p_service_id)) THEN
    RAISE EXCEPTION 'No existe el servicio' USING ERRCODE = 'SV002';
  END IF;
  PERFORM app_servicio_proyectos.admin_product(s.product_id, 'services.view');
  RETURN jsonb_build_object(
    'totals', COALESCE((SELECT to_jsonb(t) - 'workspace_id' - 'contact_id' - 'product_id' FROM app_servicio_proyectos.student_revenue_totals t
                         WHERE t.contact_id = s.contact_id AND t.product_id = s.product_id), '{}'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pj.id, 'kind', pj.kind, 'title', pj.title, 'description', pj.description,
                 'status', pj.status, 'client', pj.client, 'sold_cents', pj.sold_cents, 'closed_on', pj.closed_on, 'phases', pj.phases,
                 'builder', pj.builder, 'updated_at', pj.updated_at) ORDER BY pj.updated_at DESC)
      FROM app_servicio_proyectos.student_projects pj WHERE pj.contact_id = s.contact_id AND pj.product_id = s.product_id AND pj.archived_at IS NULL), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'amount_cents', r.amount_cents,
                 'received_on', r.received_on, 'project_id', r.project_id, 'state', app_servicio_proyectos.payment_state(r),
                 'has_receipt', r.receipt_path IS NOT NULL, 'before_program', r.before_program, 'adjust_reason', r.adjust_reason,
                 'entered_by_kind', r.entered_by_kind) ORDER BY r.received_on DESC, r.created_at DESC)
      FROM app_servicio_proyectos.student_revenue_entries r WHERE r.contact_id = s.contact_id AND r.product_id = s.product_id AND r.deleted_at IS NULL), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_contact_revenue(p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.contacts;
BEGIN
  SELECT * INTO c FROM public.contacts WHERE id = p_contact_id;
  IF c.id IS NULL OR NOT app_servicio_proyectos.enabled(c.workspace_id) THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(c.workspace_id) AND public.has_permission(c.workspace_id, 'services.view')
                                           AND public.can_see_contact(c)) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT jsonb_build_object('total_cents', COALESCE(sum(t.total_cents), 0), 'verified_cents', COALESCE(sum(t.verified_cents), 0))
            FROM app_servicio_proyectos.student_revenue_totals t WHERE t.contact_id = c.id AND t.workspace_id = c.workspace_id
          HAVING count(*) > 0);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_ideas(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_proyectos.admin_product(p_product_id, 'projects.templates');
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'product_id', i.product_id, 'industry', i.industry, 'title', i.title,
             'description', i.description, 'size', i.size, 'active', i.active) ORDER BY i.active DESC, i.industry NULLS LAST, i.title)
    FROM app_servicio_proyectos.project_ideas i
   WHERE i.workspace_id = v_ws AND (i.product_id IS NULL OR i.product_id = p_product_id)), '[]'::jsonb);
END;
$$;

-- ─── Escritura ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.projects_admin_payment_add(p_service_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_id uuid;
  v_amount numeric := (p ->> 'amount_cents')::numeric;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR (NOT app_servicio.is_system() AND NOT app_servicio.can_see_service(p_service_id)) THEN
    RAISE EXCEPTION 'No existe el servicio' USING ERRCODE = 'SV002';
  END IF;
  PERFORM app_servicio_proyectos.admin_product(s.product_id, 'student_revenue.manage');
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR char_length(btrim(COALESCE(p ->> 'title', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Escribí un título para el pago' USING ERRCODE = 'SV001';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> trunc(v_amount) THEN RAISE EXCEPTION 'El monto tiene que ser mayor que cero' USING ERRCODE = 'SV001'; END IF;
  IF (p ->> 'received_on') IS NULL OR (p ->> 'received_on') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Elegí la fecha del pago' USING ERRCODE = 'SV001'; END IF;
  INSERT INTO app_servicio_proyectos.student_revenue_entries (workspace_id, contact_id, product_id, project_id, project_phase_key, kind, title, description,
              amount_cents, currency, received_on, before_program, entered_by_kind, entered_by, verified_at, verified_by)
  VALUES (s.workspace_id, s.contact_id, s.product_id, NULLIF(p ->> 'project_id', '')::uuid, NULLIF(p ->> 'project_phase_key', ''), 'payment',
          btrim(p ->> 'title'), NULLIF(btrim(COALESCE(p ->> 'description', '')), ''), v_amount::bigint, NULLIF(p ->> 'currency', ''),
          (p ->> 'received_on')::date, COALESCE((p ->> 'before_program')::boolean, false), 'team', auth.uid(), now(), auth.uid())
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'projects.payment_added', jsonb_build_object('entry_id', v_id, 'amount_cents', v_amount));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_payment_verify(p_entry_id uuid, p_verified boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r app_servicio_proyectos.student_revenue_entries;
BEGIN
  SELECT * INTO r FROM app_servicio_proyectos.student_revenue_entries WHERE id = p_entry_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No existe el pago' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio_proyectos.admin_product(r.product_id, 'student_revenue.manage');
  IF r.kind = 'adjustment' THEN RAISE EXCEPTION 'Un ajuste no se verifica' USING ERRCODE = 'SV001'; END IF;
  UPDATE app_servicio_proyectos.student_revenue_entries
     SET verified_at = CASE WHEN p_verified THEN COALESCE(verified_at, now()) END,
         verified_by = CASE WHEN p_verified THEN COALESCE(verified_by, auth.uid()) END
   WHERE id = r.id;
  PERFORM app_servicio.audit(r.workspace_id, 'contact', r.contact_id, CASE WHEN p_verified THEN 'projects.payment_verified' ELSE 'projects.payment_unverified' END,
                             jsonb_build_object('entry_id', r.id, 'amount_cents', r.amount_cents));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_adjust_total(p_service_id uuid, p_target_cents bigint, p_reason text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_now bigint;
  v_diff bigint;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR (NOT app_servicio.is_system() AND NOT app_servicio.can_see_service(p_service_id)) THEN
    RAISE EXCEPTION 'No existe el servicio' USING ERRCODE = 'SV002';
  END IF;
  PERFORM app_servicio_proyectos.admin_product(s.product_id, 'student_revenue.manage');
  IF p_target_cents IS NULL OR p_target_cents < 0 THEN RAISE EXCEPTION 'El total no puede ser negativo' USING ERRCODE = 'SV001'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 1000 THEN RAISE EXCEPTION 'Escribí el motivo del ajuste' USING ERRCODE = 'SV001'; END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO v_now FROM app_servicio_proyectos.student_revenue_entries
   WHERE contact_id = s.contact_id AND product_id = s.product_id AND deleted_at IS NULL;
  v_diff := p_target_cents - v_now;
  IF v_diff = 0 THEN RETURN v_now; END IF;
  INSERT INTO app_servicio_proyectos.student_revenue_entries (workspace_id, contact_id, product_id, kind, title, amount_cents, received_on,
              entered_by_kind, entered_by, adjust_reason)
  VALUES (s.workspace_id, s.contact_id, s.product_id, 'adjustment', 'Ajuste del total', v_diff,
          (now() AT TIME ZONE app_servicio.ws_tz(s.workspace_id))::date, 'team', auth.uid(), btrim(p_reason));
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'projects.total_adjusted',
                             jsonb_build_object('before_cents', v_now, 'after_cents', p_target_cents, 'reason', btrim(p_reason)));
  RETURN p_target_cents;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_request_receipt(p_entry_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r app_servicio_proyectos.student_revenue_entries;
BEGIN
  SELECT * INTO r FROM app_servicio_proyectos.student_revenue_entries WHERE id = p_entry_id AND deleted_at IS NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No existe el pago' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio_proyectos.admin_product(r.product_id, 'student_revenue.manage');
  IF r.kind <> 'payment' OR r.receipt_path IS NOT NULL OR r.verified_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ese pago no necesita comprobante' USING ERRCODE = 'SV001';
  END IF;
  UPDATE app_servicio_proyectos.student_revenue_entries SET receipt_requested_at = now() WHERE id = r.id;
  PERFORM app_servicio.audit(r.workspace_id, 'contact', r.contact_id, 'projects.receipt_requested',
                             jsonb_build_object('entry_id', r.id, 'title', r.title, 'amount_cents', r.amount_cents));
  -- Para el email: a quién y qué (lo manda el panel con el Resend del negocio).
  RETURN jsonb_build_object('contact_id', r.contact_id, 'title', r.title, 'amount_cents', r.amount_cents, 'received_on', r.received_on,
    'email', (SELECT a.email FROM app_servicio_portal.portal_accounts a WHERE a.contact_id = r.contact_id AND a.workspace_id = r.workspace_id AND a.status <> 'suspended'));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.projects_admin_save_idea(p_idea_id uuid, p_product_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_proyectos.admin_product(p_product_id, 'projects.templates');
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR char_length(btrim(COALESCE(p ->> 'title', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Escribí la idea' USING ERRCODE = 'SV001';
  END IF;
  IF NOT COALESCE(p ->> 'size' = ANY (ARRAY['small', 'medium', 'large']), false) THEN RAISE EXCEPTION 'Elegí el tamaño: chico, mediano o grande' USING ERRCODE = 'SV001'; END IF;
  IF p_idea_id IS NULL THEN
    INSERT INTO app_servicio_proyectos.project_ideas (workspace_id, product_id, industry, title, description, size, active, created_by)
    VALUES (v_ws, CASE WHEN COALESCE((p ->> 'all_programs')::boolean, false) THEN NULL ELSE p_product_id END,
            NULLIF(btrim(COALESCE(p ->> 'industry', '')), ''), btrim(p ->> 'title'), NULLIF(btrim(COALESCE(p ->> 'description', '')), ''),
            p ->> 'size', COALESCE((p ->> 'active')::boolean, true), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE app_servicio_proyectos.project_ideas
       SET industry = NULLIF(btrim(COALESCE(p ->> 'industry', '')), ''), title = btrim(p ->> 'title'),
           description = NULLIF(btrim(COALESCE(p ->> 'description', '')), ''), size = p ->> 'size',
           active = COALESCE((p ->> 'active')::boolean, active)
     WHERE id = p_idea_id AND workspace_id = v_ws AND (product_id IS NULL OR product_id = p_product_id)
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'No existe la idea' USING ERRCODE = 'SV002'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- Mesa de trabajo (F118). El parche trae `steps` y/o `budget_ranges`; el revisor no se toca. Por cada paso, si el
-- texto del prompt o del análisis cambió, su versión sube 1 (la que venga en el parche no cuenta) y el texto anterior
-- y el nuevo quedan en audit_log (`projects.template_saved`).
CREATE OR REPLACE FUNCTION app_servicio.projects_admin_save_workbench(p_product_id uuid, p_patch jsonb, p_rev integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid := app_servicio_proyectos.admin_product(p_product_id, 'projects.templates');
  v_row public.products;
  v_old jsonb;
  v_new jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_audits jsonb := '[]'::jsonb;
  st jsonb; prev jsonb; part text; t jsonb; ot jsonb; a jsonb;
  v_problems text[];
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('steps', 'budget_ranges')) THEN
    RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001';
  END IF;
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  v_old := COALESCE(v_row.portal_settings -> 'projects', '{}'::jsonb);
  v_new := v_old || p_patch;
  IF p_patch ? 'steps' AND jsonb_typeof(p_patch -> 'steps') = 'array' THEN
    FOR st IN SELECT x FROM jsonb_array_elements(p_patch -> 'steps') x LOOP
      IF jsonb_typeof(st) = 'object' THEN
        SELECT x INTO prev FROM jsonb_array_elements(COALESCE(v_old -> 'steps', '[]'::jsonb)) x WHERE x ->> 'key' = st ->> 'key' LIMIT 1;
        FOREACH part IN ARRAY ARRAY['prompt', 'analysis'] LOOP
          t := st -> part;
          ot := prev -> part;
          IF jsonb_typeof(t) = 'object' THEN
            IF jsonb_typeof(ot) = 'object' AND (ot ->> 'text') IS NOT DISTINCT FROM (t ->> 'text') THEN
              st := jsonb_set(st, ARRAY[part, 'version'], COALESCE(ot -> 'version', '1'::jsonb));
            ELSE
              st := jsonb_set(st, ARRAY[part, 'version'], to_jsonb(COALESCE((ot ->> 'version')::integer, 0) + 1));
              v_audits := v_audits || jsonb_build_array(jsonb_build_object('step', st ->> 'key', 'part', part,
                'version', COALESCE((ot ->> 'version')::integer, 0) + 1, 'before', ot ->> 'text', 'after', t ->> 'text'));
            END IF;
          END IF;
        END LOOP;
      END IF;
      v_steps := v_steps || jsonb_build_array(st);
    END LOOP;
    v_new := jsonb_set(v_new, '{steps}', v_steps);
  END IF;
  -- El parche solo trae steps y budget_ranges: el revisor queda como estaba.
  v_problems := app_servicio_proyectos.projects_settings_problems(v_new);
  IF array_length(v_problems, 1) > 0 THEN RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems)); END IF;
  UPDATE public.products
     SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{projects}', v_new), portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_product_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings -> 'projects', 'rev', v_row.portal_settings_rev);
  END IF;
  FOR a IN SELECT x FROM jsonb_array_elements(v_audits) x LOOP
    PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'projects.template_saved', a);
  END LOOP;
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$$;

-- La configuración del programa: `fame` pide fame.manage; `projects` va por la Mesa de trabajo.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.products;
  v_new jsonb;
  v_problems text[];
  k text;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  IF p_patch ? 'projects' THEN RAISE EXCEPTION 'Mis proyectos se configura desde la Mesa de trabajo' USING ERRCODE = 'SV001'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    PERFORM app_servicio.require_permission(v_row.workspace_id, CASE k
      WHEN 'sections' THEN 'portal.sections'
      WHEN 'terms' THEN 'portal.sections'
      WHEN 'affiliates' THEN 'portal.sections'
      WHEN 'community' THEN 'community.spaces'
      WHEN 'assistant' THEN 'tutor.manage'
      WHEN 'points' THEN 'portal.points'
      WHEN 'fame' THEN 'fame.manage'
      ELSE 'portal.sections' END);
  END LOOP;
  v_new := COALESCE(v_row.portal_settings, '{}'::jsonb) || p_patch;
  v_problems := app_servicio.validate_program_portal_settings(v_new, p_product_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.products
     SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_product_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product', p_product_id, 'svc.config_saved',
          jsonb_build_object('part', 'program', 'keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION app_servicio_proyectos.admin_product(uuid, text), app_servicio_proyectos.payment_state(app_servicio_proyectos.student_revenue_entries)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION
  app_servicio.projects_admin_payments(uuid, text, integer), app_servicio.projects_admin_projects(uuid), app_servicio.projects_admin_fame(uuid, text),
  app_servicio.projects_admin_service(uuid), app_servicio.projects_admin_contact_revenue(uuid), app_servicio.projects_admin_ideas(uuid),
  app_servicio.projects_admin_payment_add(uuid, jsonb), app_servicio.projects_admin_payment_verify(uuid, boolean),
  app_servicio.projects_admin_adjust_total(uuid, bigint, text), app_servicio.projects_admin_request_receipt(uuid),
  app_servicio.projects_admin_save_idea(uuid, uuid, jsonb), app_servicio.projects_admin_save_workbench(uuid, jsonb, integer)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  app_servicio.projects_admin_payments(uuid, text, integer), app_servicio.projects_admin_projects(uuid), app_servicio.projects_admin_fame(uuid, text),
  app_servicio.projects_admin_service(uuid), app_servicio.projects_admin_contact_revenue(uuid), app_servicio.projects_admin_ideas(uuid),
  app_servicio.projects_admin_payment_add(uuid, jsonb), app_servicio.projects_admin_payment_verify(uuid, boolean),
  app_servicio.projects_admin_adjust_total(uuid, bigint, text), app_servicio.projects_admin_request_receipt(uuid),
  app_servicio.projects_admin_save_idea(uuid, uuid, jsonb), app_servicio.projects_admin_save_workbench(uuid, jsonb, integer)
TO authenticated, service_role;
