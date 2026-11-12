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

/**
 * Servicios A4: triggers del modulo que LANZAN su error a proposito (la regla que se pidio). Igual salen con el modulo
 * apagado (llaman a module_on), pero no envuelven todo en EXCEPTION WHEN OTHERS: la guardia de completar tareas (F153)
 * tiene que frenar la tarea de un paso bloqueado o sin evidencia.
 */
export const RAISES_ON_PURPOSE = ["trg_app_servicio_task_guard"];

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

/**
 * Servicios A4 (§20.3). Las claves son las del plano (A4-M1 a A4-M9); el archivo, el numero real (se aplicaron en el
 * orden en que las usa cada bloque). `node scripts/verify-servicios-migracion.mjs --a4 M1`.
 */
export const A4_SPECS = {
  M1: {
    file: "00364_comments.sql",
    title: "Comentarios con @menciones (public.comments)",
    tables: ["public.comments"],
    functions: ["public.post_comment", "public.edit_comment", "public.delete_comment", "public.comment_mention_candidates", "public.can_see_comment_entity", "private.comment_system", "private.comment_entity_visible_to", "private.comment_filter_mentions", "private.comment_notify_mentions"],
    policies: ["public.comments:comments_select"],
    sqlChecks: [
      { label: "comments no tiene politicas de escritura", query: `SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comments' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')) AS ok` },
      { label: "authenticated solo puede leer comments (sin INSERT/UPDATE/DELETE/TRUNCATE)", query: `SELECT has_table_privilege('authenticated','public.comments','SELECT') AND NOT has_table_privilege('authenticated','public.comments','INSERT') AND NOT has_table_privilege('authenticated','public.comments','UPDATE') AND NOT has_table_privilege('authenticated','public.comments','DELETE') AND NOT has_table_privilege('authenticated','public.comments','TRUNCATE') AS ok` },
      { label: "comment_system no la ejecuta authenticated", query: `SELECT NOT has_function_privilege('authenticated','private.comment_system(uuid,text,uuid,text)','EXECUTE') AS ok` },
    ],
  },
  M9: {
    file: "00365_slack.sql",
    title: "Slack: user_profiles.slack_user_id e integration_configs.type + slack",
    columns: ["user_profiles:slack_user_id"],
    checks: [{ name: "integration_configs_type_check", adds: ["channel", "ai_provider", "email_provider", "social_network", "publishing_service", "google", "meta", "slack"] }],
    sqlChecks: [{ label: "el CHECK del ID de Slack existe", query: `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_profiles_slack_user_id_check') AS ok` }],
  },
  M2: {
    file: "00366_calls_service_proposals.sql",
    title: "Reuniones con servicio y propuestas (calls, call_analysis_profiles)",
    columns: ["calls:service_id", "calls:service_link", "calls:proposals", "call_analysis_profiles:proposals"],
    functions: ["public.call_proposal_claim", "public.call_proposal_patch"],
    sqlChecks: [
      { label: "call_proposal_claim solo para el servidor", query: `SELECT NOT has_function_privilege('authenticated','public.call_proposal_claim(uuid,text)','EXECUTE') AND has_function_privilege('service_role','public.call_proposal_claim(uuid,text)','EXECUTE') AS ok` },
      { label: "calls.service_id sin clave foranea (regla del 8/11)", query: `SELECT NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid='public.calls'::regclass AND c.contype='f' AND a.attname='service_id') AS ok` },
      { label: "los analizadores nacen sin proponer", query: `SELECT NOT EXISTS (SELECT 1 FROM public.call_analysis_profiles WHERE (proposals->>'enabled')::boolean IS TRUE) AS ok` },
    ],
  },
  M6: {
    file: "00367_calls_service_link_hook.sql",
    title: "Enganche del modulo en calls, paso «cuando hay grabacion» y barrido horario",
    functions: ["app_servicio.svc_call_link_plan", "app_servicio.svc_call_link_apply", "app_servicio.svc_call_complete_recorded", "app_servicio.call_link_hook", "private.enqueue_call_missing_recording"],
    triggers: ["public.calls:trg_app_servicio_call_link"],
    sqlChecks: [{ label: "el cron call-missing-recording esta programado", query: `SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname='call-missing-recording' AND active) AS ok` }],
  },
  M3: {
    file: "00368_tasks_service_call_checklist.sql",
    title: "Tareas con servicio, reunion y checklist; origen 'call'",
    columns: ["tasks:service_id", "tasks:call_id", "tasks:checklist"],
    sqlChecks: [
      { label: "tasks.source acepta los de siempre y 'call'", query: `SELECT pg_get_constraintdef(oid) LIKE '%''manual''%' AND pg_get_constraintdef(oid) LIKE '%''cx''%' AND pg_get_constraintdef(oid) LIKE '%''call''%' AS ok FROM pg_constraint WHERE conname='tasks_source_check'` },
      { label: "las tareas del camino tienen su servicio (consulta de control)", query: `SELECT count(*) = 0 AS ok FROM public.tasks WHERE source='cx' AND source_ref LIKE 'svc_item:%' AND service_id IS NULL AND deleted_at IS NULL` },
      { label: "tasks.service_id sin clave foranea (regla del 8/11)", query: `SELECT NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid='public.tasks'::regclass AND c.contype='f' AND a.attname='service_id') AS ok` },
      { label: "el indice unico uq_tasks_auto_source_open no cambio", query: `SELECT indexdef LIKE '%(workspace_id, source, source_ref)%' AND indexdef LIKE '%''flow''%' AND indexdef LIKE '%''agent''%' AND indexdef NOT LIKE '%''call''%' AS ok FROM pg_indexes WHERE indexname='uq_tasks_auto_source_open'` },
    ],
  },
  M4: {
    file: "00369_service_items_lock_evidence.sql",
    title: "Bloqueo, evidencia y checklist del camino",
    columns: ["app_servicio.service_items:evidence"],
    buckets: ["service-evidence"],
    functions: ["app_servicio.svc_item_lock_state", "app_servicio.svc_lock_plan", "app_servicio.svc_add_evidence", "app_servicio.svc_remove_evidence", "app_servicio.validate_journey_template", "app_servicio.journey_item_ref_problems", "app_servicio.svc_complete_item", "app_servicio.svc_ensure_task", "app_servicio.svc_mark_item"],
    sqlChecks: [
      { label: "los ayudantes del candado y la evidencia son solo del servidor", query: `SELECT NOT has_function_privilege('authenticated','app_servicio.svc_item_lock_state(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','app_servicio.svc_item_evidence_missing(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','app_servicio.svc_assert_completable(uuid)','EXECUTE') AS ok` },
      { label: "agregar y quitar evidencia: la sesion si, anon no", query: `SELECT has_function_privilege('authenticated','app_servicio.svc_add_evidence(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','app_servicio.svc_add_evidence(uuid,jsonb)','EXECUTE') AS ok` },
      { label: "el bucket service-evidence es privado", query: `SELECT NOT public AS ok FROM storage.buckets WHERE id='service-evidence'` },
    ],
  },
  M5: {
    file: "00370_task_guard_service_close.sql",
    title: "Guardia de completar tareas y cierre de tareas al terminar el servicio",
    functions: ["app_servicio.task_guard", "app_servicio.service_close_tasks_hook", "app_servicio.task_hook"],
    triggers: ["public.tasks:trg_app_servicio_task_guard", "app_servicio.services:trg_app_servicio_close_tasks"],
  },
  M8: {
    file: "00371_service_capacity.sql",
    title: "Topes de cartera por persona",
    columns: ["workspaces:service_team_settings", "workspaces:service_team_settings_rev"],
    functions: ["app_servicio.svc_owner_pick_plan", "app_servicio.svc_owner_loads", "app_servicio.svc_at_capacity"],
    sqlChecks: [{ label: "svc_owner_loads solo para el servidor", query: `SELECT NOT has_function_privilege('authenticated','app_servicio.svc_owner_loads(uuid)','EXECUTE') AS ok` }],
  },
  M7: {
    file: "00372_service_relative_triggers.sql",
    title: "Disparadores relativo y periodico; svc_daily_run",
    functions: ["app_servicio.svc_relative_due", "app_servicio.svc_daily_run"],
    checks: [{ name: "triggers_type_check", adds: ["service_relative", "service_phase_periodic"] }],
    sqlChecks: [{ label: "svc_relative_due solo para el servidor", query: `SELECT NOT has_function_privilege('authenticated','app_servicio.svc_relative_due(jsonb)','EXECUTE') AS ok` }],
  },
};
