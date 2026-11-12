-- ============================================================
-- 00363_journey_item_button.sql
-- ============================================================
-- Servicios A2, F125 (decisiones 466 y 467): el boton de cada paso del camino en el portal y «El cliente puede ver
-- su respuesta». Viven DENTRO de `ref` (sin columnas ni claves nuevas del paso; el motor no se toca):
--   * ref.button = { label?, url? }: el texto (hasta 40 caracteres, en una linea; vacio = el de por defecto) y, solo
--     en los pasos sin destino automatico (team_task, student_task, checkbox), el link pegado (https://, sin espacios,
--     hasta 2000). En un paso con formulario o agenda un link pegado es un error: el link automatico es el que hace
--     que el paso se complete solo.
--   * portal_button = true necesita que el cliente vea el paso, y en las tareas y la casilla, el link.
--   * ref.show_response (booleano; ausente = true): solo en form, survey, activity, quiz y contract.
--
-- Reescribe SOLO `app_servicio.journey_item_ref_problems`: lo de siempre, igual, y al final las reglas del boton.
-- Gemela: `refProblems` / `buttonProblems` de lib/services/journey-template.ts, con los casos de
-- `journey-template.cases.json` (vitest y verify-services --bloque prd). Mismos textos, mismo orden.
--
-- Antes de aplicarla (11/11/2026): ninguna plantilla guardada usa el boton sin link, lo muestra oculto ni usa
-- `ref.button` o `ref.show_response` (46 pasos en total): la regla nueva puede rechazar en la base sin dejar ninguna
-- variante invalida.
--
-- Como volver atras: volver a crear la definicion de abajo (la vigente en la base al 11/11/2026, copiada de
-- pg_get_functiondef):
--
-- CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
--  RETURNS text[]
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v text[] := ARRAY[]::text[];
--   v_kind text := p_item ->> 'kind';
--   v_ref jsonb := CASE WHEN jsonb_typeof(p_item -> 'ref') = 'object' THEN p_item -> 'ref' ELSE '{}'::jsonb END;
--   v_co text := v_ref ->> 'complete_on';
--   v_form jsonb;
--   v_want text;
--   v_grading boolean;
--   v_ok boolean;
-- BEGIN
--   IF v_kind = ANY (ARRAY['form','survey','contract','activity','quiz']) THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'form_id') THEN
--       v := v || format('«%s»: elegí el formulario', p_nm);
--     ELSE
--       IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (CASE v_kind
--           WHEN 'form' THEN ARRAY['submitted','reviewed'] WHEN 'survey' THEN ARRAY['submitted','reviewed']
--           WHEN 'contract' THEN ARRAY['submitted'] WHEN 'activity' THEN ARRAY['submitted','reviewed','passed']
--           ELSE ARRAY['passed','finished'] END), false) THEN
--         v := v || format('«%s»: elegí cuándo se completa', p_nm);
--       END IF;
--       IF p_ws IS NOT NULL THEN
--         SELECT to_jsonb(f) INTO v_form FROM public.forms f WHERE f.id = (v_ref ->> 'form_id')::uuid AND f.workspace_id = p_ws;
--         IF v_form IS NULL THEN
--           v := v || format('«%s»: el formulario no existe', p_nm);
--         ELSE
--           v_want := CASE v_kind WHEN 'form' THEN 'custom' ELSE v_kind END;
--           IF v_form ->> 'type' IS DISTINCT FROM v_want THEN v := v || format('«%s»: el formulario no es del tipo del paso', p_nm); END IF;
--           IF v_kind IN ('quiz','activity') AND p_product IS NOT NULL AND (v_form ->> 'product_id') IS DISTINCT FROM p_product::text THEN
--             v := v || CASE v_kind WHEN 'quiz' THEN 'la evaluación tiene que ser de este programa' ELSE 'la actividad tiene que ser de este programa' END;
--           END IF;
--           IF v_kind = 'activity' AND v_co = 'passed' THEN
--             SELECT COALESCE((fv.definition #>> '{grading,enabled}')::boolean, false) INTO v_grading
--               FROM public.form_versions fv WHERE fv.id = (v_form ->> 'current_version_id')::uuid;
--             IF NOT COALESCE(v_grading, false) THEN v := v || format('«%s»: «al aprobar» necesita una actividad con calificación', p_nm); END IF;
--           END IF;
--         END IF;
--       END IF;
--     END IF;
--   ELSIF v_kind = 'booking' THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'event_type_id') THEN
--       v := v || format('«%s»: elegí el tipo de reunión', p_nm);
--     ELSIF p_ws IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.event_types e WHERE e.id = (v_ref ->> 'event_type_id')::uuid AND e.workspace_id = p_ws) THEN
--       v := v || format('«%s»: el tipo de reunión no existe', p_nm);
--     END IF;
--     IF v_ref ? 'complete_on' AND NOT COALESCE(v_co = ANY (ARRAY['booked','attended']), false) THEN v := v || format('«%s»: elegí cuándo se completa', p_nm); END IF;
--   ELSIF v_kind IN ('program_item','open_module') THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'program_item_id') THEN
--       v := v || format('«%s»: elegí el módulo o la clase', p_nm);
--     ELSIF p_product IS NOT NULL THEN
--       v_ok := false;
--       IF to_regclass('app_servicio.program_items') IS NOT NULL THEN
--         EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = $1 AND product_id = $2)'
--           INTO v_ok USING (v_ref ->> 'program_item_id')::uuid, p_product;
--       END IF;
--       IF NOT v_ok THEN v := v || format('«%s»: el módulo o la clase no es de este programa', p_nm); END IF;
--     END IF;
--   ELSIF v_kind = 'certificate' THEN
--     IF NOT app_servicio.j_uuid(v_ref -> 'template_id') THEN
--       v := v || 'Elegí la plantilla del certificado'::text;
--     ELSIF p_ws IS NOT NULL AND NOT EXISTS (
--       SELECT 1 FROM public.design_templates t WHERE t.id = (v_ref ->> 'template_id')::uuid AND t.workspace_id = p_ws AND t.doc_type = 'certificado'
--     ) THEN
--       v := v || format('«%s»: la plantilla no es de un certificado de este negocio', p_nm);
--     END IF;
--   ELSIF v_kind = 'open_section' THEN
--     IF NOT COALESCE(v_ref ->> 'section' = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN
--       v := v || format('«%s»: elegí la sección', p_nm);
--     END IF;
--   END IF;
--   RETURN v;
-- END;
-- $function$
-- ============================================================

CREATE OR REPLACE FUNCTION app_servicio.journey_item_ref_problems(p_item jsonb, p_nm text, p_ws uuid, p_product uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
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
  RETURN v;
END;
$function$;

-- Los mismos permisos de siempre (00332): la llama validate_journey_template.
REVOKE ALL ON FUNCTION app_servicio.journey_item_ref_problems(jsonb, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.journey_item_ref_problems(jsonb, text, uuid, uuid) TO service_role;
