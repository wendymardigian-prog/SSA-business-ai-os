// Las areas de la base de la plantilla de estudiantes: un archivo de migracion por area.
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
los roles con sus permisos, las invitaciones y las preferencias de cada persona.

Las reglas de acceso de todo el sistema se apoyan en estas funciones: quien es
miembro, quien es Owner o Admin y que permisos tiene cada rol. Cuando alguien crea su
cuenta, un disparador sobre auth.users le arma su espacio de trabajo.`,
    tables: ["public.workspaces", "public.workspace_roles", "public.workspace_members", "public.workspace_invites", "public.user_preferences"],
    functions: [
      "public.is_workspace_member",
      "public.is_workspace_admin",
      "public.is_workspace_owner",
      "public.has_permission",
      "public.permission_scope",
      "public.can_give_role",
      "public.can_grant_permissions",
      "public.can_grant_channels",
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
      "private.normalize_channel_grant",
      "private.role_channel_grant",
      "private.workspace_roles_channels_default",
      "private.channels_from_legacy",
      "private.member_channels",
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
marcas "conocido" y "cliente", el "no contactar" y las importaciones por CSV. Un Member solo ve los
contactos que le corresponden (can_see_contact).`,
    tables: [
      "public.contacts",
      "public.contact_channels",
      "public.tags",
      "public.contact_tags",
      "public.custom_field_definitions",
      "public.contact_custom_fields",
      "public.contact_notes",
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
    ],
  },
  {
    file: "00006_bandeja",
    title: "Bandeja",
    header: `La bandeja multicanal: conversaciones (una por canal y contacto) y sus mensajes,
reacciones, llamadas de WhatsApp, stickers, comentarios de Instagram, el responsable
de cada chat y sus reglas de asignacion por cuenta, el tope de envios automaticos por
hora, los patrones de mensajes y el registro de emails salientes.

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
    ],
    functions: [
      "public.can_see_conversation",
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
con su auto-pausa cuando el contacto responde, los envios masivos y sus analiticas.`,
    tables: [
      "public.flows",
      "public.flow_versions",
      "public.triggers",
      "public.flow_sessions",
      "public.flow_send_claims",
      "public.trigger_fires",
      "public.automation_events",
      "public.sequences",
      "public.sequence_enrollments",
      "public.broadcasts",
      "public.broadcast_recipients",
      "public.analytics_events",
    ],
    functions: [
      "public.emit_automation_event",
      "public.triggers_set_workspace_id",
      "public.pause_sequences_on_reply",
      "public.claim_sequence_enrollments",
      "public.increment_broadcast_failed",
      "public.increment_broadcast_sent",
      "private.fill_automation_source",
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
    ],
    functions: [
      "public.can_see_booking",
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
su vinculo con el anuncio de Meta y con la pieza de contenido.

Un metric que la red no dio queda en null: nunca se inventa un cero.`,
    tables: [
      "public.social_post_metrics_daily",
      "public.social_account_metrics_daily",
      "public.meta_campaigns",
      "public.meta_adsets",
      "public.meta_ads",
      "public.meta_ads_insights_daily",
      "public.contact_touches",
    ],
    functions: [
      "public.record_contact_touch",
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
      "private.enqueue_comment_backfill",
    ],
  },
  {
    file: "00013_auditoria_y_avisos",
    title: "Historial y avisos",
    header: `El historial de cambios (audit_log: inmutable, nunca se edita ni se borra) y el
centro de avisos de la app (notifications). Un Member ve los avisos de sus leads;
Owner y Admin, los de todo el negocio.`,
    tables: ["public.audit_log", "public.notifications"],
    functions: ["public.can_see_notification"],
  },
  {
    file: "00014_trabajos_y_cron",
    title: "Trabajos programados y cron",
    header: `La cola interna de trabajos (scheduled_jobs), el registro de webhooks recibidos
(para no procesar dos veces el mismo), el tope por IP de los endpoints publicos, la
configuracion del sistema y los cron de pg_cron.

Casi todos los cron llaman a una ruta /api/cron/<nombre> de la app con
private.call_app_cron, que lee la URL de la app y el secreto del cron desde Vault
(se cargan con private.set_system_secret). Los demas corren en la base: las purgas
de lo borrado (pasados 30 dias) y de lo vencido (mensajes, borradores, eventos, avisos,
historial de cron y de pg_net).`,
    tables: ["public.scheduled_jobs", "public.webhook_events", "public.rate_limits", "private.system_config"],
    functions: [
      "public.push_debounced_job",
      "public.bump_rate_limit",
      "public.purge_rate_limits",
      "private.call_app_cron",
      "private.purge_cron_run_details",
      "private.purge_pg_net_responses",
      "public.purge_soft_deleted",
      "public.purge_old_messages",
      "public.purge_zernio_inbound_messages",
      "public.purge_agent_draft_content",
      "public.purge_agent_run_step_content",
      "public.purge_automation_events",
      "public.purge_read_notifications",
      "public.purge_send_windows",
      "public.purge_trigger_fires",
    ],
    cron: "*",
  },
  {
    file: "00015_funciones_transversales",
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
    file: "00016_archivos",
    title: "Archivos",
    header: `Las carpetas de archivos (buckets de Storage) y sus reglas de acceso. En las
privadas, el primer segmento de la ruta de cada archivo es el workspace: es lo unico
que miran las reglas.`,
    tables: [],
    functions: [],
    buckets: "*",
  },
];

// Si un objeto que va "con su tabla" tiene que ir a un area puntual, se dice aca.
// (Vacio: el generador lo decide solo, mirando de que depende.)
export const OVERRIDES = {};
