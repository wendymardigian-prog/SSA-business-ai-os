-- ============================================================================
-- 00184 — submit_eod_report v2: emite el evento `eod_submitted` (E16)
-- ============================================================================
-- El mismo envio de la 00181, que ademas inserta en `automation_events` el evento
-- `eod_submitted` (contact_id NULL, member_user_id = quien envio) en la misma transaccion.
-- Necesita la 00182 (eventos sin contacto). Cada envio y cada correccion emiten uno; el
-- trigger decide si dispara (`on: "first"` o `"every"`) y su clave `eod:<report>:<edit_count>`
-- hace que una correccion no dispare dos veces.
--
-- Como volver atras: recrear la funcion con la definicion anterior (la de la 00181, abajo).
--
--   CREATE OR REPLACE FUNCTION public.submit_eod_report(
--     p_workspace_id uuid,
--     p_form_id uuid,
--     p_user_id uuid,
--     p_report_date date,
--     p_rev integer,
--     p_form_version_id uuid,
--     p_answers jsonb,
--     p_channels jsonb,
--     p_metrics jsonb,
--     p_report_mode text,
--     p_audit_changes jsonb
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_row public.eod_reports%ROWTYPE;
--     v_now timestamptz := now();
--     v_first boolean;
--   BEGIN
--     IF p_report_mode NOT IN ('single', 'editable') THEN
--       RAISE EXCEPTION 'submit_eod_report: modo invalido';
--     END IF;
--
--     INSERT INTO public.eod_reports (workspace_id, form_id, user_id, report_date, status)
--     VALUES (p_workspace_id, p_form_id, p_user_id, p_report_date, 'draft')
--     ON CONFLICT (form_id, user_id, report_date) DO NOTHING;
--
--     SELECT * INTO v_row
--     FROM public.eod_reports
--     WHERE form_id = p_form_id AND user_id = p_user_id AND report_date = p_report_date
--     FOR UPDATE;
--
--     IF v_row.workspace_id <> p_workspace_id THEN
--       RAISE EXCEPTION 'submit_eod_report: el reporte no es de este workspace';
--     END IF;
--
--     IF v_row.status = 'submitted' AND p_report_mode = 'single' THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'report_id', v_row.id);
--     END IF;
--
--     IF v_row.rev <> p_rev THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'report_id', v_row.id, 'status', v_row.status, 'rev', v_row.rev);
--     END IF;
--
--     v_first := v_row.status = 'draft';
--
--     UPDATE public.eod_reports
--        SET status = 'submitted',
--            answers = COALESCE(p_answers, '{}'::jsonb),
--            channels = COALESCE(p_channels, '{}'::jsonb),
--            metrics = COALESCE(p_metrics, '{}'::jsonb),
--            form_version_id = p_form_version_id,
--            pending_edit = NULL,
--            rev = rev + 1,
--            saved_at = v_now,
--            submitted_at = CASE WHEN v_first THEN v_now ELSE submitted_at END,
--            edited_at = CASE WHEN v_first THEN edited_at ELSE v_now END,
--            edit_count = CASE WHEN v_first THEN edit_count ELSE edit_count + 1 END
--      WHERE id = v_row.id
--      RETURNING * INTO v_row;
--
--     IF NOT v_first THEN
--       INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
--       VALUES (
--         p_workspace_id, 'eod_report', v_row.id, 'eod.edited', p_audit_changes,
--         jsonb_build_object('form_id', p_form_id, 'report_date', p_report_date, 'edit_count', v_row.edit_count),
--         p_user_id
--       );
--     END IF;
--
--     RETURN jsonb_build_object(
--       'ok', true,
--       'report_id', v_row.id,
--       'first', v_first,
--       'edit_count', v_row.edit_count,
--       'rev', v_row.rev,
--       'submitted_at', v_row.submitted_at,
--       'edited_at', v_row.edited_at
--     );
--   END;
--   $$;
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.submit_eod_report(
  p_workspace_id uuid,
  p_form_id uuid,
  p_user_id uuid,
  p_report_date date,
  p_rev integer,
  p_form_version_id uuid,
  p_answers jsonb,
  p_channels jsonb,
  p_metrics jsonb,
  p_report_mode text,
  p_audit_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.eod_reports%ROWTYPE;
  v_now timestamptz := now();
  v_first boolean;
BEGIN
  IF p_report_mode NOT IN ('single', 'editable') THEN
    RAISE EXCEPTION 'submit_eod_report: modo invalido';
  END IF;

  INSERT INTO public.eod_reports (workspace_id, form_id, user_id, report_date, status)
  VALUES (p_workspace_id, p_form_id, p_user_id, p_report_date, 'draft')
  ON CONFLICT (form_id, user_id, report_date) DO NOTHING;

  SELECT * INTO v_row
  FROM public.eod_reports
  WHERE form_id = p_form_id AND user_id = p_user_id AND report_date = p_report_date
  FOR UPDATE;

  IF v_row.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'submit_eod_report: el reporte no es de este workspace';
  END IF;

  IF v_row.status = 'submitted' AND p_report_mode = 'single' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'report_id', v_row.id);
  END IF;

  IF v_row.rev <> p_rev THEN
    RETURN jsonb_build_object('ok', false, 'error', 'conflict', 'report_id', v_row.id, 'status', v_row.status, 'rev', v_row.rev);
  END IF;

  v_first := v_row.status = 'draft';

  UPDATE public.eod_reports
     SET status = 'submitted',
         answers = COALESCE(p_answers, '{}'::jsonb),
         channels = COALESCE(p_channels, '{}'::jsonb),
         metrics = COALESCE(p_metrics, '{}'::jsonb),
         form_version_id = p_form_version_id,
         pending_edit = NULL,
         rev = rev + 1,
         saved_at = v_now,
         submitted_at = CASE WHEN v_first THEN v_now ELSE submitted_at END,
         edited_at = CASE WHEN v_first THEN edited_at ELSE v_now END,
         edit_count = CASE WHEN v_first THEN edit_count ELSE edit_count + 1 END
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  -- El evento de automatizacion, en la MISMA transaccion (E16). Sin contacto: es de una
  -- persona del equipo (00182). Solo escalares en el payload y nunca booking_id. La clave
  -- de idempotencia la arma el trigger con report_id y edit_count.
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, member_user_id, payload)
  VALUES (
    p_workspace_id,
    'eod_submitted',
    NULL,
    p_user_id,
    jsonb_build_object(
      'report_id', v_row.id,
      'form_id', p_form_id,
      'report_date', p_report_date,
      'edit_count', v_row.edit_count
    )
  );

  IF NOT v_first THEN
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      p_workspace_id, 'eod_report', v_row.id, 'eod.edited', p_audit_changes,
      jsonb_build_object('form_id', p_form_id, 'report_date', p_report_date, 'edit_count', v_row.edit_count),
      p_user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'report_id', v_row.id,
    'first', v_first,
    'edit_count', v_row.edit_count,
    'rev', v_row.rev,
    'submitted_at', v_row.submitted_at,
    'edited_at', v_row.edited_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_eod_report(uuid, uuid, uuid, date, integer, uuid, jsonb, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_eod_report(uuid, uuid, uuid, date, integer, uuid, jsonb, jsonb, jsonb, text, jsonb) TO service_role;
