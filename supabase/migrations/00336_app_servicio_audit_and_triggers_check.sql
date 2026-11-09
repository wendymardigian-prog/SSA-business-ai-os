-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00336_app_servicio_audit_and_triggers_check  (Servicios v12, Corrida A1 · S07 · bloque SV2)
-- ============================================================================
-- 1. Politica ADICIONAL `audit_log_select_services` (F12): ve las filas del historial de un servicio,
--    de sus fases y de sus pasos quien puede ver ese servicio. `audit_log_select` NO se toca (las
--    politicas de SELECT se suman).
-- 2. CHECK de `triggers.type` suma los 26 disparadores del modulo (F25). Los 3 de afiliados los suma la
--    00342 (S13). Se parte de la definicion VIGENTE en la base (pg_get_constraintdef, 8/11/2026): solo
--    suma valores; todo lo que ya aceptaba sigue valiendo.
--
-- Modifica estructura existente (CHECK) + una politica nueva. Riesgo ALTO. Va ANTES del codigo.
--
-- Cómo volver atrás:
--   DROP POLICY IF EXISTS audit_log_select_services ON public.audit_log;
--   ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
--   ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK ((type = ANY (ARRAY['keyword'::text,
--     'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text,
--     'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text,
--     'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text,
--     'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text,
--     'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text,
--     'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text,
--     'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text,
--     'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text])));
--   (es la definicion vigente el 8/11/2026, copiada de pg_get_constraintdef). Antes de volver atras, borrar
--   o desactivar las filas de triggers con los tipos nuevos.
-- ============================================================================

-- ─── 1. Historial del modulo ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.can_see_audit_entity(p_entity_type text, p_entity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(CASE p_entity_type
    WHEN 'service' THEN app_servicio.can_see_service(p_entity_id)
    WHEN 'service_phase' THEN (SELECT app_servicio.can_see_service(ph.service_id) FROM app_servicio.service_phases ph WHERE ph.id = p_entity_id)
    WHEN 'service_item' THEN (SELECT app_servicio.can_see_service(i.service_id) FROM app_servicio.service_items i WHERE i.id = p_entity_id)
    ELSE false END, false);
$$;
REVOKE ALL ON FUNCTION app_servicio.can_see_audit_entity(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.can_see_audit_entity(text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS audit_log_select_services ON public.audit_log;
CREATE POLICY audit_log_select_services ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    entity_type IN ('service', 'service_phase', 'service_item')
    AND (SELECT public.is_workspace_member(workspace_id))
    AND app_servicio.can_see_audit_entity(entity_type, entity_id)
  );

-- ─── 2. Los disparadores del modulo ─────────────────────────────────────────
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK ((type = ANY (ARRAY['keyword'::text,
  'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text,
  'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text,
  'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text,
  'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text,
  'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text,
  'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text,
  'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text,
  'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text,
  'service_created'::text, 'service_started'::text, 'service_ending_soon'::text, 'service_status_changed'::text,
  'service_extended'::text, 'service_paused'::text, 'service_resumed'::text, 'service_phase_started'::text,
  'service_phase_completed'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text,
  'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_passed'::text, 'quiz_failed'::text,
  'task_submission_received'::text, 'task_submission_reviewed'::text, 'live_session_missed'::text, 'challenge_started'::text,
  'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_completed'::text,
  'certificate_issued'::text, 'portal_access_expiring'::text, 'portal_access_expired'::text])));
