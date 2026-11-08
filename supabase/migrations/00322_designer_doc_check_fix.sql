-- ============================================================================
-- 00322_designer_doc_check_fix  (Diseñador IA, corrige la 00320)
-- ============================================================================
-- 1. `public.design_doc_check()` (trigger de `design_templates`, `designs` y `design_versions`) comparaba
--    `NEW.format` en la misma condición que `TG_TABLE_NAME`. plpgsql no corta un AND antes de resolver los
--    campos, y `design_versions` no tiene `format`: insertar una versión fallaba con
--    `record "new" has no field "format"`. Lo detectó `verify-permissions-matrix` antes de que el código
--    nuevo se usara (nadie escribía todavía en estas tablas). Ahora la comparación va en un IF aparte.
-- 2. `private.enqueue_design_cleanup()` contaba como candidata cualquier versión de más de 30 días, aunque
--    fuera la ACTUAL de su pieza (que nunca se borra): un negocio con un diseño viejo sin tocar recibía un
--    job por día que no borraba nada. Ahora solo cuenta una versión vieja que tenga otra más nueva en su
--    pieza (la regla fina sigue siendo `cleanupPlan`, que además respeta la última publicada).
--
-- Misma firma, ninguna tabla. Puede ir antes o después del deploy.
--
-- Definiciones de la 00320, para volver atrás:
--   CREATE OR REPLACE FUNCTION public.design_doc_check() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
--   BEGIN
--     IF NOT public.validate_design_doc(NEW.doc) THEN
--       RAISE EXCEPTION 'El documento del diseño no tiene la forma esperada' USING ERRCODE = '22023';
--     END IF;
--     IF TG_TABLE_NAME IN ('design_templates', 'designs') AND (NEW.doc ->> 'format') IS DISTINCT FROM NEW.format THEN
--       RAISE EXCEPTION 'El formato del documento no coincide con el de la fila' USING ERRCODE = '22023';
--     END IF;
--     RETURN NEW;
--   END; $$;
--   (y `private.enqueue_design_cleanup` con `SELECT DISTINCT v.workspace_id FROM public.design_versions v
--    WHERE v.created_at < p_now - interval '30 days'` en la primera rama del UNION; el resto igual a la de abajo).
-- Riesgo: bajo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.design_doc_check()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.validate_design_doc(NEW.doc) THEN
    RAISE EXCEPTION 'El documento del diseño no tiene la forma esperada' USING ERRCODE = '22023';
  END IF;
  -- Solo plantillas y diseños tienen `format` (las versiones no): la comparación va aparte.
  IF TG_TABLE_NAME IN ('design_templates', 'designs') THEN
    IF (NEW.doc ->> 'format') IS DISTINCT FROM to_jsonb(NEW) ->> 'format' THEN
      RAISE EXCEPTION 'El formato del documento no coincide con el de la fila' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.design_doc_check() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_design_cleanup(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid;
  v_key text;
  v_enqueued integer := 0;
BEGIN
  FOR v_ws IN
    -- Una versión vieja que NO es la actual de su pieza (hay otra más nueva).
    SELECT DISTINCT v.workspace_id
    FROM public.design_versions v
    WHERE v.created_at < p_now - interval '30 days'
      AND EXISTS (
        SELECT 1 FROM public.design_versions n
        WHERE n.workspace_id = v.workspace_id
          AND n.created_at > v.created_at
          AND ((v.design_id IS NOT NULL AND n.design_id = v.design_id) OR (v.template_id IS NOT NULL AND n.template_id = v.template_id))
      )
    UNION
    SELECT DISTINCT ((storage.foldername(o.name))[1])::uuid
    FROM storage.objects o
    WHERE o.bucket_id = 'design-renders'
      AND o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/exports/'
      AND o.created_at < p_now - interval '7 days'
  LOOP
    BEGIN
      v_key := 'design_cleanup:' || v_ws::text || ':' || (p_now AT TIME ZONE 'UTC')::date::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.scheduled_jobs j WHERE j.dedupe_key = v_key);
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES ('design_cleanup', jsonb_build_object('workspace_id', v_ws), p_now, v_key)
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_design_cleanup: no pude encolar el workspace %: %', v_ws, SQLERRM;
    END;
  END LOOP;
  RETURN v_enqueued;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_design_cleanup(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enqueue_design_cleanup(timestamptz) TO service_role;
