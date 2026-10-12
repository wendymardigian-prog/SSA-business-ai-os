-- ============================================================================
-- 00181 — Reportes de fin de dia: guardar el borrador y enviar
-- ============================================================================
-- Dos funciones, solo para `service_role`. Las llama el servidor DESPUES de comprobar la
-- sesion, que la persona es del workspace y que esta en la audiencia del reporte. Lo que llega
-- ya viene validado (`lib/eod/submit.ts`); estas funciones cuidan lo que solo la base puede
-- cuidar: la revision, la unicidad y que todo pase en una transaccion.
--
-- save_eod_draft: crea la fila si no existe (INSERT ... ON CONFLICT DO NOTHING) y despues
--   UPDATE ... WHERE rev = p_rev RETURNING. Si otra pestana o el celular guardaron en el medio,
--   devuelve `conflict` con lo vigente: nunca pisa en silencio. Un reporte ya enviado en modo
--   "uno por dia" NO se toca; en modo "se puede corregir" el borrador va a `pending_edit`.
--
-- submit_eod_report: bloquea la fila, comprueba la revision y el modo, y la deja 'submitted'
--   con las respuestas, los canales elegidos, las metricas y la version. Una correccion suma
--   `edit_count`/`edited_at` y deja lo anterior en `audit_log` (eod_report / eod.edited), en la
--   misma transaccion. Doble clic: el segundo llega con una revision vieja y no hace nada.
--   (El evento de automatizacion se suma en la 00184, cuando la base acepta eventos sin contacto.)
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.save_eod_draft(uuid, uuid, uuid, date, integer, jsonb, jsonb, text);
--   DROP FUNCTION IF EXISTS public.submit_eod_report(uuid, uuid, uuid, date, integer, uuid, jsonb, jsonb, jsonb, text, jsonb);
-- Riesgo: bajo (funciones nuevas).
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.save_eod_draft(
  p_workspace_id uuid,
  p_form_id uuid,
  p_user_id uuid,
  p_report_date date,
  p_rev integer,
  p_answers jsonb,
  p_channels jsonb,
  p_report_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.eod_reports%ROWTYPE;
  v_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_report_mode NOT IN ('single', 'editable') THEN
    RAISE EXCEPTION 'save_eod_draft: modo invalido';
  END IF;

  INSERT INTO public.eod_reports (workspace_id, form_id, user_id, report_date, status)
  VALUES (p_workspace_id, p_form_id, p_user_id, p_report_date, 'draft')
  ON CONFLICT (form_id, user_id, report_date) DO NOTHING;

  SELECT * INTO v_row
  FROM public.eod_reports
  WHERE form_id = p_form_id AND user_id = p_user_id AND report_date = p_report_date;

  IF v_row.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'save_eod_draft: el reporte no es de este workspace';
  END IF;
  -- Un UPDATE ... RETURNING INTO que no encuentra fila deja v_row en NULL: el id va aparte.
  v_id := v_row.id;

  IF v_row.status = 'submitted' AND p_report_mode = 'single' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_submitted', 'report_id', v_row.id);
  END IF;

  IF v_row.status = 'submitted' THEN
    -- Corrigiendo un reporte enviado: lo enviado no cambia hasta el proximo "Enviar".
    UPDATE public.eod_reports
       SET pending_edit = jsonb_build_object('answers', COALESCE(p_answers, '{}'::jsonb), 'channels', COALESCE(p_channels, '{}'::jsonb)),
           rev = rev + 1,
           saved_at = v_now
     WHERE id = v_id AND rev = p_rev
     RETURNING * INTO v_row;
  ELSE
    UPDATE public.eod_reports
       SET answers = COALESCE(p_answers, '{}'::jsonb),
           channels = COALESCE(p_channels, '{}'::jsonb),
           rev = rev + 1,
           saved_at = v_now
     WHERE id = v_id AND rev = p_rev
     RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    -- Otra pestana o el celular guardaron en el medio: se devuelve lo vigente.
    SELECT * INTO v_row FROM public.eod_reports WHERE id = v_id;
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'report_id', v_row.id,
      'status', v_row.status,
      'rev', v_row.rev,
      'saved_at', v_row.saved_at,
      'answers', CASE WHEN v_row.status = 'submitted' THEN COALESCE(v_row.pending_edit -> 'answers', '{}'::jsonb) ELSE v_row.answers END,
      'channels', CASE WHEN v_row.status = 'submitted' THEN COALESCE(v_row.pending_edit -> 'channels', '{}'::jsonb) ELSE v_row.channels END
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'report_id', v_row.id, 'status', v_row.status, 'rev', v_row.rev, 'saved_at', v_row.saved_at);
END;
$$;

REVOKE ALL ON FUNCTION public.save_eod_draft(uuid, uuid, uuid, date, integer, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_eod_draft(uuid, uuid, uuid, date, integer, jsonb, jsonb, text) TO service_role;

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
