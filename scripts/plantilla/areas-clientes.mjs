// Las areas de la base de la plantilla de CLIENTES: un archivo de migracion por area.
//
// Es la lista de la plantilla de estudiantes (areas.mjs) mas las areas de los modulos que
// esa no lleva (Ventas, Formularios, Tareas, Grabaciones, Finanzas, Diseñador IA y
// Servicios). La base de referencia son las migraciones del proyecto hasta el corte
// (db-profiles.mjs), sin poda. Si un objeto cambia de area en una, conviene mirar la otra.
//
// Los nombres de los archivos son las versiones con las que Supabase anota cada migracion:
// tienen que ser menores que el corte y no cambiar nunca (en la base de un cliente que ya
// tenia el sistema instalado, esas versiones figuran como aplicadas).
//
// Lo usa scripts/plantilla/generate-migrations.mjs. Cada objeto de la base de referencia
// (todas las migraciones del proyecto + la poda) tiene que caer en UN area; si alguno no
// cae en ninguna, el generador se corta y dice cual.
//
// Como se decide el area de cada objeto:
//   - Tablas y funciones: por nombre, con las listas de cada area (`tables`, `functions`).
//     Una funcion se nombra "esquema.nombre" (sin argumentos: las sobrecargas van juntas).
//   - Indices, restricciones, disparadores, politicas, permisos, comentarios y la
//     publicacion de realtime: van con su tabla, salvo que dependan de algo de un area
//     posterior; en ese caso van al area mas tardia de lo que usan (asi cada archivo solo
//     usa cosas ya creadas). Una clave foranea hacia una tabla de un area posterior se
//     declara en el area de esa tabla, despues de crearla.
//   - Cron, buckets y politicas de storage: por las listas `cron` y `buckets`.
//
// El orden de la lista es el orden de los archivos.

export const AREAS = [
  {
    file: "00000_permisos_por_defecto",
    title: "Permisos por defecto",
    header: `Corre primero, antes de que exista ninguna tabla.

Le da a los tres roles que usa la app (anon, authenticated y service_role) acceso
automatico a cada tabla, secuencia y funcion nueva del esquema public. Supabase ya
no lo hace solo en los proyectos nuevos: sin esto, las tablas nacerian sin acceso
para nadie.

Despues, cada archivo le quita a cada tabla y a cada funcion lo que no le corresponde
(por ejemplo, las tablas que solo toca el servidor).`,
    special: "default_privileges",
  },
  {
    file: "00001_extensiones_y_utilidades",
    title: "Extensiones y utilidades",
    header: `Las extensiones de Postgres que usa el sistema, el esquema privado (private) para
las funciones internas que la app no puede llamar, y funciones chicas sin tablas:
normalizar telefonos, emails y textos, comparar frases, y el disparador que mantiene
updated_at.`,
    extensions: true,
    schemas: ["private"],
    tables: [],
    functions: [
      "public.update_updated_at",
      "public.normalize_email",
      "public.normalize_handle",
      "public.normalize_phone",
      "public.normalize_message_text",
      "public.normalize_for_grouping",
      "public.text_matches_phrase",
      "public.linkedin_slug",
      "public.is_placeholder_name",
      "public.meta_name_key",
      "private.meta_url_decode",
      "private.custom_value_date",
      "private.custom_value_number",
      "private.scope_rank",
      "private.channel_scope_rank",
      "private.attachment_preview_label",
      "private.message_preview_text",
    ],
  },
  {
    file: "00002_espacios_y_equipo",
    title: "Espacios de trabajo y equipo",
    header: `Cada negocio es un espacio de trabajo (workspace). Aca viven el negocio, su equipo,
los roles con sus permisos, las invitaciones y el perfil y las preferencias de cada persona.

Las reglas de acceso de todo el sistema se apoyan en estas funciones: quien es
miembro, quien es Owner o Admin y que permisos tiene cada rol. Cuando alguien crea su
cuenta, un disparador sobre auth.users le arma su espacio de trabajo.

Tambien las vistas guardadas de las tablas (propias o compartidas) y la que cada persona
abre por defecto.`,
    tables: ["public.workspaces", "public.workspace_roles", "public.workspace_members", "public.workspace_invites", "public.user_preferences", "public.user_profiles",
      "public.table_views", "public.table_view_members", "public.table_view_defaults"],
    functions: [
      "public.is_workspace_member",
      "public.is_workspace_admin",
      "public.is_workspace_owner",
      "public.has_permission",
      "public.permission_scope",
      "public.can_give_role",
      "public.can_grant_permissions",
      "public.can_grant_channels",
      "public.can_grant_call_areas",
      "public.is_own_role",
      "public.handle_new_user",
      "public.seed_workspace_roles",
      "public.protect_system_roles",
      "public.workspace_roles_grant_check",
      "public.workspace_member_profiles",
      "private.member_permission_keys",
      "private.owner_only_keys",
      "private.ungrantable_keys",
      "private.channel_grant_exceeds",
      "private.call_areas_of",
      "private.call_areas_exceed",
      "private.role_sees_call_area",
      "private.my_call_permissions",
      "private.normalize_channel_grant",
      "private.role_channel_grant",
      "private.workspace_roles_channels_default",
      "private.channels_from_legacy",
      "private.member_channels",
      "public.table_view_workspace",
      "public.table_view_visible_to",
      "public.save_table_view",
      "public.delete_table_view",
      "public.set_table_view_default",
    ],
  },
  {
    file: "00003_secretos_e_integraciones",
    title: "Secretos e integraciones",
    header: `Las claves de los proveedores (IA, Zernio, Resend, Google...) viven cifradas en
Supabase Vault: estas funciones las guardan, las leen (solo el servidor) y las borran.
De una clave guardada la pantalla solo sabe que existe.

Ademas: la configuracion de cada integracion, las conexiones OAuth (por negocio o por
persona) y los canales de mensajeria conectados (Instagram, WhatsApp, email).`,
    tables: ["public.integration_configs", "public.oauth_connections", "public.channels"],
    functions: [
      "public.store_secret",
      "public.read_secret",
      "public.delete_secret",
      "public.list_secret_names",
      "public.vault_secret_key",
      "public.assert_can_manage_secrets",
      "public.messaging_window_hours",
      "private.set_system_secret",
      "private.system_secrets_status",
      "private.my_channels",
    ],
  },
  {
    file: "00004_catalogo_y_asignacion",
    title: "Catalogo de productos y asignacion de leads",
    header: `El catalogo de productos y sus variantes (con su precio en USD). El historial de
cada cambio lo escribe la base en audit_log.

La asignacion automatica de leads: las reglas para elegir setter, vendedor y referido
de cada contacto. Algunos nombres internos dicen "sales": son de la asignacion
y se dejan asi a proposito.`,
    tables: ["public.products", "public.product_variants", "public.assignment_rules"],
    functions: ["public.catalog_audit", "public.seed_sales_defaults", "public.contacts_enqueue_sales_eval"],
  },
  {
    file: "00005_contactos",
    title: "Contactos",
    header: `El contacto es la entidad central del sistema. Todo contacto nuevo nace en un solo
lugar (find_or_create_contact), con bloqueo por dato: dos llegadas simultaneas de la
misma persona dan un solo contacto. Se reconoce a una persona por un dato fuerte
(canal, telefono, WhatsApp, email o usuario de una red), nunca por el nombre.

Tambien: los canales vinculados a cada contacto, etiquetas (algunas con efecto),
campos personalizados, notas, el estado de setter y de vendedor con su historial, las
marcas "conocido" y "cliente", el "no contactar", el estado de suscripcion a emails (con la
baja, que gana siempre) y las importaciones por CSV. Un Member solo ve los contactos que le
corresponden (can_see_contact).

Tambien el nivel de calificacion del lead (de 1 a 5) con su historial de cambios.`,
    tables: [
      "public.contacts",
      "public.contact_channels",
      "public.tags",
      "public.contact_tags",
      "public.custom_field_definitions",
      "public.contact_custom_fields",
      "public.contact_notes",
      "public.contact_qualification_changes",
      "public.contact_status_changes",
      "public.csv_imports",
    ],
    functions: [
      "public.find_or_create_contact",
      "public.find_or_link_contact",
      "public.can_see_contact",
      "public.apply_opt_out_check",
      "public.set_contact_status",
      "public.contacts_emit_changes",
      "public.contacts_emit_created",
      "public.contacts_emit_deanonymized",
      "public.contacts_known_effects",
      "public.contacts_known_on_merge",
      "public.contacts_customer_effects",
      "public.contacts_customer_on_merge",
      "public.contact_tags_apply_effects",
      "public.contact_tags_emit",
      "public.contact_custom_fields_emit",
      "public.tags_effect_changed",
      "public.email_address_status",
      "public.email_address_send_state",
      "public.set_email_status",
      "public.set_email_status_by_address",
      "private.email_status_rank",
      "private.email_status_decide",
      "private.email_status_lock",
      "private.email_status_apply",
      "private.email_pause_enrollments",
      "private.contacts_email_status_guard",
      "private.contacts_email_inherit",
      "private.contacts_email_on_merge",
      "private.contact_identity_lookup",
      "private.contact_normalize_identity",
      "private.contact_value_taken",
      "private.contacts_status_guard",
      "private.contacts_interest_check",
      "private.contact_custom_fields_typed",
      "private.default_contact_status_settings",
      "private.known_assignee",
      "private.customer_assignee",
      "private.tag_effect_apply",
      "private.tag_effect_release",
      "public.contact_attribution_options",
      "public.set_contact_qualification",
      "public.contacts_qualification_on_merge",
      "private.contacts_qualification_guard",
      "private.qualification_next_level",
    ],
  },
  {
    file: "00006_bandeja",
    title: "Bandeja",
    header: `La bandeja multicanal: conversaciones (una por canal y contacto) y sus mensajes,
reacciones, llamadas de WhatsApp, stickers, comentarios de Instagram, el responsable
de cada chat y sus reglas de asignacion por cuenta, el tope de envios automaticos por
hora, los patrones de mensajes y el registro de emails salientes con la guardia de entrega
del marketing (tope diario, calentamiento y freno). Tambien los grupos de WhatsApp activados:
sus miembros, mensajes, reacciones y votos.

Un disparador sobre messages mantiene en la conversacion el ultimo mensaje, los no
leidos y si el lead esta esperando respuesta. Un Member ve una conversacion segun lo
que su rol tiene en esa cuenta (can_see_conversation).`,
    tables: [
      "public.conversations",
      "public.messages",
      "public.message_reactions",
      "public.channel_send_windows",
      "public.conversation_assignment_rules",
      "public.whatsapp_calls",
      "public.stickers",
      "public.comment_logs",
      "public.message_categories",
      "public.message_texts",
      "public.email_log",
      "public.whatsapp_groups",
      "public.whatsapp_group_members",
      "public.whatsapp_group_messages",
      "public.whatsapp_group_reactions",
      "public.whatsapp_poll_votes",
    ],
    functions: [
      "public.can_see_conversation",
      "public.can_see_whatsapp_group",
      "public.can_write_whatsapp_group",
      "public.patch_resend_config",
      "public.reserve_email_send",
      "public.email_send_capacity",
      "public.record_email_delivery_event",
      "public.messages_mark_contact_wrote",
      "public.conversations_carry_contact_wrote",
      "public.conversation_is_silent_outreach",
      "private.email_guard_decide",
      "private.email_guard_state",
      "private.email_guard_time_zone",
      "public.conversation_people",
      "public.conversation_rule_pick",
      "public.assign_new_conversation",
      "public.conversations_inherit_known",
      "public.conversations_inherit_customer",
      "public.conversations_inherit_tag_effects",
      "public.conversations_keep_known_marker",
      "public.conversations_keep_customer_marker",
      "public.conversations_keep_tag_marker",
      "public.messages_discard_answered_drafts",
      "public.messages_fill_origin",
      "public.messages_refresh_awaiting",
      "public.messages_refresh_last_message",
      "public.messages_set_workspace_id",
      "public.messages_upsert_text",
      "public.increment_unread",
      "public.record_whatsapp_call",
      "public.set_conversation_no_reply",
      "public.claim_automated_send",
      "public.chat_is_closure_message",
      "public.seed_message_categories",
      "private.refresh_conversation_awaiting",
      "private.contact_is_mine",
      "private.contact_is_unassigned",
      "private.message_list_preview",
      "public.mark_message_deleted_for_everyone",
      "public.messages_guard_client_attachments",
      "public.messages_guard_deleted_for_everyone",
      "public.messages_reopen_conversation",
      "public.whatsapp_channel_daily_messages",
    ],
  },
  {
    file: "00007_banca_de_recursos",
    title: "Banca de recursos",
    header: `La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces que el
equipo y el agente mandan por el chat. Una sola tabla; el tipo (kind) decide que
columnas aplican y la base rechaza una forma invalida.`,
    tables: ["public.response_assets"],
    functions: ["public.touch_response_asset"],
  },
  {
    file: "00008_automatizaciones",
    title: "Automatizaciones",
    header: `Flujos (con su borrador, sus versiones publicadas y sus disparadores), las sesiones
que los ejecutan, la cola de eventos del CRM que los arranca, las secuencias (drip)
con su auto-pausa cuando el contacto responde, los envios masivos (con su cola y el
ritmo de cada canal), sus analiticas y el historial de cada ejecucion de un flujo, paso por
paso, con las metricas de cada paso y los clicks de sus links medidos.`,
    tables: [
      "public.webhook_endpoints",
      "public.inbound_webhooks",
      "public.flows",
      "public.flow_versions",
      "public.triggers",
      "public.flow_sessions",
      "public.flow_session_steps",
      "public.flow_send_claims",
      "public.trigger_fires",
      "public.automation_events",
      "public.sequences",
      "public.sequence_enrollments",
      "public.broadcasts",
      "public.broadcast_recipients",
      "public.channel_send_lanes",
      "public.analytics_events",
      "public.flow_link_clicks",
    ],
    functions: [
      "public.receive_inbound_webhook",
      "public.emit_automation_event",
      "public.can_see_flow_session",
      "private.flow_sessions_set_finished_at",
      "public.triggers_set_workspace_id",
      "public.pause_sequences_on_reply",
      "public.claim_sequence_enrollments",
      "public.increment_broadcast_failed",
      "public.increment_broadcast_sent",
      "public.claim_lane_slot",
      "public.claim_broadcast_recipient",
      "public.refresh_broadcast_counts",
      "private.fill_automation_source",
      "public.flow_node_stats",
      "public.delete_unsent_broadcast",
      "public.reopen_unsent_broadcast",
    ],
  },
  {
    file: "00009_agentes_ia",
    title: "Agentes de IA",
    header: `Los agentes de IA de cada negocio (el de chat y el copywriter), cada llamada a IA del
sistema (una corrida, con su costo congelado) y sus pasos, los borradores que esperan
aprobacion, el historial de instrucciones, los precios por modelo y la base de
conocimiento con su busqueda semantica.`,
    tables: [
      "public.agents",
      "public.model_pricing",
      "public.agent_runs",
      "public.agent_run_steps",
      "public.agent_drafts",
      "public.agent_prompt_versions",
      "public.ai_task_prompt_versions",
      "public.knowledge_base",
      "public.knowledge_chunks",
    ],
    functions: [
      "public.claim_agent_reply",
      "public.ensure_default_agents",
      "public.seed_copywriter_agent",
      "public.match_knowledge_chunks",
      "public.match_knowledge_chunks_filtered",
      "public.sum_ai_spend",
      "private.sweep_agent_drafts",
      "private.alert_draft_windows",
      "public.closable_inactive_conversations",
    ],
  },
  {
    file: "00010_agenda",
    title: "Agenda",
    header: `Agendamiento: areas y tipos de reunion, horarios de disponibilidad, calendarios de
Google de cada persona, perfiles de agenda, tipos de evento, reuniones y tiempo fuera.

La doble reserva la evita la base, con una restriccion de exclusion por anfitrion y
horario. Cancelar es un estado: una reunion nunca se borra.`,
    tables: [
      "public.booking_categories",
      "public.availability_schedules",
      "public.calendars",
      "public.scheduling_profiles",
      "public.event_types",
      "public.bookings",
      "public.out_of_office",
      "public.event_type_moved_links",
    ],
    functions: [
      "public.can_see_booking",
      "public.change_event_type_host",
      "private.booking_category_system_key",
      "public.create_booking",
      "public.booking_categories_two_levels",
      "public.booking_utm_options",
      "public.ensure_default_schedule",
      "public.set_default_schedule",
      "public.scheduling_can_manage",
      "public.seed_booking_categories",
      "public.seed_booking_categories_for_workspace",
    ],
  },
  {
    file: "00011_contenido",
    title: "Contenido",
    header: `El pipeline de contenido: pilares, ideas, piezas (con su responsable, su variante
por red y su historial de versiones), las cuentas sociales conectadas, cada
publicacion por red y sus comentarios.`,
    tables: [
      "public.content_pillars",
      "public.content_ideas",
      "public.content_posts",
      "public.content_post_versions",
      "public.social_accounts",
      "public.social_posts",
      "public.social_post_comments",
      "public.provider_media",
    ],
    functions: [
      "public.approve_content_idea_v2",
      "public.content_posts_assignee_guard",
      "public.content_posts_attribution_code_trg",
      "public.content_posts_status_guard",
      "public.social_posts_assignee_guard",
      "private.new_attribution_code",
    ],
  },
  {
    file: "00012_metricas_anuncios_y_atribucion",
    title: "Metricas, anuncios y atribucion",
    header: `Las metricas diarias de cada publicacion y de cada cuenta, el catalogo de Meta
(campanas, conjuntos y anuncios) con sus metricas diarias, y la atribucion: cada
interaccion de un contacto (toque) con su canal (organico, pauta, referido, directo),
su vinculo con el anuncio de Meta y con la pieza de contenido. Tambien la cola de eventos
de la API de Conversiones de Meta (reuniones agendadas y pasos de automatizacion).

Un metric que la red no dio queda en null: nunca se inventa un cero.`,
    tables: [
      "public.social_post_metrics_daily",
      "public.social_account_metrics_daily",
      "public.meta_campaigns",
      "public.meta_adsets",
      "public.meta_ads",
      "public.meta_ads_insights_daily",
      "public.contact_touches",
      "public.meta_match_rules",
      "public.meta_capi_events",
      "public.meta_capi_request_context",
    ],
    functions: [
      "public.record_contact_touch",
      "public.contact_last_activity",
      "private.meta_is_numeric",
      "private.meta_source_counts",
      "private.meta_touch_utm_id",
      "public.contact_touch_json",
      "public.contact_last_origin_touch",
      "public.contact_touches_content_code_trg",
      "public.contact_touches_meta_match_trg",
      "public.contact_touches_zz_channel_trg",
      "public.touch_channel",
      "public.resolve_meta_match",
      "public.resolve_meta_match_for_touch",
      "public.rematch_meta_touches",
      "public.set_touch_meta_match",
      "public.enrich_touch_ad_origin",
      "public.meta_action_canonical",
      "public.ads_crm_items",
      "public.ads_crm_metrics_v2",
      "public.ads_crm_cell_detail",
      "private.refresh_contact_attribution",
      "private.meta_touch_has_data",
      "private.meta_touch_utm_counts",
      "private.meta_touch_medium",
      "private.meta_medium_is_paid",
      "private.meta_medium_is_organic",
      "private.meta_name_tokens",
      "private.meta_tokens_qualify",
      "private.meta_rule_key",
      "private.meta_rematch_by_keys",
      "private.touch_effective_medium",
      "public.create_meta_match_rule",
      "public.delete_meta_match_rule",
      "private.enqueue_comment_backfill",
      "public.booking_last_touches",
    ],
  },
  {
    file: "00013_auditoria_y_avisos",
    title: "Historial y avisos",
    header: `El historial de cambios (audit_log: inmutable, nunca se edita ni se borra) y el
centro de avisos de la app (notifications), que tambien se entregan por email y WhatsApp segun
las preferencias de cada persona. Un Member ve los avisos de sus leads; Owner y Admin, los de
todo el negocio.`,
    tables: ["public.audit_log", "public.notifications"],
    functions: ["public.can_see_notification", "private.enqueue_notification_delivery"],
  },
  {
    file: "00014_ventas_y_pagos",
    title: "Ventas, pagos y afiliados",
    header: `Las ventas y sus pagos (la plata en centimos, siempre USD), el estado de la venta
derivado de sus pagos, la comision del procesador congelada al cobrar, los eventos de
automatizacion por cada cambio, los links de cada producto y los afiliados (la asignacion
sale solo del link o de una persona con permiso). Las escribe solo el servidor; la app lee
con las reglas de acceso (can_see_sale).`,
    tables: ["public.sales", "public.payments"],
    functions: [
      /^public\.affiliate_/,
      "public.validate_affiliate_settings",
      "private.affiliates_daily",
      /^public\.payments_/,
      /^private\.payments_/,
      "private.enqueue_payments_overdue_sweep",
      "private.enqueue_meta_capi_purchase",
      /^public\.sales_/,
      "public.can_see_sale",
      "public.can_see_sale_id",
      "public.cancel_sale",
      "public.create_sale",
      "public.derive_sale_status",
      "public.emit_sales_event",
      "public.refresh_sale_status",
      "public.sale_attribution_from_touch",
      "public.workspace_payment_method",
      "public.product_links_guard",
      "public.product_links_save",
      "public.validate_product_links",
      "public.find_contact_by_phone_or_email",
      "public.ads_crm_metrics",
    ],
  },
  {
    file: "00015_formularios_y_contratos",
    title: "Formularios, contratos y reporte de fin de dia",
    header: `Formularios, encuestas y contratos: cada version publicada queda congelada, la
definicion publica sale solo por get_public_form (lista blanca) y cada respuesta crea o
vincula el contacto correcto con su atribucion. La firma de un contrato guarda la huella del
texto firmado y su evidencia no se puede cambiar. El reporte de fin de dia (eod_reports) es
un tipo de formulario del equipo: un reporte por persona y dia.`,
    tables: ["public.forms", "public.form_versions", "public.form_submissions", "public.contract_signatures", "public.eod_reports"],
    functions: [
      "public.can_see_form_submission",
      "public.can_view_forms",
      "public.contract_render_matches",
      "public.contract_signatures_protect_evidence",
      "public.find_contact_for_form",
      "public.form_metrics_daily",
      "public.form_versions_protect_published",
      "public.get_public_form",
      "public.publish_form_version",
      "public.record_contract_signature",
      "public.submit_form_response",
      "public.can_view_eod_all",
      "public.save_eod_draft",
      "public.submit_eod_report",
      "private.enqueue_eod_reminders",
    ],
  },
  {
    file: "00016_tareas",
    title: "Tareas",
    header: `Las tareas del equipo: responsable, seguidores, proyecto (texto), fechas y
dependencias. Completar una tarea corre las fechas de las que dependen de ella (solo para
atras) en una transaccion. Se borran con borrado logico; el barrido de vencimientos avisa
una vez por tarea y fecha.`,
    tables: ["public.tasks"],
    functions: [
      "public.can_see_task",
      "public.can_see_task_id",
      "public.can_view_tasks",
      "public.can_edit_tasks",
      "public.can_delete_tasks",
      "public.complete_task_with_shifts",
      "public.delete_task",
      "public.set_task_blockers",
      "public.task_shift_context",
      "public.tasks_before_write",
      "public.tasks_clean_member_refs",
      "private.enqueue_tasks_due_sweep",
    ],
  },
  {
    file: "00017_grabaciones",
    title: "Grabaciones (Fathom y el analizador de llamadas)",
    header: `Las llamadas que graba cada persona en Fathom (calls) y los analizadores por tipo
de reunion. La copia de lo que dijo la IA solo cambia con una corrida nueva. El refresh
token de una conexion se renueva con un candado en la base (es de un solo uso).`,
    tables: ["public.calls", "public.call_analysis_profiles"],
    functions: [
      "public.can_see_call",
      "public.can_see_call_id",
      "public.calls_protect_analysis_ai",
      "public.claim_oauth_refresh",
      "public.release_oauth_refresh",
      "public.set_ai_background_task_settings",
      "private.enqueue_fathom_sync",
    ],
  },
  {
    file: "00018_finanzas_y_comisiones",
    title: "Finanzas y comisiones",
    header: `Gastos (manuales, que se repiten y automaticos), proveedores y comisiones: una
comision por pago cobrado y rol, calculada con las reglas del negocio, y su liquidacion
como gasto. Nada se borra: se anula, se pausa o se archiva.`,
    tables: ["public.vendors", "public.recurring_expenses", "public.expenses", "public.commission_rules", "public.commissions"],
    functions: [
      /^private\.cm_/,
      /^private\.commission/,
      /^private\.expenses_/,
      "private.enqueue_commissions_for_payment",
      "private.enqueue_finance_daily",
      /^public\.commission_/,
      "public.can_see_commission",
      "public.create_commission_payout",
      "public.generate_commissions_for_payment",
      "public.revert_commissions_for_payment",
      "public.mark_expenses_overdue",
      "public.upsert_auto_expense",
      "public.decide_auto_expense_action",
    ],
  },
  {
    file: "00019_disenador_ia",
    title: "Diseñador IA",
    header: `Diseños, plantillas y sus versiones, y las conversaciones con la IA (ai_threads y
ai_messages, genericas). El link publico de un diseño sale solo por design_public_get y
muestra la ultima version publicada.`,
    tables: ["public.design_templates", "public.designs", "public.design_versions", "public.ai_threads", "public.ai_messages"],
    functions: [
      "private.design_new_code",
      "private.enqueue_design_cleanup",
      "public.contacts_designs_on_merge",
      "public.design_doc_check",
      "public.design_public_get",
      "public.designs_set_code",
      "public.validate_design_doc",
      "public.validate_design_settings",
      "public.workspaces_design_settings_check",
    ],
  },
  {
    file: "00020_servicios_y_portal",
    title: "Servicios y portal",
    header: `Lo que pasa con cada cliente despues de la venta: el servicio, su camino (fases y
pasos), el semaforo y los accesos al portal; y lo del portal del estudiante (programa,
evaluaciones, calendario, asistencia, comunidad y tutor). Vive en sus propios esquemas:
app_servicio (expuesto en la API, solo lectura con reglas de acceso) y app_servicio_portal
(cerrado). El modulo se prende por negocio y nace apagado; sus disparadores sobre tablas del
resto del sistema nunca hacen fallar lo que los dispara.`,
    tables: [/^app_servicio\./, /^app_servicio_portal\./],
    functions: [/^app_servicio\./, "private.enqueue_svc_daily"],
  },
  {
    file: "00021_trabajos_y_cron",
    title: "Trabajos programados y cron",
    header: `La cola interna de trabajos (scheduled_jobs), el registro de webhooks recibidos
(para no procesar dos veces el mismo), el tope por IP de los endpoints publicos, la
configuracion del sistema y los cron de pg_cron.

Casi todos los cron llaman a una ruta /api/cron/<nombre> de la app con
private.call_app_cron, que lee la URL de la app y el secreto del cron desde Vault
(se cargan con private.set_system_secret). Los que corren seguido pasan antes por
una guarda (private.call_app_cron_if_work): solo llaman si hay algo que hacer, y
igual una vez cada tanto por seguridad. Los de la misma frecuencia (15 s, 1 min y
5 min) son un solo trabajo de pg_cron (private.cron_tick_*), con cada parte en su
bloque: una que falla no frena a las otras. Los demas corren en la base: las purgas
de lo borrado (pasados 30 dias) y de lo vencido (mensajes, borradores, eventos, avisos,
historial de cron y de pg_net).`,
    tables: ["public.scheduled_jobs", "public.webhook_events", "public.rate_limits", "private.system_config", "private.cron_guard_state", "private.cron_tick_errors"],
    functions: [
      "public.push_debounced_job",
      "public.bump_rate_limit",
      "public.purge_rate_limits",
      "private.call_app_cron",
      "private.call_app_cron_if_work",
      "private.cron_guard_decide",
      "private.cron_has_work",
      /^private\.cron_work_/,
      /^private\.cron_tick_/,
      "private.purge_scheduled_jobs",
      "private.purge_cron_run_details",
      "private.purge_pg_net_responses",
      "public.purge_soft_deleted",
      "public.purge_old_messages",
      "public.purge_zernio_inbound_messages",
      "public.purge_agent_draft_content",
      "public.purge_agent_run_step_content",
      "public.purge_automation_events",
      "public.purge_read_notifications",
      "public.purge_stale_unread_notifications",
      "public.purge_send_windows",
      "public.purge_trigger_fires",
    ],
    cron: "*",
  },
  {
    file: "00022_funciones_transversales",
    title: "Funciones transversales",
    header: `Funciones que cruzan varias areas: fusionar dos contactos (en una sola
transaccion: mueve conversaciones, etiquetas, campos, secuencias, atribucion, reuniones
y el resto de lo que cuelga del contacto) y los tableros del chat y de costos de IA,
que leen conversaciones, mensajes, corridas del agente e historial a la vez.`,
    tables: [],
    functions: [
      "public.merge_contacts",
      "public.ai_cost_report",
      "public.ai_runs_scatter",
      "public.ai_spend_by_day",
      "public.draft_queue_metrics",
      "public.draft_queue_metrics_by_person",
      "public.message_classification_status",
      "public.message_text_volumes",
      /^public\.chat_/,
    ],
  },
  {
    file: "00023_archivos",
    title: "Archivos",
    header: `Las carpetas de archivos (buckets de Storage) y sus reglas de acceso. En las
privadas, el primer segmento de la ruta de cada archivo es el workspace: es lo unico
que miran las reglas.`,
    tables: [],
    functions: ["public.can_read_chat_media", "public.can_read_email_attachment", "public.can_read_knowledge"],
    buckets: "*",
  },
];

// Si un objeto que va "con su tabla" tiene que ir a un area puntual, se dice aca.
// (Vacio: el generador lo decide solo, mirando de que depende.)
export const OVERRIDES = {};
