-- ============================================================
-- 00369_service_items_lock_evidence.sql
-- ============================================================
-- Servicios A4 (plano: A4-M4), F138 (regla de guardado), F146, F147 y F148:
--
--   * El camino acepta, DENTRO de `ref` (como el boton de A2; se copian solos al servicio):
--       ref.lock      = {from: service_created|service_start|phase_start, days: 0..365} | {after_item_key}
--       ref.evidence  = {required: true, kinds: [file|link|note]}         (solo team_task, student_task, checkbox)
--       ref.checklist = ["texto", ...]                                   (solo team_task, student_task; <= 20 x <= 200)
--       ref.complete_on = 'recorded'                                     (solo pasos Reunion)
--     Reescribe `journey_item_ref_problems` (lo de siempre igual + las reglas nuevas al final, mismo orden que
--     `a4RefProblems` de lib/services/journey-template.ts) y `validate_journey_template` (+ «solo puede esperar a uno
--     anterior»). Casos en `journey-template.cases.json`, contra TS y SQL.
--   * `app_servicio.svc_lock_plan(jsonb)`: gemela pura de `lockPlan` (lib/services/lock.ts, `lock.cases.json`).
--     `svc_item_lock_state(item)` arma la entrada (las fechas con `svc_due_date`, que no se toca).
--   * `service_items.evidence` = [{id, kind, path?, url?, text?, by, at}] (hasta 10). Bucket privado `service-evidence`
--     (10 MB, PNG/JPG/WEBP/PDF; sin politicas: lee y escribe el servidor). Se escribe solo con `svc_add_evidence` y
--     `svc_remove_evidence` (services.items con su alcance, o tasks.edit desde la tarea del paso; solo lo propio y con
--     el paso pendiente).
--   * Completar a mano (`svc_complete_item`) y «Completar un paso» de una automatizacion (`svc_mark_item` con source
--     'automation') respetan el bloqueo (SV033) y la evidencia (SV034): `svc_assert_completable`. Lo que hizo el cliente
--     (formulario, agenda, grabacion, programa) se completa igual y queda `svc.item_completed_while_locked`.
--   * `svc_ensure_task`: la tarea del paso nace con su `service_id` y el checklist del paso (sin tildar).
--   * SV030 y SV031 ya los usa `svc_extend_plan`: el bloqueo es SV033 y la evidencia SV034.
--
-- Antes de aplicarla: ningun camino guardado usa lock, evidence, checklist ni 'recorded' (son nuevos), asi que
-- ninguna variante queda invalida.
--
-- Como volver atras: las definiciones viejas de las cinco funciones que reescribe estan en
-- docs/servicios/definiciones-viejas-a4.sql (copiadas de la base antes de aplicarla): correr esas cinco. Las columnas,
-- el bucket y las funciones nuevas se pueden dejar (nadie las lee sin el codigo nuevo), o:
--   DROP FUNCTION IF EXISTS app_servicio.svc_add_evidence(uuid, jsonb), app_servicio.svc_remove_evidence(uuid, uuid),
--     app_servicio.svc_assert_completable(uuid), app_servicio.svc_item_lock_state(uuid), app_servicio.svc_lock_plan(jsonb),
--     app_servicio.svc_item_evidence_missing(uuid);
--   ALTER TABLE app_servicio.service_items DROP COLUMN IF EXISTS evidence;
--   DELETE FROM storage.buckets WHERE id = 'service-evidence' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'service-evidence');

ALTER TABLE app_servicio.service_items ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_items_evidence_check') THEN
    ALTER TABLE app_servicio.service_items ADD CONSTRAINT service_items_evidence_check
      CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 10);
  END IF;
END $$;
COMMENT ON COLUMN app_servicio.service_items.evidence IS
  'La evidencia del paso (Servicios A4, F147): [{id, kind: file|link|note, path?, url?, text?, by, at}], hasta 10. Se escribe con svc_add_evidence / svc_remove_evidence.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('service-evidence', 'service-evidence', false, 10485760, ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','application/pdf'];

-- ─── El bloqueo (pura) ──────────────────────────────────────────────────────
-- input: {lock, anchors: {serviceCreated, serviceStart, phaseStart}, today, completedKeys}
CREATE OR REPLACE FUNCTION app_servicio.svc_lock_plan(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  l jsonb := p -> 'lock';
  v_until date;
  v_unlocked jsonb := jsonb_build_object('locked', false, 'until', NULL, 'waiting_item_key', NULL);
BEGIN
  IF l IS NULL OR jsonb_typeof(l) <> 'object' THEN RETURN v_unlocked; END IF;
  IF jsonb_typeof(l -> 'after_item_key') = 'string' AND (l ->> 'after_item_key') <> '' THEN
    IF COALESCE(p -> 'completedKeys', '[]'::jsonb) ? (l ->> 'after_item_key') THEN RETURN v_unlocked; END IF;
    RETURN jsonb_build_object('locked', true, 'until', NULL, 'waiting_item_key', l ->> 'after_item_key');
  END IF;
  IF NOT COALESCE(l ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start']), false) THEN RETURN v_unlocked; END IF;
  v_until := app_servicio.svc_due_date(
    jsonb_build_object('from', l ->> 'from', 'days', COALESCE(round((l ->> 'days')::numeric)::integer, 0)),
    jsonb_build_object('serviceCreated', p #>> '{anchors,serviceCreated}', 'serviceStart', p #>> '{anchors,serviceStart}',
                       'phaseStart', p #>> '{anchors,phaseStart}', 'itemCompleted', NULL));
  IF v_until IS NULL THEN RETURN jsonb_build_object('locked', true, 'until', NULL, 'waiting_item_key', NULL); END IF;
  IF (p ->> 'today')::date < v_until THEN
    RETURN jsonb_build_object('locked', true, 'until', to_char(v_until, 'YYYY-MM-DD'), 'waiting_item_key', NULL);
  END IF;
  RETURN v_unlocked;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_lock_plan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.svc_lock_plan(jsonb) TO service_role;

-- El estado del bloqueo de un paso: {locked, until, waiting_item_key}.
CREATE OR REPLACE FUNCTION app_servicio.svc_item_lock_state(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ref jsonb; v_service uuid; v_phase uuid; v_ws uuid;
  v_created timestamptz; v_start date; v_phase_start timestamptz;
  v_done jsonb;
BEGIN
  SELECT i.ref, i.service_id, i.phase_id, i.workspace_id INTO v_ref, v_service, v_phase, v_ws
    FROM app_servicio.service_items i WHERE i.id = p_item_id;
  IF v_ref IS NULL OR jsonb_typeof(v_ref -> 'lock') IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('locked', false, 'until', NULL, 'waiting_item_key', NULL);
  END IF;
  SELECT s.created_at, s.starts_on INTO v_created, v_start FROM app_servicio.services s WHERE s.id = v_service;
  SELECT ph.started_at INTO v_phase_start FROM app_servicio.service_phases ph WHERE ph.id = v_phase;
  SELECT COALESCE(jsonb_agg(DISTINCT i.template_key), '[]'::jsonb) INTO v_done
    FROM app_servicio.service_items i WHERE i.service_id = v_service AND i.status = 'completed' AND i.template_key IS NOT NULL;
  RETURN app_servicio.svc_lock_plan(jsonb_build_object(
    'lock', v_ref -> 'lock',
    'anchors', jsonb_build_object(
      'serviceCreated', to_char(app_servicio.local_date(v_created, v_ws), 'YYYY-MM-DD'),
      'serviceStart', to_char(v_start, 'YYYY-MM-DD'),
      'phaseStart', to_char(app_servicio.local_date(v_phase_start, v_ws), 'YYYY-MM-DD')),
    'today', to_char(app_servicio.local_date(now(), v_ws), 'YYYY-MM-DD'),
    'completedKeys', v_done));
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_item_lock_state(uuid) FROM PUBLIC, anon, authenticated;
-- Solo el servidor: no miran permisos (las llaman las funciones del modulo, que corren como su dueño).
GRANT EXECUTE ON FUNCTION app_servicio.svc_item_lock_state(uuid) TO service_role;

-- Si al paso le falta la evidencia que pide.
CREATE OR REPLACE FUNCTION app_servicio.svc_item_evidence_missing(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT i.ref -> 'evidence' ->> 'required' = 'true'
       AND jsonb_typeof(i.ref -> 'evidence' -> 'kinds') = 'array'
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(i.evidence, '[]'::jsonb)) e
          WHERE (i.ref -> 'evidence' -> 'kinds') ? (e ->> 'kind'))
      FROM app_servicio.service_items i WHERE i.id = p_item_id), false);
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_item_evidence_missing(uuid) FROM PUBLIC, anon, authenticated;
-- Solo el servidor: no miran permisos (las llaman las funciones del modulo, que corren como su dueño).
GRANT EXECUTE ON FUNCTION app_servicio.svc_item_evidence_missing(uuid) TO service_role;

-- Frena completar a mano un paso bloqueado (SV033) o que pide evidencia sin tenerla (SV034).
CREATE OR REPLACE FUNCTION app_servicio.svc_assert_completable(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock jsonb := app_servicio.svc_item_lock_state(p_item_id);
  v_name text;
BEGIN
  IF (v_lock ->> 'locked')::boolean THEN
    IF v_lock ->> 'waiting_item_key' IS NOT NULL THEN
      SELECT o.name INTO v_name FROM app_servicio.service_items i JOIN app_servicio.service_items o
        ON o.service_id = i.service_id AND o.template_key = v_lock ->> 'waiting_item_key'
       WHERE i.id = p_item_id ORDER BY o.occurrence_index NULLS FIRST LIMIT 1;
      RAISE EXCEPTION 'Este paso se puede completar cuando se complete «%».', COALESCE(v_name, 'otro paso') USING ERRCODE = 'SV033';
    ELSIF v_lock ->> 'until' IS NOT NULL THEN
      RAISE EXCEPTION 'Este paso se puede completar desde el %.', to_char((v_lock ->> 'until')::date, 'DD/MM') USING ERRCODE = 'SV033';
    ELSE
      RAISE EXCEPTION 'Este paso todavía no se puede completar.' USING ERRCODE = 'SV033';
    END IF;
  END IF;
  IF app_servicio.svc_item_evidence_missing(p_item_id) THEN
    RAISE EXCEPTION 'Este paso pide evidencia: adjuntá una captura, un link o una nota.' USING ERRCODE = 'SV034';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_assert_completable(uuid) FROM PUBLIC, anon, authenticated;
-- Solo el servidor: no miran permisos (las llaman las funciones del modulo, que corren como su dueño).
GRANT EXECUTE ON FUNCTION app_servicio.svc_assert_completable(uuid) TO service_role;

-- Quien puede adjuntar o quitar evidencia: services.items con su alcance, o tasks.edit viendo la tarea del paso.
CREATE OR REPLACE FUNCTION app_servicio.svc_require_evidence_access(p_item_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  IF NOT public.is_workspace_member(s.workspace_id) THEN RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004'; END IF;
  BEGIN
    PERFORM app_servicio.svc_require_item(s, it);
    RETURN;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  IF it.task_id IS NOT NULL AND public.can_see_task_id(it.task_id) AND public.can_edit_tasks(s.workspace_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_require_evidence_access(uuid) FROM PUBLIC, anon, authenticated;

-- Adjunta una evidencia (la arma el servidor despues de validar los bytes y subir el archivo). Devuelve la entrada.
CREATE OR REPLACE FUNCTION app_servicio.svc_add_evidence(p_item_id uuid, p_entry jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  it app_servicio.service_items;
  v_kind text := p_entry ->> 'kind';
  v_new jsonb;
BEGIN
  PERFORM app_servicio.svc_require_evidence_access(p_item_id);
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.status <> 'pending' THEN RAISE EXCEPTION 'El paso ya está completo' USING ERRCODE = 'SV002'; END IF;
  IF jsonb_array_length(COALESCE(it.evidence, '[]'::jsonb)) >= 10 THEN RAISE EXCEPTION 'Un paso tiene hasta 10 evidencias' USING ERRCODE = 'SV001'; END IF;
  IF v_kind = 'file' THEN
    IF COALESCE(p_entry ->> 'path', '') NOT LIKE it.workspace_id::text || '/' || it.service_id::text || '/' || it.id::text || '/%'
       OR (p_entry ->> 'path') LIKE '%..%' THEN
      RAISE EXCEPTION 'El archivo no es de este paso' USING ERRCODE = 'SV001';
    END IF;
    v_new := jsonb_build_object('kind', 'file', 'path', p_entry ->> 'path');
  ELSIF v_kind = 'link' THEN
    IF COALESCE(p_entry ->> 'url', '') !~ '^https://\S+$' OR char_length(p_entry ->> 'url') > 2000 THEN
      RAISE EXCEPTION 'El link tiene que empezar con https://' USING ERRCODE = 'SV001';
    END IF;
    v_new := jsonb_build_object('kind', 'link', 'url', p_entry ->> 'url');
  ELSIF v_kind = 'note' THEN
    IF btrim(COALESCE(p_entry ->> 'text', '')) = '' OR char_length(p_entry ->> 'text') > 2000 THEN
      RAISE EXCEPTION 'La nota tiene que tener entre 1 y 2000 caracteres' USING ERRCODE = 'SV001';
    END IF;
    v_new := jsonb_build_object('kind', 'note', 'text', btrim(p_entry ->> 'text'));
  ELSE
    RAISE EXCEPTION 'Tipo de evidencia desconocido' USING ERRCODE = 'SV001';
  END IF;
  v_new := v_new || jsonb_build_object('id', gen_random_uuid(), 'by', auth.uid(), 'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  UPDATE app_servicio.service_items SET evidence = COALESCE(evidence, '[]'::jsonb) || jsonb_build_array(v_new) WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'service_item', it.id, 'svc.evidence_added',
    jsonb_build_object('service_id', it.service_id, 'item_key', it.template_key, 'kind', v_kind), 'user');
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_add_evidence(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_add_evidence(uuid, jsonb) TO authenticated, service_role;

-- Quita una evidencia: solo la propia y con el paso pendiente. Devuelve la entrada quitada (para borrar el archivo).
CREATE OR REPLACE FUNCTION app_servicio.svc_remove_evidence(p_item_id uuid, p_evidence_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  it app_servicio.service_items;
  v_old jsonb;
BEGIN
  PERFORM app_servicio.svc_require_evidence_access(p_item_id);
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.status <> 'pending' THEN RAISE EXCEPTION 'Con el paso completo, la evidencia ya no se quita' USING ERRCODE = 'SV002'; END IF;
  SELECT e INTO v_old FROM jsonb_array_elements(COALESCE(it.evidence, '[]'::jsonb)) e WHERE e ->> 'id' = p_evidence_id::text LIMIT 1;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Esa evidencia ya no está' USING ERRCODE = 'SV002'; END IF;
  IF (v_old ->> 'by') IS DISTINCT FROM auth.uid()::text THEN RAISE EXCEPTION 'Solo podés quitar lo que adjuntaste' USING ERRCODE = 'SV004'; END IF;
  UPDATE app_servicio.service_items
     SET evidence = COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(evidence) e WHERE e ->> 'id' <> p_evidence_id::text), '[]'::jsonb)
   WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'service_item', it.id, 'svc.evidence_removed',
    jsonb_build_object('service_id', it.service_id, 'item_key', it.template_key, 'kind', v_old ->> 'kind'), 'user');
  RETURN v_old;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.svc_remove_evidence(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_remove_evidence(uuid, uuid) TO authenticated, service_role;

-- ─── Las funciones reescritas (las viejas, en docs/servicios/definiciones-viejas-a4.sql) ─────────────

CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_kind text := p_item ->> 'kind';
  v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
  v_co text := v_ref ->> 'complete_on';
  v_form jsonb;
  v_want text;
  v_grading boolean;
  v_ok boolean;
  -- F125: el boton y «ver su respuesta».
  v_link_kind boolean := v_kind = ANY (ARRAY['team_task','student_task','checkbox']);
  v_btn jsonb;
  v_label jsonb;
  v_url jsonb;
  v_url_ok boolean := false;
  v_url_bad boolean := false;
  -- A4 (00369).
  v_lock jsonb;
  v_ev jsonb;
BEGIN
  IF v_kind = ANY (ARRAY['form','survey','contract','activity','quiz']) THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'form_id') THEN
      v := v || format('«%s»: elegí el formulario', p_nm);
    ELSE
      IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (CASE v_kind
          WHEN 'form' THEN ARRAY['submitted','reviewed'] WHEN 'survey' THEN ARRAY['submitted','reviewed']
          WHEN 'contract' THEN ARRAY['submitted'] WHEN 'activity' THEN ARRAY['submitted','reviewed','passed']
          ELSE ARRAY['passed','finished'] END), false) THEN
        v := v || format('«%s»: elegí cuándo se completa', p_nm);
      END IF;
      IF p_ws IS NOT NULL THEN
        SELECT to_jsonb(f) INTO v_form FROM public.forms f WHERE f.id = (v_ref ->> 'form_id')::uuid AND f.workspace_id = p_ws;
        IF v_form IS NULL THEN
          v := v || format('«%s»: el formulario no existe', p_nm);
        ELSE
          v_want := CASE v_kind WHEN 'form' THEN 'custom' ELSE v_kind END;
          IF v_form ->> 'type' IS DISTINCT FROM v_want THEN v := v || format('«%s»: el formulario no es del tipo del paso', p_nm); END IF;
          IF v_kind IN ('quiz','activity') AND p_product IS NOT NULL AND (v_form ->> 'product_id') IS DISTINCT FROM p_product::text THEN
            v := v || CASE v_kind WHEN 'quiz' THEN 'la evaluación tiene que ser de este programa' ELSE 'la actividad tiene que ser de este programa' END;
          END IF;
          IF v_kind = 'activity' AND v_co = 'passed' THEN
            SELECT COALESCE((fv.definition #>> '{grading,enabled}')::boolean, false) INTO v_grading
              FROM public.form_versions fv WHERE fv.id = (v_form ->> 'current_version_id')::uuid;
            IF NOT COALESCE(v_grading, false) THEN v := v || format('«%s»: «al aprobar» necesita una actividad con calificación', p_nm); END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  ELSIF v_kind = 'booking' THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'event_type_id') THEN
      v := v || format('«%s»: elegí el tipo de reunión', p_nm);
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_types e WHERE e.id = (v_ref ->> 'event_type_id')::uuid AND e.workspace_id = p_ws) THEN
      v := v || format('«%s»: el tipo de reunión no existe', p_nm);
    END IF;
    IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended','recorded']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
  ELSIF v_kind IN ('program_item','open_module') THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'program_item_id') THEN
      v := v || format('«%s»: elegí el módulo o la clase', p_nm);
    ELSIF p_product IS NOT NULL THEN
      v_ok := false;
      IF to_regclass('app_servicio.program_items') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = $1 AND product_id = $2)'
          INTO v_ok USING (v_ref ->> 'program_item_id')::uuid, p_product;
      END IF;
      IF NOT v_ok THEN v := v || format('«%s»: el módulo o la clase no es de este programa', p_nm); END IF;
    END IF;
  ELSIF v_kind = 'certificate' THEN
    IF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
      v := v || 'Elegí la plantilla del certificado'::text;
    ELSIF p_ws IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.design_templates t WHERE t.id = (v_ref ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado'
    ) THEN
      v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
    END IF;
  ELSIF v_kind = 'open_section' THEN
    IF NOT COALESCE(v_ref ->> 'section' = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
      v := v || format('«%s»: elegí la sección', p_nm);
    END IF;
  END IF;

  -- ── El boton del paso (F125). Mismo orden que buttonProblems (TS). ──
  IF v_ref ? 'button' THEN
    v_btn := v_ref -> 'button';
    IF jsonb_typeof(v_btn) IS DISTINCT FROM 'object' THEN
      v := v || format('«%s»: el botón no es válido', p_nm);
    ELSE
      v_label := v_btn -> 'label';
      IF v_label IS NOT NULL AND jsonb_typeof(v_label) <> 'null' AND v_label <> '""'::jsonb THEN
        IF jsonb_typeof(v_label) <> 'string' OR char_length(v_label #>> '{}') > 40 OR (v_label #>> '{}') ~ '[\r\n]' THEN
          v := v || format('«%s»: el texto del botón tiene hasta 40 caracteres, en una línea', p_nm);
        END IF;
      END IF;
      v_url := v_btn -> 'url';
      IF v_url IS NOT NULL AND jsonb_typeof(v_url) <> 'null' AND v_url <> '""'::jsonb THEN
        IF NOT v_link_kind THEN
          v := v || format('«%s»: este paso ya lleva a su destino', p_nm);
        ELSIF jsonb_typeof(v_url) <> 'string' OR (v_url #>> '{}') !~ '^https://\S+$' OR char_length(v_url #>> '{}') > 2000 THEN
          v := v || format('«%s»: el link del botón tiene que empezar con https:// y no llevar espacios', p_nm);
          v_url_bad := true;
        ELSE
          v_url_ok := true;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p_item -> 'portal_button' = 'true'::jsonb THEN
    IF p_item -> 'visible_to_client' = 'false'::jsonb THEN
      v := v || format('«%s»: para mostrar el botón, el cliente tiene que ver el paso', p_nm);
    ELSIF v_link_kind AND NOT v_url_ok AND NOT v_url_bad THEN
      v := v || format('«%s»: pegá el link del botón', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'show_response' THEN
    IF jsonb_typeof(v_ref -> 'show_response') <> 'boolean' THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» no es válido', p_nm);
    ELSIF NOT (v_kind = ANY (ARRAY['form','survey','activity','quiz','contract'])) THEN
      v := v || format('«%s»: «El cliente puede ver su respuesta» es solo para pasos con formulario', p_nm);
    END IF;
  END IF;
  -- ── Servicios A4 (00369): bloqueo, evidencia, checklist y «cuando hay grabacion». Mismo orden que a4RefProblems (TS). ──
  IF v_co = 'recorded' AND v_kind <> 'booking' THEN
    v := v || format('«%s»: «cuando hay grabación» es solo para pasos Reunión', p_nm);
  END IF;
  IF v_ref ? 'lock' THEN
    v_lock := v_ref -> 'lock';
    IF NOT (
         (jsonb_typeof(v_lock) = 'object' AND jsonb_typeof(v_lock -> 'after_item_key') = 'string'
          AND (v_lock ->> 'after_item_key') ~ '^it_[a-z0-9]{6}$' AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 1)
      OR (jsonb_typeof(v_lock) = 'object' AND COALESCE(v_lock ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start']), false)
          AND app_servicio.j_int(v_lock -> 'days') AND app_servicio.j_num(v_lock -> 'days') BETWEEN 0 AND 365
          AND (SELECT count(*) FROM jsonb_object_keys(v_lock)) = 2)
    ) THEN
      v := v || format('«%s»: el bloqueo no es válido', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'evidence' THEN
    v_ev := v_ref -> 'evidence';
    IF NOT (v_kind = ANY (ARRAY['team_task','student_task','checkbox'])) THEN
      v := v || format('«%s»: la evidencia es solo para tareas y casillas', p_nm);
    ELSIF jsonb_typeof(v_ev) IS DISTINCT FROM 'object' OR v_ev -> 'required' IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_ev -> 'kinds') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ev -> 'kinds') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ev -> 'kinds') k WHERE NOT COALESCE(k #>> '{}' = ANY (ARRAY['file','link','note']), false) OR jsonb_typeof(k) <> 'string')
       OR (SELECT count(DISTINCT k #>> '{}') FROM jsonb_array_elements(v_ev -> 'kinds') k) <> jsonb_array_length(v_ev -> 'kinds') THEN
      v := v || format('«%s»: elegí qué evidencia pide', p_nm);
    END IF;
  END IF;
  IF v_ref ? 'checklist' THEN
    IF NOT (v_kind = ANY (ARRAY['team_task','student_task'])) THEN
      v := v || format('«%s»: el checklist es solo para tareas', p_nm);
    ELSIF jsonb_typeof(v_ref -> 'checklist') IS DISTINCT FROM 'array' OR jsonb_array_length(v_ref -> 'checklist') > 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_ref -> 'checklist') c
                  WHERE jsonb_typeof(c) <> 'string' OR btrim(c #>> '{}') = '' OR char_length(c #>> '{}') > 200) THEN
      v := v || format('«%s»: el checklist tiene hasta 20 puntos de hasta 200 caracteres', p_nm);
    END IF;
  END IF;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v text[] := ARRAY[]::text[];
  v_ws uuid; v_product uuid;
  ph jsonb; it jsonb; due jsonb; lt jsonb; ch jsonb; ll jsonb;
  v_phase_keys text[] := ARRAY[]::text[];
  v_item_keys text[] := ARRAY[]::text[];
  v_before text[] := ARRAY[]::text[];
  v_name text; v_label text; v_nm text; v_key text;
  y numeric; r numeric; d numeric;
  v_has_rule boolean;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['el camino tiene que ser un objeto']; END IF;
  IF p_variant_id IS NOT NULL THEN
    SELECT pv.workspace_id, pv.product_id INTO v_ws, v_product FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','future_visibility','phases']);
  IF p -> 'v' IS DISTINCT FROM '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'future_visibility' AND NOT COALESCE(p ->> 'future_visibility' = ANY (ARRAY['names','names_and_descriptions','hidden']), false) THEN
    v := v || 'elegí qué ve el cliente de las fases que vienen'::text;
  END IF;
  IF jsonb_typeof(p -> 'phases') IS DISTINCT FROM 'array' THEN RETURN v || 'faltan las fases'::text; END IF;

  FOR ph IN SELECT x FROM jsonb_array_elements(p -> 'phases') x LOOP
    IF jsonb_typeof(ph) <> 'object' THEN v := v || 'hay una fase que no es válida'::text; CONTINUE; END IF;
    v := v || app_servicio.unknown_keys(ph, ARRAY['key','name','duration_days','yellow_day','red_day','advance','challenge','late_light','items']);
    v_key := CASE WHEN jsonb_typeof(ph -> 'key') = 'string' THEN ph ->> 'key' END;
    IF v_key IS NULL OR v_key !~ '^ph_[a-z0-9]{6}$' THEN v := v || 'hay una fase con una clave inválida'::text;
    ELSIF v_key = ANY (v_phase_keys) THEN v := v || format('la clave %s está repetida', v_key);
    ELSE v_phase_keys := v_phase_keys || v_key;
    END IF;
    v_name := CASE WHEN jsonb_typeof(ph -> 'name') = 'string' THEN btrim(ph ->> 'name') ELSE '' END;
    IF v_name = '' THEN v := v || 'hay una fase sin nombre'::text; END IF;
    v_label := CASE WHEN v_name = '' THEN 'la fase' ELSE v_name END;
    IF NOT (ph -> 'duration_days' IS NULL OR jsonb_typeof(ph -> 'duration_days') = 'null'
            OR (app_servicio.j_int(ph -> 'duration_days') AND app_servicio.j_num(ph -> 'duration_days') >= 0))
       OR app_servicio.j_num(ph -> 'duration_days') = 0 THEN
      v := v || format('«%s»: la duración tiene que ser mayor a cero', v_label);
    END IF;
    IF NOT (ph -> 'yellow_day' IS NULL OR jsonb_typeof(ph -> 'yellow_day') = 'null' OR (app_servicio.j_int(ph -> 'yellow_day') AND app_servicio.j_num(ph -> 'yellow_day') >= 0))
       OR NOT (ph -> 'red_day' IS NULL OR jsonb_typeof(ph -> 'red_day') = 'null' OR (app_servicio.j_int(ph -> 'red_day') AND app_servicio.j_num(ph -> 'red_day') >= 0)) THEN
      v := v || format('«%s»: los días de amarillo y rojo tienen que ser enteros', v_label);
    ELSE
      y := CASE WHEN app_servicio.j_int(ph -> 'yellow_day') THEN app_servicio.j_num(ph -> 'yellow_day') END;
      r := CASE WHEN app_servicio.j_int(ph -> 'red_day') THEN app_servicio.j_num(ph -> 'red_day') END;
      d := CASE WHEN app_servicio.j_int(ph -> 'duration_days') THEN app_servicio.j_num(ph -> 'duration_days') END;
      IF y IS NOT NULL AND r IS NOT NULL AND y >= r THEN v := v || format('«%s»: el amarillo tiene que ser antes que el rojo', v_label); END IF;
      IF r IS NOT NULL AND d IS NOT NULL AND r > d THEN v := v || format('«%s»: el rojo no puede pasar la duración de la fase', v_label); END IF;
    END IF;
    IF ph ? 'advance' AND NOT COALESCE(ph ->> 'advance' = ANY (ARRAY['auto','auto_all','manual']), false) THEN v := v || format('«%s»: elegí cómo avanza', v_label); END IF;
    ch := ph -> 'challenge';
    IF ch IS NOT NULL AND jsonb_typeof(ch) <> 'null' THEN
      IF jsonb_typeof(ch) <> 'object' THEN v := v || format('«%s»: el Reto no es válido', v_label);
      ELSIF ch -> 'enabled' = 'true'::jsonb THEN
        IF NOT COALESCE(ch ->> 'start' = ANY (ARRAY['previous_phase','student','automation','fixed_date']), false) THEN v := v || format('«%s»: elegí cómo empieza el Reto', v_label); END IF;
        IF ch ->> 'start' = 'fixed_date' AND NOT app_servicio.j_date(ch -> 'fixed_date') THEN v := v || format('«%s»: elegí la fecha del Reto', v_label); END IF;
      END IF;
    END IF;
    ll := ph -> 'late_light';
    IF ll IS NOT NULL AND jsonb_typeof(ll) <> 'null' THEN
      IF jsonb_typeof(ll) <> 'object' THEN v := v || format('«%s»: el semáforo por entregas no es válido', v_label);
      ELSIF ll -> 'enabled' = 'true'::jsonb AND NOT (
        app_servicio.j_int(ll -> 'yellow_at') AND app_servicio.j_num(ll -> 'yellow_at') >= 1
        AND app_servicio.j_int(ll -> 'red_at') AND app_servicio.j_num(ll -> 'red_at') >= app_servicio.j_num(ll -> 'yellow_at')) THEN
        v := v || format('«%s»: el rojo por entregas tiene que ser igual o mayor que el amarillo', v_label);
      END IF;
    END IF;
    IF jsonb_typeof(ph -> 'items') IS DISTINCT FROM 'array' THEN v := v || format('«%s»: faltan los pasos', v_label); CONTINUE; END IF;

    FOR it IN SELECT x FROM jsonb_array_elements(ph -> 'items') x LOOP
      IF jsonb_typeof(it) <> 'object' THEN v := v || format('«%s»: hay un paso que no es válido', v_label); CONTINUE; END IF;
      v_nm := CASE WHEN jsonb_typeof(it -> 'name') = 'string' THEN it ->> 'name' ELSE 'el paso' END;
      v := v || app_servicio.unknown_keys(it, ARRAY['key','kind','name','description','required','assignee','assignee_user_id','visible_to_client',
        'portal_button','ref','due_rule','light','recurrence','late','reminders']);
      v_key := CASE WHEN jsonb_typeof(it -> 'key') = 'string' THEN it ->> 'key' END;
      IF v_key IS NULL OR v_key !~ '^it_[a-z0-9]{6}$' THEN v := v || 'hay un paso con una clave inválida'::text;
      ELSIF v_key = ANY (v_item_keys) THEN v := v || format('la clave %s está repetida', v_key);
      ELSE v_item_keys := v_item_keys || v_key;
      END IF;
      IF NOT COALESCE(it ->> 'kind' = ANY (ARRAY['form','survey','contract','booking','quiz','activity','program_item','team_task','student_task',
          'certificate','open_section','open_module','checkbox']), false) THEN
        v := v || format('«%s»: tipo de paso desconocido', v_nm);
        CONTINUE;
      END IF;
      IF NOT (jsonb_typeof(it -> 'name') = 'string' AND btrim(it ->> 'name') <> '') THEN v := v || 'hay un paso sin nombre'::text; END IF;
      IF it ? 'assignee' AND NOT COALESCE(it ->> 'assignee' = ANY (ARRAY['student','owner','user']), false) THEN v := v || format('«%s»: elegí a cargo de quién está', v_nm); END IF;
      IF it ->> 'assignee' = 'user' AND NOT app_servicio.j_uuid(it -> 'assignee_user_id') THEN v := v || format('«%s»: elegí la persona a cargo', v_nm); END IF;
      v := v || app_servicio.journey_item_ref_problems(it, v_nm, v_ws, v_product);
      -- A4 (F146): «cuando se complete otro paso» solo puede esperar a uno ANTERIOR (sin ciclos).
      IF jsonb_typeof(it -> 'ref' -> 'lock') = 'object' AND (it -> 'ref' -> 'lock' ->> 'after_item_key') ~ '^it_[a-z0-9]{6}$'
         AND NOT ((it -> 'ref' -> 'lock' ->> 'after_item_key') = ANY (v_before)) THEN
        v := v || format('«%s»: un paso solo puede esperar a uno anterior', v_nm);
      END IF;

      due := it -> 'due_rule';
      IF due IS NOT NULL AND jsonb_typeof(due) <> 'null' THEN
        IF jsonb_typeof(due) <> 'object' OR NOT COALESCE(due ->> 'from' = ANY (ARRAY['service_created','service_start','phase_start','item_completed']), false)
           OR NOT (app_servicio.j_int(due -> 'days') AND app_servicio.j_num(due -> 'days') BETWEEN 0 AND 3650) THEN
          v := v || format('«%s»: el plazo no es válido', v_nm);
        ELSIF due ->> 'from' = 'item_completed' THEN
          IF jsonb_typeof(due -> 'item_key') IS DISTINCT FROM 'string' OR NOT ((due ->> 'item_key') = ANY (v_before)) THEN
            v := v || 'un paso solo puede depender de uno anterior'::text;
          END IF;
        END IF;
      END IF;
      v := v || app_servicio.journey_recurrence_problems(it, v_nm);
      lt := it -> 'light';
      IF lt IS NOT NULL AND jsonb_typeof(lt) <> 'null' THEN
        IF jsonb_typeof(lt) <> 'object'
           OR NOT (lt -> 'yellow_after_days' IS NULL OR jsonb_typeof(lt -> 'yellow_after_days') = 'null' OR (app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_num(lt -> 'yellow_after_days') >= 0))
           OR NOT (lt -> 'red_after_days' IS NULL OR jsonb_typeof(lt -> 'red_after_days') = 'null' OR (app_servicio.j_int(lt -> 'red_after_days') AND app_servicio.j_num(lt -> 'red_after_days') >= 0)) THEN
          v := v || format('«%s»: el semáforo del paso tiene que ser un número de días', v_nm);
        ELSE
          v_has_rule := (due IS NOT NULL AND jsonb_typeof(due) <> 'null') OR (it -> 'recurrence' IS NOT NULL AND jsonb_typeof(it -> 'recurrence') <> 'null');
          IF NOT v_has_rule THEN v := v || format('«%s»: el semáforo del paso necesita un plazo o que se repita', v_nm); END IF;
          IF app_servicio.j_int(lt -> 'yellow_after_days') AND app_servicio.j_int(lt -> 'red_after_days')
             AND app_servicio.j_num(lt -> 'red_after_days') < app_servicio.j_num(lt -> 'yellow_after_days') THEN
            v := v || format('«%s»: el rojo tiene que ser igual o mayor que el amarillo', v_nm);
          END IF;
        END IF;
      END IF;
      IF v_key IS NOT NULL THEN v_before := v_before || v_key; END IF;
    END LOOP;
  END LOOP;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_complete_item(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe el paso' USING ERRCODE = 'SV002'; END IF;
  s := app_servicio.svc_get(it.service_id);
  PERFORM app_servicio.svc_require_item(s, it);
  -- A4 (F146, F147): un paso bloqueado o que pide evidencia sin tenerla no se completa a mano.
  PERFORM app_servicio.svc_assert_completable(it.id);
  RETURN app_servicio.svc_mark_item(it.id, 'manual', 'user', auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_mark_item(p_item_id uuid, p_source text, p_by_kind text, p_by uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  ph app_servicio.service_phases;
  d record;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN false; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  -- A4 (F146, F147): «Completar un paso» de una automatizacion respeta el bloqueo y la evidencia (SV033 / SV034).
  -- Lo que hizo el cliente (formulario, agenda, grabacion, programa) se completa igual y queda anotado.
  IF p_source = 'automation' THEN
    PERFORM app_servicio.svc_assert_completable(it.id);
  ELSIF p_by_kind = 'client' OR p_source = 'call' THEN
    BEGIN
      IF (app_servicio.svc_item_lock_state(it.id) ->> 'locked')::boolean THEN
        PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed_while_locked',
          jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), 'system');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_mark_item: no pude anotar el bloqueo: %', SQLERRM;
    END;
  END IF;
  UPDATE app_servicio.service_items
     SET status = 'completed', completed_at = now(), completed_by_kind = p_by_kind, completed_by = p_by, completed_source = p_source
   WHERE id = it.id;
  IF it.task_id IS NOT NULL THEN
    UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = it.task_id AND status <> 'completed';
  END IF;
  -- Los pasos que vencen "al completar este" ya tienen fecha.
  FOR d IN SELECT o.id FROM app_servicio.service_items o
            WHERE o.service_id = it.service_id AND o.status = 'pending' AND o.due_rule ->> 'from' = 'item_completed'
              AND o.due_rule ->> 'item_key' = it.template_key LOOP
    PERFORM app_servicio.svc_compute_due(d.id);
  END LOOP;
  PERFORM app_servicio.audit(s.workspace_id, 'service_item', it.id, 'svc.item_completed',
    jsonb_build_object('service_id', s.id, 'item_key', it.template_key, 'source', p_source), CASE p_by_kind WHEN 'client' THEN 'client' WHEN 'user' THEN 'user' ELSE 'system' END);
  PERFORM app_servicio.emit(s, 'service_item_completed', jsonb_build_object('phase_key', ph.template_key, 'item_key', it.template_key, 'item_kind', it.kind));
  IF ph.status = 'in_progress' THEN
    PERFORM app_servicio.svc_check_open_items(ph.id);
    PERFORM app_servicio.svc_try_advance_phase(s.id);
  END IF;
  PERFORM app_servicio.svc_compute_light(s.id);
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_task(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it app_servicio.service_items;
  s app_servicio.services;
  v_owner uuid;
  v_task uuid;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.kind <> 'team_task' OR it.task_id IS NOT NULL OR it.status = 'completed' OR it.is_recurring_template THEN RETURN; END IF;
  SELECT * INTO s FROM app_servicio.services WHERE id = it.service_id;
  v_owner := CASE it.assignee WHEN 'user' THEN it.assignee_user_id ELSE s.owner_user_id END;
  -- A4 (F148, F152): la tarea nace con su servicio y con los puntos del checklist del paso, sin tildar.
  INSERT INTO public.tasks (workspace_id, title, description, status, priority, due_date, owner_id, contact_id, source, source_ref, created_by,
                            service_id, checklist)
  VALUES (s.workspace_id, left(it.name, 200), it.description, 'pending', 'normal',
          COALESCE(it.due_on, app_servicio.local_date(it.due_at, s.workspace_id)), v_owner, s.contact_id, 'cx', 'svc_item:' || it.id::text, NULL,
          s.id,
          COALESCE((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'text', left(btrim(c #>> '{}'), 200), 'done', false) ORDER BY o)
                      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(it.ref -> 'checklist') = 'array' THEN it.ref -> 'checklist' ELSE '[]'::jsonb END)
                           WITH ORDINALITY AS t(c, o)
                     WHERE jsonb_typeof(c) = 'string' AND btrim(c #>> '{}') <> '' AND o <= 30), '[]'::jsonb))
  RETURNING id INTO v_task;
  UPDATE app_servicio.service_items SET task_id = v_task WHERE id = it.id;
  IF v_owner IS NOT NULL THEN
    PERFORM app_servicio.notify(s.workspace_id, v_owner, 'task_assigned', 'Tenés una tarea nueva', it.name, 'task', v_task,
                                jsonb_build_object('service_id', s.id));
  END IF;
END;
$function$;
