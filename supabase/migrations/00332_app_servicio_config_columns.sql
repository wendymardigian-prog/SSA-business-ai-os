-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00332_app_servicio_config_columns  (Servicios v12, Corrida A1 · S03 · bloque SV1)
-- ============================================================================
-- Configuracion del modulo en COLUMNAS de tablas de BAIOS (decision 458):
--   product_variants: journey_template (+_rev), service_settings (+_rev), portal_settings (+_rev)
--   products:         portal_enabled (lo mantiene un trigger), portal_settings (+_rev)
--   workspaces:       portal_settings (+_rev), con indice unico sobre lower(host) en toda la instalacion
-- Nacen con su default ('{}', false, camino vacio) = "no hace nada": un producto sin configurar vende
-- exactamente igual.
--
-- Cada columna tiene su validador `app_servicio.validate_*` (devuelve la lista de problemas; vacia =
-- bien), gemelo de lib/services/settings.ts, lib/services/journey-template.ts y
-- lib/portal-admin/settings.ts (los casos compartidos corren contra las dos), y un trigger BEFORE que
-- rechaza (SV001) lo invalido. Solo las escriben las funciones del modulo (svc_save_*,
-- portal_admin_save_*, svc_copy_variant_setup): la guardia `trg_app_servicio_config_guard` (00330)
-- se extiende a estas columnas (SV003 para un UPDATE de authenticated/anon; un INSERT de esos roles
-- las deja en su default).
--
-- Modifica estructura existente (columnas con default constante en tablas en uso; triggers BEFORE).
-- Va ANTES de desplegar el codigo.
--
-- Cómo volver atrás (en este orden; las columnas no tienen datos de clientes):
--   DROP TRIGGER IF EXISTS trg_app_servicio_portal_enabled ON public.product_variants;
--   DROP TRIGGER IF EXISTS trg_app_servicio_variant_validate ON public.product_variants;
--   DROP TRIGGER IF EXISTS trg_app_servicio_product_validate ON public.products;
--   DROP TRIGGER IF EXISTS trg_app_servicio_workspace_validate ON public.workspaces;
--   DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.products;
--   DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.product_variants;
--   DROP INDEX IF EXISTS public.uq_workspaces_portal_host;
--   ALTER TABLE public.product_variants DROP COLUMN IF EXISTS journey_template, DROP COLUMN IF EXISTS journey_template_rev,
--     DROP COLUMN IF EXISTS service_settings, DROP COLUMN IF EXISTS service_settings_rev,
--     DROP COLUMN IF EXISTS portal_settings, DROP COLUMN IF EXISTS portal_settings_rev;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS portal_enabled, DROP COLUMN IF EXISTS portal_settings,
--     DROP COLUMN IF EXISTS portal_settings_rev;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS portal_settings, DROP COLUMN IF EXISTS portal_settings_rev;
--   DROP FUNCTION IF EXISTS app_servicio.validate_service_settings(jsonb, uuid), app_servicio.validate_journey_template(jsonb, uuid),
--     app_servicio.validate_variant_portal_settings(jsonb, uuid), app_servicio.validate_program_portal_settings(jsonb, uuid),
--     app_servicio.validate_workspace_portal_settings(jsonb, uuid), y las svc_save_* / portal_admin_save_* / svc_copy_variant_setup;
--   y `app_servicio.config_guard()` vuelve a la de la 00330 (solo workspaces.services_enabled).
-- Riesgo: medio.
-- ============================================================================

-- ─── 1. Columnas ────────────────────────────────────────────────────────────
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS journey_template      jsonb   NOT NULL DEFAULT '{"v":1,"phases":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS journey_template_rev  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_settings      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS service_settings_rev  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_settings       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_settings_rev   integer NOT NULL DEFAULT 0;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS portal_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_settings       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_settings_rev   integer NOT NULL DEFAULT 0;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS portal_settings       jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_settings_rev   integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.product_variants.service_settings IS 'Servicios v12: si la variante crea, extiende o no crea un servicio al cobrarse (F5, F115). {} = no crea. Solo la escribe app_servicio.svc_save_service_settings (00332).';
COMMENT ON COLUMN public.product_variants.journey_template IS 'Servicios v12: el camino del cliente de la variante (F13). Solo lo escribe app_servicio.svc_save_journey_template (00332).';
COMMENT ON COLUMN public.product_variants.portal_settings IS 'Servicios v12: acceso al portal y secciones de la variante (F36, F109, F116). Solo la escribe app_servicio.portal_admin_save_variant_portal (00332).';
COMMENT ON COLUMN public.products.portal_enabled IS 'Servicios v12: true si al menos una variante viva tiene acceso al portal. Lo mantiene un trigger (00332).';
COMMENT ON COLUMN public.products.portal_settings IS 'Servicios v12: lo del programa en el portal (F35, F113). Solo la escribe app_servicio.portal_admin_save_program_settings (00332).';
COMMENT ON COLUMN public.workspaces.portal_settings IS 'Servicios v12: Ajustes del portal (F43). Solo la escribe app_servicio.portal_admin_save_settings; extensions solo la plataforma (00332).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_portal_host
  ON public.workspaces (lower(portal_settings ->> 'host'))
  WHERE nullif(portal_settings ->> 'host', '') IS NOT NULL;

-- ─── 2. Ayudas de validacion ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.j_int(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'number' AND (p::text)::numeric = trunc((p::text)::numeric);
$$;
CREATE OR REPLACE FUNCTION app_servicio.j_uuid(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string'
    AND (p #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
CREATE OR REPLACE FUNCTION app_servicio.j_date(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND (p #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$';
$$;
-- Las claves no permitidas, como mensajes, en el orden del jsonb (gemela de unknownKeyProblems).
CREATE OR REPLACE FUNCTION app_servicio.unknown_keys(p jsonb, p_allowed text[])
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(array_agg('clave desconocida: ' || k ORDER BY ord), ARRAY[]::text[])
  FROM jsonb_object_keys(p) WITH ORDINALITY AS t(k, ord)
  WHERE NOT (k = ANY (p_allowed));
$$;
-- Un entero dentro del objeto (o NULL si no esta o no es entero).
CREATE OR REPLACE FUNCTION app_servicio.j_num(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p IS NOT NULL AND jsonb_typeof(p) = 'number' THEN (p::text)::numeric END;
$$;
REVOKE ALL ON FUNCTION app_servicio.j_int(jsonb), app_servicio.j_uuid(jsonb), app_servicio.j_date(jsonb),
  app_servicio.unknown_keys(jsonb, text[]), app_servicio.j_num(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.j_int(jsonb), app_servicio.j_uuid(jsonb), app_servicio.j_date(jsonb),
  app_servicio.unknown_keys(jsonb, text[]), app_servicio.j_num(jsonb) TO authenticated, service_role;

-- ─── 3. validate_service_settings (gemela de validateServiceSettings) ───────
CREATE OR REPLACE FUNCTION app_servicio.validate_service_settings(p jsonb, p_variant_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  v_mode text;
  v_allowed text[];
  v_when jsonb; v_owner jsonb; v_ext jsonb; v_x jsonb;
  v_product uuid; v_ws uuid;
  v_fb_product uuid; v_fb_mode text;
  v_n numeric;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN ARRAY['la configuración tiene que ser un objeto'];
  END IF;
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'mode' AND NOT COALESCE(p ->> 'mode' = ANY (ARRAY['create','extend','none']), false) THEN
    RETURN v || 'modo desconocido'::text;
  END IF;
  v_mode := COALESCE(p ->> 'mode', 'none');
  v_allowed := CASE v_mode
    WHEN 'none' THEN ARRAY['v','mode']
    WHEN 'create' THEN ARRAY['v','mode','when','confirm','start','owner','renewal','light','overdue_cut']
    ELSE ARRAY['v','mode','when','extend','light','overdue_cut'] END;
  v := v || app_servicio.unknown_keys(p, v_allowed);
  IF v_mode = 'none' THEN RETURN v; END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT pv.product_id, pv.workspace_id INTO v_product, v_ws FROM public.product_variants pv WHERE pv.id = p_variant_id;
  END IF;

  v_when := p -> 'when';
  IF v_when IS NULL OR jsonb_typeof(v_when) <> 'object' OR NOT COALESCE(v_when ->> 'rule' = ANY (ARRAY['any_payment','non_reservation','percent','amount']), false) THEN
    v := v || 'elegí cuándo se crea'::text;
  ELSIF v_when ->> 'rule' = 'percent' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') BETWEEN 1 AND 100) THEN
    v := v || 'el porcentaje va de 1 a 100'::text;
  ELSIF v_when ->> 'rule' = 'amount' AND NOT (app_servicio.j_int(v_when -> 'value') AND app_servicio.j_num(v_when -> 'value') >= 1) THEN
    v := v || 'el monto tiene que ser mayor a cero'::text;
  END IF;

  IF p ? 'light' THEN
    v_x := p -> 'light';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'overdue_red_days' AND NOT (app_servicio.j_int(v_x -> 'overdue_red_days') AND app_servicio.j_num(v_x -> 'overdue_red_days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días para rojo por pagos van de 1 a 365'::text;
    END IF;
  END IF;
  IF p ? 'overdue_cut' THEN
    v_x := p -> 'overdue_cut';
    IF jsonb_typeof(v_x) <> 'object' OR (v_x ? 'days' AND NOT (app_servicio.j_int(v_x -> 'days') AND app_servicio.j_num(v_x -> 'days') BETWEEN 1 AND 365)) THEN
      v := v || 'los días de mora van de 1 a 365'::text;
    END IF;
  END IF;

  IF v_mode = 'create' THEN
    IF p ? 'confirm' AND jsonb_typeof(p -> 'confirm') <> 'boolean' THEN v := v || '«Pedir confirmación» tiene que ser sí o no'::text; END IF;
    IF p ? 'start' AND NOT COALESCE(p ->> 'start' = ANY (ARRAY['payment_date','sale_date','manual']), false) THEN v := v || 'elegí la fecha de inicio'::text; END IF;
    IF p ? 'renewal' AND NOT COALESCE(p ->> 'renewal' = ANY (ARRAY['new_linked','extend','ask']), false) THEN v := v || 'elegí qué pasa si vuelve a comprar'::text; END IF;
    v_owner := p -> 'owner';
    IF v_owner IS NULL OR jsonb_typeof(v_owner) <> 'object' OR NOT COALESCE(v_owner ->> 'mode' = ANY (ARRAY['fixed','round_robin','conditions','previous']), false) THEN
      v := v || 'elegí cómo se asigna el responsable'::text;
    ELSE
      IF v_owner ->> 'mode' = 'fixed' AND NOT app_servicio.j_uuid(v_owner -> 'user_id') THEN v := v || 'elegí la persona'::text; END IF;
      IF v_owner ->> 'mode' = 'round_robin' AND NOT (jsonb_typeof(v_owner -> 'members') = 'array' AND jsonb_array_length(v_owner -> 'members') > 0) THEN
        v := v || 'elegí las personas del reparto'::text;
      END IF;
      IF v_owner ->> 'mode' = 'conditions' AND NOT (jsonb_typeof(v_owner -> 'conditions') = 'array' AND jsonb_array_length(v_owner -> 'conditions') > 0) THEN
        v := v || 'agregá al menos una condición'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_owner -> 'fallback_user_id') THEN v := v || 'elegí la persona de respaldo'::text; END IF;
      IF v_ws IS NOT NULL AND EXISTS (
        SELECT 1 FROM (
          SELECT x #>> '{}' AS uid FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_owner -> 'members') = 'array' THEN v_owner -> 'members' ELSE '[]'::jsonb END) x
          UNION ALL SELECT v_owner ->> 'user_id' WHERE jsonb_typeof(v_owner -> 'user_id') = 'string'
          UNION ALL SELECT v_owner ->> 'fallback_user_id' WHERE jsonb_typeof(v_owner -> 'fallback_user_id') = 'string'
        ) people
        WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_ws AND m.user_id::text = people.uid)
      ) THEN
        v := v || 'hay una persona que no es del equipo'::text;
      END IF;
    END IF;
  END IF;

  IF v_mode = 'extend' THEN
    v_ext := p -> 'extend';
    IF v_ext IS NULL OR jsonb_typeof(v_ext) <> 'object' THEN
      v := v || 'elegí cuánto suma'::text;
      v := v || 'elegí la variante de respaldo'::text;
    ELSE
      IF NOT (app_servicio.j_int(v_ext -> 'n') AND app_servicio.j_num(v_ext -> 'n') BETWEEN 1 AND 1000) THEN v := v || 'elegí cuánto suma'::text; END IF;
      IF v_ext ? 'unit' AND NOT COALESCE(v_ext ->> 'unit' = ANY (ARRAY['days','weeks','months']), false) THEN v := v || 'elegí días, semanas o meses'::text; END IF;
      IF v_ext ? 'if_no_service' AND NOT COALESCE(v_ext ->> 'if_no_service' = ANY (ARRAY['confirm','create']), false) THEN
        v := v || 'elegí qué pasa si no tiene un servicio para extender'::text;
      END IF;
      IF v_ext ? 'target_variant_ids' AND jsonb_typeof(v_ext -> 'target_variant_ids') <> 'null'
         AND NOT (jsonb_typeof(v_ext -> 'target_variant_ids') = 'array'
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ext -> 'target_variant_ids') x WHERE NOT app_servicio.j_uuid(x))) THEN
        v := v || 'las variantes a extender no son válidas'::text;
      END IF;
      IF NOT app_servicio.j_uuid(v_ext -> 'fallback_variant_id') THEN
        v := v || 'elegí la variante de respaldo'::text;
      ELSIF v_product IS NOT NULL THEN
        SELECT pv.product_id, COALESCE(pv.service_settings ->> 'mode', 'none') INTO v_fb_product, v_fb_mode
          FROM public.product_variants pv WHERE pv.id = (v_ext ->> 'fallback_variant_id')::uuid;
        IF v_fb_product IS DISTINCT FROM v_product THEN v := v || 'la variante de respaldo tiene que ser de este producto'::text;
        ELSIF v_fb_mode <> 'create' THEN v := v || 'la variante de respaldo tiene que crear un servicio'::text;
        END IF;
      END IF;
      IF v_product IS NOT NULL AND jsonb_typeof(v_ext -> 'target_variant_ids') = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v_ext -> 'target_variant_ids') t(id)
        WHERE NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.id::text = t.id AND pv.product_id = v_product)
      ) THEN
        v := v || 'las variantes a extender tienen que ser de este producto'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$$;

-- ─── 4. validate_journey_template (gemela de validateJourneyTemplate) ───────
-- Las referencias de un paso. Con p_ws NULL no mira la base (los casos compartidos).
CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  v_kind text := p_item ->> 'kind';
  v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
  v_co text := v_ref ->> 'complete_on';
  v_form jsonb;
  v_want text;
  v_grading boolean;
  v_ok boolean;
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
    IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
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
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.journey_recurrence_problems(p_item jsonb, p_nm text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  r jsonb := p_item -> 'recurrence';
BEGIN
  IF r IS NULL OR jsonb_typeof(r) = 'null' THEN RETURN v; END IF;
  IF jsonb_typeof(r) <> 'object' THEN RETURN ARRAY[format('«%s»: la repetición no es válida', p_nm)]; END IF;
  IF NOT COALESCE(r ->> 'every' = ANY (ARRAY['day','week','n_days']), false) THEN v := v || format('«%s»: elegí cada cuánto se repite', p_nm); END IF;
  IF r ->> 'every' = 'n_days' AND NOT (app_servicio.j_int(r -> 'n') AND app_servicio.j_num(r -> 'n') BETWEEN 1 AND 365) THEN
    v := v || format('«%s»: elegí cada cuántos días se repite', p_nm);
  END IF;
  IF NOT COALESCE(r ->> 'until' = ANY (ARRAY['phase_end','service_end','n_days','n_times']), false) THEN v := v || format('«%s»: elegí hasta cuándo se repite', p_nm); END IF;
  IF r ->> 'until' IN ('n_days','n_times') AND NOT (app_servicio.j_int(r -> 'n_until') AND app_servicio.j_num(r -> 'n_until') BETWEEN 1 AND 1000) THEN
    v := v || format('«%s»: elegí cuántas veces o días', p_nm);
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_journey_template(p jsonb, p_variant_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

-- ─── 5. Validadores del portal (gemelos de lib/portal-admin/settings.ts) ────
CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  sec text := p_rule ->> 'section';
  o jsonb; u jsonb; c jsonb; l jsonb; a jsonb;
BEGIN
  v := v || app_servicio.unknown_keys(p_rule, ARRAY['section','included','display','content','opens','until','limits','ai_limit_usd']);
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN
    RETURN v || ('sección desconocida: ' || COALESCE(sec, 'undefined'));
  END IF;
  IF NOT COALESCE(sec = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
    RETURN v || 'Todavía no está disponible'::text;
  END IF;
  IF p_rule ? 'display' AND NOT COALESCE(p_rule ->> 'display' = ANY (ARRAY['locked','coming_soon','hidden']), false) THEN v := v || (sec || ': elegí cómo se ve mientras está cerrada'); END IF;
  IF p_rule ? 'content' THEN
    c := p_rule -> 'content';
    IF NOT (jsonb_typeof(c) = 'object' AND (c -> 'modules' = '"all"'::jsonb OR (jsonb_typeof(c -> 'modules') = 'array' AND jsonb_array_length(c -> 'modules') > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'modules') m WHERE NOT app_servicio.j_uuid(m))))) THEN
      v := v || (sec || ': elegí el contenido incluido');
    ELSIF sec <> 'program' THEN
      v := v || (sec || ': solo el Programa elige contenido');
    END IF;
  END IF;
  IF p_rule ? 'opens' THEN
    o := p_rule -> 'opens';
    IF jsonb_typeof(o) <> 'object' OR NOT COALESCE(o ->> 'type' = ANY (ARRAY['service_start','days_after_start','fixed_date','phase_completed','item_completed',
         'module_completed','challenge_started','journey_item','automation']), false) THEN
      v := v || (sec || ': elegí cuándo se abre');
    ELSE
      IF o ->> 'type' = 'days_after_start' AND NOT (app_servicio.j_int(o -> 'days') AND app_servicio.j_num(o -> 'days') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuántos días después del inicio'); END IF;
      IF o ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(o -> 'date') THEN v := v || (sec || ': elegí la fecha en que se abre'); END IF;
      IF o ->> 'type' IN ('phase_completed','item_completed','module_completed') AND NOT (jsonb_typeof(o -> 'ref') = 'string' AND o ->> 'ref' <> '') THEN
        v := v || (sec || ': elegí qué la abre');
      END IF;
    END IF;
  END IF;
  IF p_rule ? 'until' THEN
    u := p_rule -> 'until';
    IF jsonb_typeof(u) <> 'object' OR NOT COALESCE(u ->> 'type' = ANY (ARRAY['service','days','months','fixed_date','phase_completed','item_completed','forever']), false) THEN
      v := v || (sec || ': elegí hasta cuándo dura');
    ELSE
      IF u ->> 'type' IN ('days','months') AND NOT (app_servicio.j_int(u -> 'n') AND app_servicio.j_num(u -> 'n') BETWEEN 1 AND 3650) THEN v := v || (sec || ': elegí cuánto dura'); END IF;
      IF u ->> 'type' = 'fixed_date' AND NOT app_servicio.j_date(u -> 'date') THEN v := v || (sec || ': elegí la fecha en que termina'); END IF;
      IF u ->> 'type' IN ('phase_completed','item_completed') AND NOT (jsonb_typeof(u -> 'ref') = 'string' AND u ->> 'ref' <> '') THEN v := v || (sec || ': elegí qué la termina'); END IF;
    END IF;
  END IF;
  IF p_rule ? 'limits' THEN
    l := p_rule -> 'limits';
    IF jsonb_typeof(l) <> 'object' OR (l ? 'community_can_post' AND jsonb_typeof(l -> 'community_can_post') <> 'boolean') THEN v := v || (sec || ': los límites no son válidos'); END IF;
  END IF;
  IF p_rule ? 'ai_limit_usd' AND jsonb_typeof(p_rule -> 'ai_limit_usd') <> 'null' THEN
    a := p_rule -> 'ai_limit_usd';
    IF NOT (jsonb_typeof(a) = 'number' AND app_servicio.j_num(a) BETWEEN 0 AND 10000) THEN v := v || (sec || ': el límite de IA va de 0 a 10.000 dólares');
    ELSIF sec <> 'assistant' THEN v := v || (sec || ': solo el Asistente IA tiene límite de gasto');
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  s jsonb;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','enabled','ask_terms','sections']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'enabled' AND jsonb_typeof(p -> 'enabled') <> 'boolean' THEN v := v || '«Acceso al portal» tiene que ser sí o no'::text; END IF;
  IF p ? 'ask_terms' AND jsonb_typeof(p -> 'ask_terms') <> 'boolean' THEN v := v || '«Esta variante los pide» tiene que ser sí o no'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'array' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR s IN SELECT x FROM jsonb_array_elements(p -> 'sections') x LOOP
        IF jsonb_typeof(s) <> 'object' THEN v := v || 'hay una sección que no es válida'::text; CONTINUE; END IF;
        IF jsonb_typeof(s -> 'section') = 'string' THEN
          IF (s ->> 'section') = ANY (v_seen) THEN v := v || format('la sección %s está repetida', s ->> 'section'); END IF;
          v_seen := v_seen || (s ->> 'section');
        END IF;
        v := v || app_servicio.portal_section_rule_problems(s);
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','sections','terms','community','affiliates','assistant']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN v := v || 'Todavía no está disponible'::text;
        ELSIF jsonb_typeof(p -> 'sections' -> k) <> 'boolean' THEN v := v || (k || ': tiene que ser sí o no');
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'terms' THEN
    t := p -> 'terms';
    IF jsonb_typeof(t) <> 'object' THEN v := v || 'los términos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['enabled','form_id','ask_again_on_change']);
      IF t -> 'enabled' = 'true'::jsonb AND NOT app_servicio.j_uuid(t -> 'form_id') THEN v := v || 'cargá los términos antes de prenderlos'::text; END IF;
    END IF;
  END IF;
  IF p ? 'community' THEN
    c := p -> 'community';
    IF jsonb_typeof(c) <> 'object' THEN v := v || 'la comunidad no es válida'::text;
    ELSE
      v := v || app_servicio.unknown_keys(c, ARRAY['lesson_comments','spaces']);
      IF c ? 'spaces' THEN
        IF jsonb_typeof(c -> 'spaces') <> 'array' THEN v := v || 'los espacios no son válidos'::text;
        ELSE
          FOR sp IN SELECT x FROM jsonb_array_elements(c -> 'spaces') x LOOP
            IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
               OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
              v := v || 'hay un espacio sin nombre o con una clave inválida'::text;
              CONTINUE;
            END IF;
            IF (sp ->> 'key') = ANY (v_keys) THEN v := v || format('el espacio %s está repetido', sp ->> 'key'); END IF;
            v_keys := v_keys || (sp ->> 'key');
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p ? 'affiliates' THEN
    a := p -> 'affiliates';
    IF jsonb_typeof(a) <> 'object' OR (a ? 'visible_link_keys' AND NOT (jsonb_typeof(a -> 'visible_link_keys') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'visible_link_keys') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^lk_[a-z0-9]{6}$'))) THEN
      v := v || 'los links de afiliados no son válidos'::text;
    END IF;
  END IF;
  IF p ? 'assistant' THEN
    a := p -> 'assistant';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'el asistente no es válido'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['excluded_kb_ids','monthly_limit_usd_per_student','credits_per_usd','credits_name','suggestions']);
      IF a ? 'monthly_limit_usd_per_student' AND NOT (jsonb_typeof(a -> 'monthly_limit_usd_per_student') = 'number'
         AND app_servicio.j_num(a -> 'monthly_limit_usd_per_student') BETWEEN 0 AND 10000) THEN
        v := v || 'el límite por estudiante va de 0 a 10.000 dólares'::text;
      END IF;
      IF a ? 'credits_per_usd' AND NOT (app_servicio.j_int(a -> 'credits_per_usd') AND app_servicio.j_num(a -> 'credits_per_usd') BETWEEN 1 AND 100000) THEN
        v := v || 'los créditos por dólar tienen que ser un número entero positivo'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_workspace_portal_settings(p jsonb, p_workspace_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  w jsonb; l jsonb; e jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','host','from_email','welcome','login','support_whatsapp','extensions']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'host' AND jsonb_typeof(p -> 'host') <> 'null' AND NOT (jsonb_typeof(p -> 'host') = 'string' AND length(p ->> 'host') <= 253
     AND (p ->> 'host') ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$') THEN
    v := v || 'la dirección no es válida: escribila sin https:// ni barras'::text;
  END IF;
  IF p ? 'from_email' AND jsonb_typeof(p -> 'from_email') <> 'null' AND NOT (jsonb_typeof(p -> 'from_email') = 'string' AND (p ->> 'from_email') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
    v := v || 'el email de «Enviar desde» no es válido'::text;
  END IF;
  IF p ? 'welcome' THEN
    w := p -> 'welcome';
    IF jsonb_typeof(w) <> 'object' THEN v := v || 'la bienvenida no es válida'::text;
    ELSE v := v || app_servicio.unknown_keys(w, ARRAY['home_text','invite_subject','invite_body']);
    END IF;
  END IF;
  IF p ? 'login' THEN
    l := p -> 'login';
    IF jsonb_typeof(l) <> 'object' OR (l ? 'password_allowed' AND jsonb_typeof(l -> 'password_allowed') <> 'boolean') THEN v := v || '«Cómo entran» no es válido'::text; END IF;
  END IF;
  IF p ? 'support_whatsapp' AND jsonb_typeof(p -> 'support_whatsapp') <> 'null' AND NOT (jsonb_typeof(p -> 'support_whatsapp') = 'string' AND (p ->> 'support_whatsapp') ~ '^\+\d{6,15}$') THEN
    v := v || 'el WhatsApp de soporte tiene que empezar con + y el código de país'::text;
  END IF;
  IF p ? 'extensions' THEN
    e := p -> 'extensions';
    IF jsonb_typeof(e) <> 'object' OR (e ? 'projects' AND jsonb_typeof(e -> 'projects') <> 'boolean') THEN v := v || 'las extensiones no son válidas'::text; END IF;
  END IF;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.validate_service_settings(jsonb, uuid), app_servicio.journey_item_ref_problems(jsonb, text, uuid, uuid),
  app_servicio.journey_recurrence_problems(jsonb, text), app_servicio.validate_journey_template(jsonb, uuid),
  app_servicio.portal_section_rule_problems(jsonb), app_servicio.validate_variant_portal_settings(jsonb, uuid),
  app_servicio.validate_program_portal_settings(jsonb, uuid), app_servicio.validate_workspace_portal_settings(jsonb, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.validate_service_settings(jsonb, uuid), app_servicio.validate_journey_template(jsonb, uuid),
  app_servicio.validate_variant_portal_settings(jsonb, uuid), app_servicio.validate_program_portal_settings(jsonb, uuid),
  app_servicio.validate_workspace_portal_settings(jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_servicio.journey_item_ref_problems(jsonb, text, uuid, uuid), app_servicio.journey_recurrence_problems(jsonb, text),
  app_servicio.portal_section_rule_problems(jsonb) TO service_role;

-- ─── 6. Triggers de validacion (SV001) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.variant_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'INSERT' OR NEW.service_settings IS DISTINCT FROM OLD.service_settings THEN
    v := v || app_servicio.validate_service_settings(NEW.service_settings, NEW.id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.journey_template IS DISTINCT FROM OLD.journey_template THEN
    v := v || app_servicio.validate_journey_template(NEW.journey_template, NEW.id);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings THEN
    v := v || app_servicio.validate_variant_portal_settings(NEW.portal_settings, NEW.id);
  END IF;
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_variant_validate ON public.product_variants;
CREATE TRIGGER trg_app_servicio_variant_validate
  BEFORE INSERT OR UPDATE OF service_settings, journey_template, portal_settings ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION app_servicio.variant_validate();

CREATE OR REPLACE FUNCTION app_servicio.product_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[];
BEGIN
  v := app_servicio.validate_program_portal_settings(NEW.portal_settings, NEW.id);
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_product_validate ON public.products;
CREATE TRIGGER trg_app_servicio_product_validate
  BEFORE INSERT OR UPDATE OF portal_settings ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_servicio.product_validate();

CREATE OR REPLACE FUNCTION app_servicio.workspace_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[];
BEGIN
  v := app_servicio.validate_workspace_portal_settings(NEW.portal_settings, NEW.id);
  IF array_length(v, 1) > 0 THEN
    RAISE EXCEPTION 'La configuración no es válida: %', array_to_string(v, '; ') USING ERRCODE = 'SV001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_workspace_validate ON public.workspaces;
CREATE TRIGGER trg_app_servicio_workspace_validate
  BEFORE INSERT OR UPDATE OF portal_settings ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION app_servicio.workspace_validate();
REVOKE ALL ON FUNCTION app_servicio.variant_validate(), app_servicio.product_validate(), app_servicio.workspace_validate() FROM public, anon;

-- ─── 7. La guardia, extendida a estas columnas (SV003) ──────────────────────
CREATE OR REPLACE FUNCTION app_servicio.config_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'workspaces' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.services_enabled := false;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.services_enabled IS DISTINCT FROM OLD.services_enabled
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  ELSIF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.portal_enabled := false;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.portal_enabled IS DISTINCT FROM OLD.portal_enabled
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_variants' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.journey_template := '{"v":1,"phases":[]}'::jsonb;
      NEW.journey_template_rev := 0;
      NEW.service_settings := '{}'::jsonb;
      NEW.service_settings_rev := 0;
      NEW.portal_settings := '{}'::jsonb;
      NEW.portal_settings_rev := 0;
    ELSIF NEW.journey_template IS DISTINCT FROM OLD.journey_template
       OR NEW.journey_template_rev IS DISTINCT FROM OLD.journey_template_rev
       OR NEW.service_settings IS DISTINCT FROM OLD.service_settings
       OR NEW.service_settings_rev IS DISTINCT FROM OLD.service_settings_rev
       OR NEW.portal_settings IS DISTINCT FROM OLD.portal_settings
       OR NEW.portal_settings_rev IS DISTINCT FROM OLD.portal_settings_rev THEN
      RAISE EXCEPTION 'La configuración del módulo se cambia desde sus pantallas' USING ERRCODE = 'SV003';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.config_guard() FROM public, anon;

DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.products;
CREATE TRIGGER trg_app_servicio_config_guard
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();
DROP TRIGGER IF EXISTS trg_app_servicio_config_guard ON public.product_variants;
CREATE TRIGGER trg_app_servicio_config_guard
  BEFORE INSERT OR UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION app_servicio.config_guard();

-- ─── 8. products.portal_enabled lo mantiene la base ─────────────────────────
-- true si al menos una variante viva del producto tiene el acceso al portal. Nunca hace fallar la
-- operacion sobre la variante.
CREATE OR REPLACE FUNCTION app_servicio.sync_product_portal_enabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_product uuid := COALESCE(NEW.product_id, OLD.product_id);
  v_on boolean;
BEGIN
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM public.product_variants pv
      WHERE pv.product_id = v_product AND pv.archived_at IS NULL AND pv.portal_settings -> 'enabled' = 'true'::jsonb
    ) INTO v_on;
    UPDATE public.products SET portal_enabled = v_on WHERE id = v_product AND portal_enabled IS DISTINCT FROM v_on;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.sync_product_portal_enabled: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.sync_product_portal_enabled() FROM public, anon;
DROP TRIGGER IF EXISTS trg_app_servicio_portal_enabled ON public.product_variants;
CREATE TRIGGER trg_app_servicio_portal_enabled
  AFTER INSERT OR UPDATE OF portal_settings, archived_at OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION app_servicio.sync_product_portal_enabled();

-- ─── 9. Guardar (solo con estas funciones) ──────────────────────────────────
-- Permiso del que llama en un negocio (la sesion). Owner y Admin, por has_permission.
CREATE OR REPLACE FUNCTION app_servicio.require_permission(p_workspace_id uuid, p_key text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(p_workspace_id) OR NOT public.has_permission(p_workspace_id, p_key) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.require_permission(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.require_permission(uuid, text) TO authenticated, service_role;

-- Resultado comun de los guardados: {status: ok|conflict|invalid, rev, current?, problems?}
CREATE OR REPLACE FUNCTION app_servicio.svc_save_service_settings(p_variant_id uuid, p_settings jsonb, p_rev integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.product_variants;
  v_new jsonb := p_settings;
  v_problems text[];
  v_before_mode text; v_after_mode text;
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_row.workspace_id, 'services.configure');
  v_before_mode := COALESCE(v_row.service_settings ->> 'mode', 'none');
  v_after_mode := COALESCE(v_new ->> 'mode', 'none');
  -- when.enabled_at lo pone la base (F5): al pasar de none a create/extend, ahora; al volver a none, se va.
  IF v_after_mode = 'none' THEN
    v_new := v_new - 'when';
  ELSIF jsonb_typeof(v_new -> 'when') = 'object' THEN
    v_new := jsonb_set(v_new, '{when,enabled_at}', to_jsonb(CASE
      WHEN v_before_mode = 'none' OR v_row.service_settings #>> '{when,enabled_at}' IS NULL THEN now()::text
      ELSE v_row.service_settings #>> '{when,enabled_at}' END));
  END IF;
  v_problems := app_servicio.validate_service_settings(v_new, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET service_settings = v_new, service_settings_rev = service_settings_rev + 1
   WHERE id = p_variant_id AND service_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.service_settings, 'rev', v_row.service_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'service', 'old', v_row.service_settings, 'new', v_new), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_save_journey_template(p_variant_id uuid, p_template jsonb, p_rev integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.product_variants;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_row.workspace_id, 'services.configure');
  v_problems := app_servicio.validate_journey_template(p_template, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET journey_template = p_template, journey_template_rev = journey_template_rev + 1
   WHERE id = p_variant_id AND journey_template_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.journey_template, 'rev', v_row.journey_template_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'journey', 'phases', jsonb_array_length(COALESCE(p_template -> 'phases', '[]'::jsonb))), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', p_template);
END;
$$;

-- Las partes de una regla de seccion que son "reglas" (portal.access_rules); el resto es portal.sections.
CREATE OR REPLACE FUNCTION app_servicio.portal_rules_part(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('section', s ->> 'section') || (s - 'section' - 'included') ORDER BY s ->> 'section'), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'sections') = 'array' THEN p -> 'sections' ELSE '[]'::jsonb END) s;
$$;
CREATE OR REPLACE FUNCTION app_servicio.portal_sections_part(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('enabled', p -> 'enabled', 'ask_terms', p -> 'ask_terms', 'sections',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('section', s ->> 'section', 'included', s -> 'included') ORDER BY s ->> 'section')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p -> 'sections') = 'array' THEN p -> 'sections' ELSE '[]'::jsonb END) s), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION app_servicio.portal_rules_part(jsonb), app_servicio.portal_sections_part(jsonb) FROM public, anon;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_variant_portal(p_variant_id uuid, p_settings jsonb, p_rev integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.product_variants;
  v_problems text[];
BEGIN
  SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002'; END IF;
  IF app_servicio.portal_sections_part(p_settings) IS DISTINCT FROM app_servicio.portal_sections_part(v_row.portal_settings) THEN
    PERFORM app_servicio.require_permission(v_row.workspace_id, 'portal.sections');
  END IF;
  IF app_servicio.portal_rules_part(p_settings) IS DISTINCT FROM app_servicio.portal_rules_part(v_row.portal_settings) THEN
    PERFORM app_servicio.require_permission(v_row.workspace_id, 'portal.access_rules');
  END IF;
  -- Sin cambios: igual pide alguno de los dos (no se guarda nada con una sesion cualquiera).
  IF NOT (public.has_permission(v_row.workspace_id, 'portal.sections') OR public.has_permission(v_row.workspace_id, 'portal.access_rules')) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  v_problems := app_servicio.validate_variant_portal_settings(p_settings, p_variant_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  UPDATE public.product_variants
     SET portal_settings = p_settings, portal_settings_rev = portal_settings_rev + 1
   WHERE id = p_variant_id AND portal_settings_rev = p_rev;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.product_variants WHERE id = p_variant_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings, 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_row.workspace_id, 'product_variant', p_variant_id, 'svc.config_saved',
          jsonb_build_object('part', 'portal', 'old', v_row.portal_settings, 'new', p_settings), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', p_settings);
END;
$$;

-- Lo del programa: un parche por claves de primer nivel (sections, terms, community, affiliates, assistant).
-- Cada clave pide su permiso.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_program_settings(p_product_id uuid, p_patch jsonb, p_rev integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.products;
  v_new jsonb;
  v_problems text[];
  k text;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    PERFORM app_servicio.require_permission(v_row.workspace_id, CASE k
      WHEN 'sections' THEN 'portal.sections'
      WHEN 'terms' THEN 'portal.sections'
      WHEN 'affiliates' THEN 'portal.sections'
      WHEN 'community' THEN 'community.spaces'
      WHEN 'assistant' THEN 'tutor.manage'
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

-- Ajustes del portal. `extensions` se conserva tal cual: solo la plataforma lo cambia (F43).
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_save_settings(p_workspace_id uuid, p_patch jsonb, p_rev integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.workspaces;
  v_new jsonb;
  v_problems text[];
BEGIN
  PERFORM app_servicio.require_permission(p_workspace_id, 'portal.settings');
  SELECT * INTO v_row FROM public.workspaces WHERE id = p_workspace_id;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'El cambio no es válido' USING ERRCODE = 'SV001'; END IF;
  v_new := (COALESCE(v_row.portal_settings, '{}'::jsonb) || (p_patch - 'extensions')) - 'extensions';
  IF v_row.portal_settings ? 'extensions' THEN v_new := v_new || jsonb_build_object('extensions', v_row.portal_settings -> 'extensions'); END IF;
  IF v_new ? 'host' AND jsonb_typeof(v_new -> 'host') = 'string' THEN v_new := jsonb_set(v_new, '{host}', to_jsonb(lower(btrim(v_new ->> 'host')))); END IF;
  v_problems := app_servicio.validate_workspace_portal_settings(v_new, p_workspace_id);
  IF array_length(v_problems, 1) > 0 THEN
    RETURN jsonb_build_object('status', 'invalid', 'problems', to_jsonb(v_problems));
  END IF;
  BEGIN
    UPDATE public.workspaces
       SET portal_settings = v_new, portal_settings_rev = portal_settings_rev + 1
     WHERE id = p_workspace_id AND portal_settings_rev = p_rev;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Esa dirección ya la usa otro negocio' USING ERRCODE = 'AC010';
  END;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.workspaces WHERE id = p_workspace_id;
    RETURN jsonb_build_object('status', 'conflict', 'current', v_row.portal_settings - 'extensions', 'rev', v_row.portal_settings_rev);
  END IF;
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (p_workspace_id, 'workspace', p_workspace_id, 'portal.settings_saved',
          jsonb_build_object('keys', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_patch) x)), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'rev', p_rev + 1, 'current', v_new - 'extensions');
END;
$$;

-- "Copiar de otra variante" (F13): copia UNA VEZ las partes elegidas, con claves nuevas. Lo que apunta a
-- algo de otro programa (formularios, modulos, clases) no se puede copiar tal cual: el paso queda como
-- casilla "(Requiere atención)" con la descripcion del original, y el contenido del Programa vuelve a
-- "todos los modulos".
CREATE OR REPLACE FUNCTION app_servicio.svc_copy_variant_setup(p_from_variant_id uuid, p_to_variant_id uuid, p_parts text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from public.product_variants;
  v_to public.product_variants;
  v_same_product boolean;
  v_map jsonb := '{}'::jsonb;
  v_tpl jsonb; v_phases jsonb := '[]'::jsonb; v_items jsonb;
  ph jsonb; it jsonb; v_new_key text; v_ref jsonb; v_attention integer := 0;
  v_portal jsonb; v_settings jsonb;
BEGIN
  SELECT * INTO v_from FROM public.product_variants WHERE id = p_from_variant_id;
  SELECT * INTO v_to FROM public.product_variants WHERE id = p_to_variant_id;
  IF v_from.id IS NULL OR v_to.id IS NULL OR v_from.workspace_id <> v_to.workspace_id THEN
    RAISE EXCEPTION 'No existe la variante' USING ERRCODE = 'SV002';
  END IF;
  IF p_from_variant_id = p_to_variant_id THEN RAISE EXCEPTION 'Elegí otra variante' USING ERRCODE = 'SV001'; END IF;
  IF 'journey' = ANY (p_parts) OR 'service' = ANY (p_parts) THEN
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'services.configure');
  END IF;
  IF 'portal' = ANY (p_parts) THEN
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'portal.sections');
    PERFORM app_servicio.require_permission(v_to.workspace_id, 'portal.access_rules');
  END IF;
  v_same_product := v_from.product_id = v_to.product_id;

  IF 'journey' = ANY (p_parts) THEN
    -- Claves nuevas para fases y pasos; se remapean las dependencias "al completar otro paso".
    FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_from.journey_template -> 'phases', '[]'::jsonb)) x LOOP
      v_map := v_map || jsonb_build_object(ph ->> 'key', 'ph_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      FOR it IN SELECT y FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) y LOOP
        v_map := v_map || jsonb_build_object(it ->> 'key', 'it_' || substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      END LOOP;
    END LOOP;
    FOR ph IN SELECT x FROM jsonb_array_elements(COALESCE(v_from.journey_template -> 'phases', '[]'::jsonb)) x LOOP
      v_items := '[]'::jsonb;
      FOR it IN SELECT y FROM jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) y LOOP
        v_new_key := v_map ->> (it ->> 'key');
        it := jsonb_set(it, '{key}', to_jsonb(v_new_key));
        IF it #>> '{due_rule,from}' = 'item_completed' AND v_map ? (it #>> '{due_rule,item_key}') THEN
          it := jsonb_set(it, '{due_rule,item_key}', to_jsonb(v_map ->> (it #>> '{due_rule,item_key}')));
        END IF;
        IF NOT v_same_product AND it ->> 'kind' IN ('quiz','activity','program_item','open_module') THEN
          it := jsonb_build_object('key', v_new_key, 'kind', 'checkbox', 'name', (it ->> 'name') || ' (Requiere atención)',
            'description', 'Copiado de otro programa: elegí de nuevo el contenido de este paso.', 'required', COALESCE(it -> 'required', 'true'::jsonb),
            'assignee', 'owner') || CASE WHEN it ? 'due_rule' THEN jsonb_build_object('due_rule', it -> 'due_rule') ELSE '{}'::jsonb END;
          v_attention := v_attention + 1;
        END IF;
        v_items := v_items || jsonb_build_array(it);
      END LOOP;
      v_phases := v_phases || jsonb_build_array(jsonb_set(jsonb_set(ph, '{key}', to_jsonb(v_map ->> (ph ->> 'key'))), '{items}', v_items));
    END LOOP;
    v_tpl := jsonb_set(v_from.journey_template, '{phases}', v_phases);
    UPDATE public.product_variants SET journey_template = v_tpl, journey_template_rev = journey_template_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  IF 'service' = ANY (p_parts) THEN
    v_settings := v_from.service_settings;
    IF v_settings ? 'when' THEN v_settings := jsonb_set(v_settings, '{when,enabled_at}', to_jsonb(now()::text)); END IF;
    IF NOT v_same_product AND v_settings ->> 'mode' = 'extend' THEN
      RAISE EXCEPTION 'Una variante que extiende solo se copia dentro del mismo producto' USING ERRCODE = 'SV001';
    END IF;
    UPDATE public.product_variants SET service_settings = v_settings, service_settings_rev = service_settings_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  IF 'portal' = ANY (p_parts) THEN
    v_portal := v_from.portal_settings;
    -- Las referencias a fases o pasos del camino se remapean si el camino tambien se copio.
    IF jsonb_typeof(v_portal -> 'sections') = 'array' THEN
      v_portal := jsonb_set(v_portal, '{sections}', (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN NOT v_same_product AND s ? 'content' THEN (s - 'content') || jsonb_build_object('content', jsonb_build_object('modules', 'all')) ELSE s END
          || CASE WHEN s #>> '{opens,ref}' IS NOT NULL AND v_map ? (s #>> '{opens,ref}') THEN jsonb_build_object('opens', jsonb_set(s -> 'opens', '{ref}', to_jsonb(v_map ->> (s #>> '{opens,ref}')))) ELSE '{}'::jsonb END
          || CASE WHEN s #>> '{until,ref}' IS NOT NULL AND v_map ? (s #>> '{until,ref}') THEN jsonb_build_object('until', jsonb_set(s -> 'until', '{ref}', to_jsonb(v_map ->> (s #>> '{until,ref}')))) ELSE '{}'::jsonb END
        ), '[]'::jsonb) FROM jsonb_array_elements(v_portal -> 'sections') s));
    END IF;
    UPDATE public.product_variants SET portal_settings = v_portal, portal_settings_rev = portal_settings_rev + 1 WHERE id = p_to_variant_id;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, performed_by, actor_type)
  VALUES (v_to.workspace_id, 'product_variant', p_to_variant_id, 'svc.config_copied',
          jsonb_build_object('from_variant_id', p_from_variant_id, 'parts', to_jsonb(p_parts), 'needs_attention', v_attention), auth.uid(), 'user');
  RETURN jsonb_build_object('status', 'ok', 'needs_attention', v_attention);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.svc_save_service_settings(uuid, jsonb, integer), app_servicio.svc_save_journey_template(uuid, jsonb, integer),
  app_servicio.portal_admin_save_variant_portal(uuid, jsonb, integer), app_servicio.portal_admin_save_program_settings(uuid, jsonb, integer),
  app_servicio.portal_admin_save_settings(uuid, jsonb, integer), app_servicio.svc_copy_variant_setup(uuid, uuid, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_save_service_settings(uuid, jsonb, integer), app_servicio.svc_save_journey_template(uuid, jsonb, integer),
  app_servicio.portal_admin_save_variant_portal(uuid, jsonb, integer), app_servicio.portal_admin_save_program_settings(uuid, jsonb, integer),
  app_servicio.portal_admin_save_settings(uuid, jsonb, integer), app_servicio.svc_copy_variant_setup(uuid, uuid, text[]) TO authenticated, service_role;
