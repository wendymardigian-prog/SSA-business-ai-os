// @plantilla-quitar(servicios)
// Lo que cada migracion de Servicios (Corrida A1) tiene que dejar en la base.
// La usa scripts/verify-servicios-migracion.mjs. Cada bloque completa el caso de su
// migracion cuando la escribe (el nombre real de cada objeto sale de la migracion).

/** Los valores que los CHECK ampliados ya aceptaban en el punto de partida (8/11/2026). */
export const OLD_CHECK_VALUES = {
  triggers_type_check: [
    "keyword", "postback", "quick_reply", "welcome", "default", "comment_keyword", "new_contact", "crm_event", "inactivity",
    "email_received", "booking_created", "booking_rescheduled", "booking_cancelled", "booking_updated", "booking_ended",
    "booking_status_changed", "booking_before_start", "booking_after_end", "booking_after_created", "call_analyzed",
    "call_linked", "form_submitted", "survey_answered", "contract_signed", "sale_created", "sale_status_changed",
    "payment_created", "payment_status_changed", "payment_before_due", "payment_after_due", "eod_submitted",
    "webhook_received", "task_completed", "task_overdue", "whatsapp_group_joined", "whatsapp_group_reaction",
    "whatsapp_group_poll_vote",
  ],
  forms_type_check: ["custom", "survey", "contract", "eod"],
  agent_runs_source_check: [
    "agent", "flow_ai_node", "sequence_ai_step", "kb_indexing", "conversation_summary", "message_classification",
    "message_classification_eval", "content_copy", "ads_analysis", "audio_transcription", "media_description",
    "call_classification", "call_analysis", "call_correction", "call_summary", "call_prompt_test", "ads_matching", "designer",
  ],
  agent_runs_agent_only_for_agent_sources: ["agent", "conversation_summary", "content_copy"],
};

/**
 * Triggers del modulo sobre tablas de BAIOS que NO salen con el modulo apagado, a proposito:
 * la guardia de configuracion y los validadores tienen que valer siempre, y el que mantiene
 * products.portal_enabled no hace nada si la variante no tiene portal. Las dos guardias del tutor (S15) son como la de
 * configuracion: frenan a la sesion que cambia el tutor de un programa (SV003), con el modulo prendido o apagado.
 */
export const MODULE_ON_EXEMPT = [
  "trg_app_servicio_config_guard",
  "trg_app_servicio_keep_contacts",
  "trg_app_servicio_variant_validate",
  "trg_app_servicio_product_validate",
  "trg_app_servicio_workspace_validate",
  "trg_app_servicio_portal_enabled",
  "trg_app_servicio_tutor_guard",
  "trg_app_servicio_tutor_agent_guard",
];

export const SPECS = {
  S01: {
    file: "00330_app_servicio_core.sql",
    title: "Esquema app_servicio, services, permisos y el interruptor del modulo",
    schemas: [{ name: "app_servicio", authenticatedUsage: true }],
    tables: ["app_servicio.services"],
    columns: ["workspaces:services_enabled"],
    functions: [
      "app_servicio.module_on", "app_servicio.can_see_service", "app_servicio.can_see_service_row",
      "app_servicio.can_view_as_student", "app_servicio.set_module_enabled", "app_servicio.config_guard",
      "app_servicio.keep_contacts_with_services",
    ],
    triggers: ["workspaces:trg_app_servicio_config_guard", "contacts:trg_app_servicio_keep_contacts"],
    policies: ["app_servicio.services:services_select"],
    sqlChecks: [
      {
        label: "el Member de sistema suma services.view, services.items y portal.view_as (M11)",
        query: `SELECT (private.member_permission_keys() @> ARRAY['services.view','services.items','portal.view_as']) AS ok`,
      },
      {
        label: "todo negocio nace con el modulo apagado",
        query: `SELECT (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='workspaces' AND column_name='services_enabled') = 'false' AS ok`,
      },
    ],
  },
  S02: {
    file: "00331_app_servicio_journey_tables.sql",
    title: "Fases y pasos del servicio; columnas de formularios y notas (sin claves foraneas en formularios ni firmas)",
    tables: ["app_servicio.service_phases", "app_servicio.service_items"],
    columns: ["form_submissions:service_item_id", "contact_notes:service_id"],
    policies: ["app_servicio.service_phases:service_phases_select", "app_servicio.service_items:service_items_select"],
    sqlChecks: [
      {
        label: "form_submissions.service_id, form_submissions.service_item_id y contract_signatures.service_id NO tienen clave foranea (lo valida el modulo)",
        query: `SELECT count(*) = 0 AS ok FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
                WHERE c.contype = 'f' AND (
                  (c.conrelid = 'public.form_submissions'::regclass AND a.attname IN ('service_id','service_item_id'))
                  OR (c.conrelid = 'public.contract_signatures'::regclass AND a.attname = 'service_id'))`,
      },
    ],
  },
  S03: {
    file: "00332_app_servicio_config_columns.sql",
    title: "Configuracion en columnas de workspaces, products y product_variants",
    columns: [
      "product_variants:journey_template", "product_variants:journey_template_rev",
      "product_variants:service_settings", "product_variants:service_settings_rev",
      "product_variants:portal_settings", "product_variants:portal_settings_rev",
      "products:portal_enabled", "products:portal_settings", "products:portal_settings_rev",
      "workspaces:portal_settings", "workspaces:portal_settings_rev",
    ],
    functions: [
      "app_servicio.validate_service_settings", "app_servicio.validate_journey_template",
      "app_servicio.validate_variant_portal_settings", "app_servicio.validate_program_portal_settings",
      "app_servicio.validate_workspace_portal_settings",
      "app_servicio.svc_save_service_settings", "app_servicio.svc_save_journey_template", "app_servicio.svc_copy_variant_setup",
      "app_servicio.portal_admin_save_variant_portal", "app_servicio.portal_admin_save_program_settings",
      "app_servicio.portal_admin_save_settings",
    ],
    triggers: [
      "product_variants:trg_app_servicio_variant_validate", "products:trg_app_servicio_product_validate",
      "workspaces:trg_app_servicio_workspace_validate", "product_variants:trg_app_servicio_portal_enabled",
      "products:trg_app_servicio_config_guard", "product_variants:trg_app_servicio_config_guard",
    ],
  },
  S04: {
    file: "00333_app_servicio_engine.sql",
    title: "El motor del servicio",
    functions: [
      "app_servicio.svc_create_service", "app_servicio.svc_rule_met",
      "app_servicio.svc_renewal_plan", "app_servicio.svc_pick_owner", "app_servicio.svc_instantiate_journey",
      "app_servicio.svc_compute_due", "app_servicio.svc_try_advance_phase", "app_servicio.svc_move_to_phase",
      "app_servicio.svc_complete_item", "app_servicio.svc_uncomplete_item", "app_servicio.svc_generate_occurrences",
      "app_servicio.svc_start_challenge", "app_servicio.svc_compute_light", "app_servicio.svc_extend",
      "app_servicio.svc_extend_plan", "app_servicio.svc_revert_extension", "app_servicio.svc_pause", "app_servicio.svc_resume",
      "app_servicio.svc_resume_plan", "app_servicio.svc_set_owner", "app_servicio.svc_bulk_set_owner",
      "app_servicio.svc_complete", "app_servicio.svc_cancel", "app_servicio.svc_confirm_service",
      "app_servicio.svc_discard_service", "app_servicio.svc_grant_initial_access", "app_servicio.svc_open_access",
      "app_servicio.svc_cut_access", "app_servicio.svc_light", "app_servicio.svc_due_date", "app_servicio.svc_occurrence_dates",
      "app_servicio.svc_phase_should_advance", "app_servicio.svc_owner_pick_plan", "app_servicio.svc_conditions_match",
    ],
  },
  S05: {
    file: "00334_app_servicio_sales_triggers.sql",
    title: "Triggers sobre payments y sales",
    functions: ["app_servicio.svc_evaluate_auto_creation", "app_servicio.svc_rule_check", "app_servicio.svc_sale_facts"],
    triggers: ["payments:trg_app_servicio_payment", "sales:trg_app_servicio_sale"],
  },
  S06: {
    file: "00335_app_servicio_completion_triggers.sql",
    title: "Completado automatico (formularios, firmas, reuniones, tareas) y bajas del equipo",
    triggers: [
      "form_submissions:trg_app_servicio_submission_item", "form_submissions:trg_app_servicio_submission",
      "contract_signatures:trg_app_servicio_signature", "bookings:trg_app_servicio_booking",
      "tasks:trg_app_servicio_task", "workspace_members:trg_app_servicio_member_removed",
    ],
  },
  S07: {
    file: "00336_app_servicio_audit_and_triggers_check.sql",
    title: "Historial del modulo y disparadores de Automatizaciones",
    policies: ["audit_log:audit_log_select_services"],
    checks: [{ name: "triggers_type_check", adds: ["service_created", "service_started", "service_item_completed", "portal_access_expired"] }],
  },
  S08: {
    file: "00340_app_servicio_portal_accounts.sql",
    title: "Esquema app_servicio_portal, cuentas y sesiones",
    schemas: [{ name: "app_servicio_portal", authenticatedUsage: false }],
    tables: ["app_servicio_portal.portal_accounts", "app_servicio_portal.portal_sessions"],
    buckets: ["portal-avatars"],
  },
  S09: {
    file: "00341_app_servicio_portal_access.sql",
    title: "Accesos al portal",
    tables: ["app_servicio_portal.portal_access"],
    functions: [
      "app_servicio.portal_access_effective", "app_servicio.portal_section_enabled", "app_servicio.portal_admin_create_preview_pass",
      "app_servicio.portal_access_window", "app_servicio.portal_access_pick", "app_servicio.svc_apply_access_event", "app_servicio.svc_overdue_sweep",
      "app_servicio.portal_admin_invite", "app_servicio.portal_invite_token_valid", "app_servicio.portal_admin_service_accesses",
    ],
  },
  S10: {
    file: "00342_app_servicio_program.sql",
    title: "Programa",
    tables: ["app_servicio.program_items", "app_servicio_portal.program_progress"],
    columns: ["knowledge_base:program_item_id", "knowledge_chunks:start_second"],
    buckets: ["program-resources"],
    // program_live_recordings va con el Calendario (S12): nombra tablas que nacen ahi.
    functions: ["app_servicio.program_item_unlocked", "app_servicio.program_unlock_plan", "app_servicio.svc_open_module"],
  },
  S11: {
    file: "00345_app_servicio_portal_forms.sql",
    title: "Formularios del portal",
    columns: ["forms:product_id", "form_submissions:review_status", "form_submissions:grade", "form_submissions:context"],
    checks: [{ name: "forms_type_check", adds: ["terms", "quiz", "activity"] }],
    functions: ["app_servicio.quiz_grade_plan", "app_servicio.grading_passed", "app_servicio.submission_review", "app_servicio.portal_terms_pending"],
  },
  S12: {
    file: "00346_app_servicio_calendar.sql",
    title: "Calendario y asistencia",
    tables: ["app_servicio.live_sessions", "app_servicio.live_session_dates", "app_servicio.link_clicks", "app_servicio_portal.live_attendance"],
    functions: [
      "app_servicio.live_occurrences_plan", "app_servicio.live_attendance_window", "app_servicio.attendance_base_plan",
      "app_servicio.live_session_occurrences", "app_servicio.attendance_base_members", "app_servicio.attendance_mark",
      "app_servicio.attendance_remove", "app_servicio.live_session_save", "app_servicio.live_date_save",
      "app_servicio.live_attendance_overview", "app_servicio.program_live_recordings",
    ],
    triggers: ["booking_categories:trg_app_servicio_booking_area_clase", "workspaces:trg_app_servicio_module_clase"],
  },
  S13: {
    file: "00343_affiliates.sql",
    title: "Afiliados y links de producto (BAIOS)",
    columns: [
      "products:links", "products:links_rev", "workspaces:affiliate_settings", "workspace_members:affiliate_code",
      "contacts:affiliate_code", "contacts:affiliate_user_id", "contacts:affiliate_contact_id", "sales:affiliate_user_id",
      "sales:affiliate_contact_id", "commissions:edited_manually", "commissions:contact_id", "vendors:contact_id",
    ],
    functions: ["public.affiliate_assign", "public.affiliate_ensure_code", "public.validate_product_links"],
    checks: [{ name: "triggers_type_check", adds: ["affiliate_lead_created", "affiliate_sale_created", "affiliate_assignment_expired"] }],
  },
  S14: {
    file: "00351_app_servicio_community.sql",
    title: "Comunidad",
    tables: ["app_servicio_portal.community_posts", "app_servicio_portal.community_reactions"],
    buckets: ["community-media"],
    functions: [
      "app_servicio.community_can_post_plan", "app_servicio.community_can_post", "app_servicio.community_unanswered", "app_servicio.community_feed",
      "app_servicio.community_team_post", "app_servicio.community_moderate", "app_servicio.community_set_muted",
    ],
  },
  S15: {
    file: "00352_app_servicio_tutor.sql",
    title: "Tutor del programa",
    columns: ["products:tutor_agent_id"],
    checks: [
      { name: "agent_runs_source_check", adds: ["portal_tutor"] },
      { name: "agent_runs_agent_only_for_agent_sources", adds: ["portal_tutor"] },
    ],
    policies: ["ai_threads:ai_threads_select_portal"],
    functions: [
      "app_servicio.program_ensure_tutor", "app_servicio.program_duplicate_tutor", "app_servicio.assistant_credits_plan",
      "app_servicio.assistant_credits", "app_servicio.tutor_knowledge_ids", "app_servicio.tutor_knowledge_list", "app_servicio.assistant_usage",
    ],
    triggers: ["products:trg_app_servicio_tutor_guard", "agents:trg_app_servicio_tutor_agent_guard"],
  },
  S16: {
    file: "00353_app_servicio_merge_and_cron.sql",
    title: "Fusion de contactos y cron diario del servicio",
    functions: ["app_servicio.merge_contacts_hook", "private.enqueue_svc_daily", "app_servicio.svc_daily_run", "app_servicio.assistant_set_own_limit", "app_servicio.program_card_metrics"],
    triggers: ["app_servicio.service_phases:trg_app_servicio_phase_certificate"],
  },
};
