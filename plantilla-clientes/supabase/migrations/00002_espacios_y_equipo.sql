-- ============================================================================
-- Espacios de trabajo y equipo
--
-- Cada negocio es un espacio de trabajo (workspace). Aca viven el negocio, su equipo,
-- los roles con sus permisos, las invitaciones y el perfil y las preferencias de cada persona.
--
-- Las reglas de acceso de todo el sistema se apoyan en estas funciones: quien es
-- miembro, quien es Owner o Admin y que permisos tiene cada rol. Cuando alguien crea su
-- cuenta, un disparador sobre auth.users le arma su espacio de trabajo.
--
-- Tambien las vistas guardadas de las tablas (propias o compartidas) y la que cada persona
-- abre por defecto.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid NOT NULL,
  timezone text NOT NULL,
  timezone_source text DEFAULT 'browser'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  notification_prefs jsonb DEFAULT '{}'::jsonb NOT NULL,
  nav_favorites jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_preferences_nav_favorites_check CHECK ((jsonb_typeof(nav_favorites) = 'object'::text)),
  CONSTRAINT user_preferences_notification_prefs_check CHECK ((jsonb_typeof(notification_prefs) = 'object'::text)),
  CONSTRAINT user_preferences_timezone_source_check CHECK ((timezone_source = ANY (ARRAY['browser'::text, 'manual'::text]))),
  CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.user_preferences IS 'Preferencias por persona, no por workspace: la zona horaria y que avisos le llegan y por donde.';
COMMENT ON COLUMN public.user_preferences.notification_prefs IS 'Lo que la persona cambio de sus avisos: { evento: { bell, email, whatsapp } }. Lo que falta usa el valor por defecto de lib/notifications/preferences.ts.';
COMMENT ON COLUMN public.user_preferences.nav_favorites IS 'Pantalla favorita de cada seccion del menu: { grupo: href }. La valida el codigo (lib/nav/items.ts).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_preferences FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid NOT NULL,
  avatar_path text,
  phone text,
  whatsapp_phone text,
  whatsapp_same_as_phone boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_profiles_avatar_path_check CHECK (((avatar_path IS NULL) OR (avatar_path ~~ ((user_id)::text || '/%'::text)))),
  CONSTRAINT user_profiles_phone_check CHECK (((phone IS NULL) OR (phone ~ '^\+[0-9]{8,15}$'::text))),
  CONSTRAINT user_profiles_whatsapp_phone_check CHECK (((whatsapp_phone IS NULL) OR (whatsapp_phone ~ '^\+[0-9]{8,15}$'::text))),
  CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.user_profiles IS 'Datos personales de cada persona del equipo (foto, telefono, WhatsApp), iguales en todos los negocios. El nombre sigue en auth.users.user_metadata.full_name.';
COMMENT ON COLUMN public.user_profiles.whatsapp_phone IS 'WhatsApp para los avisos que la persona elija. Solo se usa si whatsapp_same_as_phone es false; si no, vale phone.';
REVOKE ALL ON TABLE public.user_profiles FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.user_profiles FROM authenticated;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  global_keywords jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  ai_api_key text,
  ai_provider text DEFAULT 'openai'::text NOT NULL,
  lead_scope_enabled boolean DEFAULT true NOT NULL,
  unassigned_leads_visible_to_members boolean DEFAULT false NOT NULL,
  opt_out_phrases jsonb DEFAULT '["no me contactes", "no me contacten", "no me escribas mas", "no me escriban mas", "no quiero recibir mensajes", "dejen de escribirme", "dejame de escribir", "dar de baja", "darme de baja", "stop", "unsubscribe", "basta"]'::jsonb NOT NULL,
  persist_zernio_inbound boolean DEFAULT true NOT NULL,
  ai_daily_cost_limit_usd numeric(10,2),
  ai_monthly_cost_limit_usd numeric(10,2),
  timezone text DEFAULT 'UTC'::text NOT NULL,
  ai_background_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  content_media_retention_days integer DEFAULT 30 NOT NULL,
  content_copy_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  scheduling_auto_create_flows boolean DEFAULT true NOT NULL,
  scheduling_public_base_url text,
  persist_chat_media boolean DEFAULT true NOT NULL,
  chat_media_retention_days integer DEFAULT 180 NOT NULL,
  agent_escalate_on_unreadable boolean DEFAULT true NOT NULL,
  ai_daily_limit_action text DEFAULT 'disable'::text NOT NULL,
  ai_monthly_limit_action text DEFAULT 'disable'::text NOT NULL,
  ai_spend_alert_pct smallint,
  ai_task_prompt_active jsonb DEFAULT '{}'::jsonb NOT NULL,
  ai_task_models jsonb DEFAULT '{}'::jsonb NOT NULL,
  enabled_payment_methods text[] DEFAULT ARRAY['whop'::text, 'transferencia_cr'::text, 'transferencia_usa'::text, 'wise'::text, 'binance'::text] NOT NULL,
  max_discount_percent numeric(5,2),
  overdue_grace_days integer DEFAULT 0 NOT NULL,
  sales_auto_create_flows boolean DEFAULT true NOT NULL,
  payment_methods jsonb DEFAULT '[{"key": "whop", "name": "Whop (registrado a mano)", "active": true, "fee_fixed": 0, "created_at": "2026-10-15T00:00:00.000Z", "fee_percent": 0}, {"key": "transferencia_cr", "name": "Transferencia CR", "active": true, "fee_fixed": 0, "created_at": "2026-10-15T00:00:00.000Z", "fee_percent": 0}, {"key": "transferencia_usa", "name": "Transferencia USA", "active": true, "fee_fixed": 0, "created_at": "2026-10-15T00:00:00.000Z", "fee_percent": 0}, {"key": "wise", "name": "Wise", "active": true, "fee_fixed": 0, "created_at": "2026-10-15T00:00:00.000Z", "fee_percent": 0}, {"key": "binance", "name": "Binance", "active": true, "fee_fixed": 0, "created_at": "2026-10-15T00:00:00.000Z", "fee_percent": 0}]'::jsonb NOT NULL,
  finance_settings jsonb DEFAULT '{"meta_ads": {}, "processor_fees": {}, "auto_close_days": 3, "expense_categories": [{"key": "ads_meta", "name": "Publicidad (Meta)", "color": "#2563eb", "group": "adquisicion", "system": true, "archived_at": null}, {"key": "marketing", "name": "Marketing y contenido", "color": "#7c3aed", "group": "adquisicion", "system": true, "archived_at": null}, {"key": "sales_team", "name": "Equipo de ventas", "color": "#db2777", "group": "adquisicion", "system": true, "archived_at": null}, {"key": "commissions", "name": "Comisiones del equipo", "color": "#e11d48", "group": "adquisicion", "system": true, "archived_at": null}, {"key": "delivery_team", "name": "Equipo de entrega", "color": "#0d9488", "group": "entrega", "system": true, "archived_at": null}, {"key": "delivery_tools", "name": "Herramientas de entrega", "color": "#16a34a", "group": "entrega", "system": true, "archived_at": null}, {"key": "software", "name": "Software y suscripciones", "color": "#ca8a04", "group": "operacion", "system": true, "archived_at": null}, {"key": "processor_fees", "name": "Comisiones de procesador", "color": "#ea580c", "group": "operacion", "system": true, "archived_at": null}, {"key": "professional", "name": "Contabilidad y legal", "color": "#4f46e5", "group": "operacion", "system": true, "archived_at": null}, {"key": "admin_team", "name": "Equipo administrativo", "color": "#0891b2", "group": "operacion", "system": true, "archived_at": null}, {"key": "taxes", "name": "Impuestos", "color": "#64748b", "group": "otro", "system": true, "archived_at": null}, {"key": "other", "name": "Otros", "color": "#78716c", "group": "otro", "system": true, "archived_at": null}]}'::jsonb NOT NULL,
  attribution_settings jsonb DEFAULT '{"content_inherit_days": 7, "links_append_default": false, "comments_create_contact": {"tiktok": true, "instagram": false}, "links_track_clicks_default": true}'::jsonb NOT NULL,
  commission_settings jsonb DEFAULT '{"roles": [{"key": "vendedor", "name": "Vendedor", "payee": "sale_vendedor", "active": true, "system": true, "created_at": "2026-10-15T00:00:00.000Z"}, {"key": "setter", "name": "Setter", "payee": "sale_setter", "active": true, "system": true, "created_at": "2026-10-15T00:00:00.000Z"}, {"key": "contenido", "name": "Contenido", "payee": "content_assignee", "active": true, "system": true, "created_at": "2026-10-15T00:00:00.000Z"}, {"key": "pauta", "name": "Pauta", "payee": "fixed", "active": true, "system": true, "created_at": "2026-10-15T00:00:00.000Z"}]}'::jsonb NOT NULL,
  contact_status_settings jsonb DEFAULT '{"closer": [{"key": "llamada_agendada", "name": "Llamada agendada", "color": "#7c3aed", "archived_at": null}, {"key": "no_se_presento", "name": "No se presentó", "color": "#ca8a04", "archived_at": null}, {"key": "en_seguimiento", "name": "En seguimiento", "color": "#0891b2", "archived_at": null}, {"key": "propuesta_enviada", "name": "Propuesta enviada", "color": "#2563eb", "archived_at": null}, {"key": "ganado", "name": "Ganado", "color": "#16a34a", "archived_at": null}, {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}], "setter": [{"key": "nuevo", "name": "Nuevo", "color": "#64748b", "archived_at": null}, {"key": "contactado", "name": "Contactado", "color": "#2563eb", "archived_at": null}, {"key": "en_conversacion", "name": "En conversación", "color": "#0891b2", "archived_at": null}, {"key": "calificado", "name": "Calificado", "color": "#16a34a", "archived_at": null}, {"key": "agendado", "name": "Agendado", "color": "#7c3aed", "archived_at": null}, {"key": "no_calificado", "name": "No calificado", "color": "#ca8a04", "archived_at": null}, {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}]}'::jsonb NOT NULL,
  known_contacts_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  brand_name text,
  brand_logo_path text,
  brand_color text,
  ai_language_style text,
  customer_contacts_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  email_footer_address text,
  team_alerts_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  website_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  design_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  qualification_settings jsonb DEFAULT '{"levels": [{"name": "No califica", "level": 1, "description": "No encaja con lo que ofrecemos o no tiene un interés real."}, {"name": "Bajo", "level": 2, "description": "Muestra algo de interés, pero le faltan varias condiciones: necesidad, presupuesto o momento."}, {"name": "Medio", "level": 3, "description": "Tiene la necesidad y el interés, pero falta confirmar el presupuesto o quién decide."}, {"name": "Bueno", "level": 4, "description": "Cumple casi todo: necesidad clara, presupuesto y decide; falta dar el siguiente paso."}, {"name": "Ideal", "level": 5, "description": "Cliente ideal: cumple todo y está listo para avanzar."}]}'::jsonb NOT NULL,
  services_enabled boolean DEFAULT false NOT NULL,
  portal_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  portal_settings_rev integer DEFAULT 0 NOT NULL,
  affiliate_settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  affiliate_settings_rev integer DEFAULT 0 NOT NULL,
  CONSTRAINT workspaces_pkey PRIMARY KEY (id),
  CONSTRAINT workspaces_slug_key UNIQUE (slug),
  CONSTRAINT workspaces_ai_daily_limit_action_check CHECK ((ai_daily_limit_action = ANY (ARRAY['disable'::text, 'notify'::text]))),
  CONSTRAINT workspaces_ai_language_style_check CHECK (((ai_language_style IS NULL) OR ((char_length(btrim(ai_language_style)) >= 1) AND (char_length(btrim(ai_language_style)) <= 200)))),
  CONSTRAINT workspaces_ai_monthly_limit_action_check CHECK ((ai_monthly_limit_action = ANY (ARRAY['disable'::text, 'notify'::text]))),
  CONSTRAINT workspaces_ai_spend_alert_pct_check CHECK (((ai_spend_alert_pct IS NULL) OR ((ai_spend_alert_pct >= 1) AND (ai_spend_alert_pct <= 99)))),
  CONSTRAINT workspaces_attribution_settings_check CHECK ((jsonb_typeof(attribution_settings) = 'object'::text)),
  CONSTRAINT workspaces_brand_color_check CHECK (((brand_color IS NULL) OR (brand_color ~ '^#[0-9a-fA-F]{6}$'::text))),
  CONSTRAINT workspaces_brand_logo_path_check CHECK (((brand_logo_path IS NULL) OR (brand_logo_path ~~ ((id)::text || '/logo/%'::text)))),
  CONSTRAINT workspaces_brand_name_check CHECK (((brand_name IS NULL) OR ((char_length(btrim(brand_name)) >= 1) AND (char_length(btrim(brand_name)) <= 60)))),
  CONSTRAINT workspaces_chat_media_retention_check CHECK (((chat_media_retention_days >= 0) AND (chat_media_retention_days <= 3650))),
  CONSTRAINT workspaces_commission_settings_check CHECK (COALESCE(((jsonb_typeof(commission_settings) = 'object'::text) AND (jsonb_typeof((commission_settings -> 'roles'::text)) = 'array'::text)), false)),
  CONSTRAINT workspaces_content_copy_settings_object CHECK ((jsonb_typeof(content_copy_settings) = 'object'::text)),
  CONSTRAINT workspaces_email_footer_address_len CHECK (((email_footer_address IS NULL) OR (char_length(email_footer_address) <= 300))),
  CONSTRAINT workspaces_enabled_payment_methods_check CHECK ((enabled_payment_methods <@ ARRAY['whop'::text, 'transferencia_cr'::text, 'transferencia_usa'::text, 'wise'::text, 'binance'::text])),
  CONSTRAINT workspaces_finance_settings_check CHECK (((jsonb_typeof(finance_settings) = 'object'::text) AND (COALESCE(jsonb_typeof((finance_settings -> 'expense_categories'::text)), ''::text) = 'array'::text))),
  CONSTRAINT workspaces_max_discount_check CHECK (((max_discount_percent IS NULL) OR ((max_discount_percent >= (0)::numeric) AND (max_discount_percent <= (100)::numeric)))),
  CONSTRAINT workspaces_opt_out_phrases_is_array CHECK ((jsonb_typeof(opt_out_phrases) = 'array'::text)),
  CONSTRAINT workspaces_overdue_grace_check CHECK (((overdue_grace_days >= 0) AND (overdue_grace_days <= 30))),
  CONSTRAINT workspaces_payment_methods_check CHECK ((jsonb_typeof(payment_methods) = 'array'::text)),
  CONSTRAINT workspaces_team_alerts_settings_check CHECK ((jsonb_typeof(team_alerts_settings) = 'object'::text)),
  CONSTRAINT workspaces_website_settings_check CHECK ((jsonb_typeof(website_settings) = 'object'::text))
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.workspaces.lead_scope_enabled IS 'SIN USO desde la 00136: el alcance de leads sale del rol (workspace_roles.permissions.scopes.leads). Se borra en una migracion aparte.';
COMMENT ON COLUMN public.workspaces.unassigned_leads_visible_to_members IS 'SIN USO desde la 00136: lo reemplaza el alcance leads=own_unassigned del rol. Se borra en una migracion aparte.';
COMMENT ON COLUMN public.workspaces.opt_out_phrases IS 'Frases que marcan un contacto como "no contactar" cuando aparecen en un mensaje entrante (F18). Se editan desde Settings. Se comparan por palabra completa, sin acentos ni mayusculas.';
COMMENT ON COLUMN public.workspaces.persist_zernio_inbound IS 'Si se guardan localmente los mensajes entrantes de los canales de Zernio (Instagram). Apagado, el receptor no inserta y el sistema se comporta como antes de la Fase 3. No afecta a WhatsApp ni a los salientes.';
COMMENT ON COLUMN public.workspaces.ai_daily_cost_limit_usd IS 'Tope diario de gasto de IA de todo el workspace (todas las fuentes). NULL = sin tope global. Corte del dia en la zona del negocio.';
COMMENT ON COLUMN public.workspaces.timezone IS 'Zona horaria IANA del negocio. Los dashboards cortan dias y semanas con esta zona (F3). Default America/Costa_Rica.';
COMMENT ON COLUMN public.workspaces.content_media_retention_days IS 'Dias que se conserva la media despues de publicada. 0 = no se borra nunca.';
COMMENT ON COLUMN public.workspaces.content_copy_settings IS 'Voz de marca para generar copy: { voice, audience, examples[], avoid }. Vacio = se genera sin guia de estilo.';
COMMENT ON COLUMN public.workspaces.scheduling_auto_create_flows IS 'Crear los 7 flujos sugeridos (apagados) al crear un evento (F49).';
COMMENT ON COLUMN public.workspaces.scheduling_public_base_url IS 'Dominio propio de las paginas publicas de agenda (F42). null = NEXT_PUBLIC_APP_URL.';
COMMENT ON COLUMN public.workspaces.persist_chat_media IS 'Copiar a nuestro Storage la media que llega por el chat. Apagarlo no borra lo ya guardado: los mensajes nuevos quedan solo con la URL del proveedor, que vence.';
COMMENT ON COLUMN public.workspaces.chat_media_retention_days IS 'Dias que se conserva el archivo de un adjunto del chat. 0 = no borrar nunca. La TRANSCRIPCION nunca se borra por retencion: es texto, pesa nada, y es el contexto del agente.';
COMMENT ON COLUMN public.workspaces.agent_escalate_on_unreadable IS 'Si el agente escala a una persona cuando no puede interpretar un mensaje de la rafaga. Apagarlo hace que vuelva a responder a ciegas.';
COMMENT ON COLUMN public.workspaces.ai_daily_limit_action IS 'Que pasa al llegar al tope diario de IA: disable = frena la IA hasta la medianoche local; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_monthly_limit_action IS 'Que pasa al llegar al tope mensual de IA: disable = apaga el agente; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_spend_alert_pct IS 'Avisar al llegar a este % de cualquiera de los dos topes (1 a 99). NULL = sin aviso previo. Una notificacion por tope y periodo.';
COMMENT ON COLUMN public.workspaces.ai_task_models IS 'Modelo elegido por tarea de IA: {"<tarea>": {"provider": "...", "model": "..."}}. Sin entrada: el modelo por defecto del negocio.';
COMMENT ON COLUMN public.workspaces.enabled_payment_methods IS 'Metodos de pago que ofrece el selector (la lista completa esta en lib/sales/payment-methods.ts). Un pago que ya usa uno deshabilitado lo sigue mostrando.';
COMMENT ON COLUMN public.workspaces.max_discount_percent IS 'Tope de descuento de una venta, en %. NULL = sin tope. Pasarlo exige alcance "todos" en Ventas (00161).';
COMMENT ON COLUMN public.workspaces.overdue_grace_days IS 'Dias de gracia antes de marcar un pago moroso (0 a 30).';
COMMENT ON COLUMN public.workspaces.sales_auto_create_flows IS 'Si Ventas crea apagados los flujos de cobranza precreados (F38).';
COMMENT ON COLUMN public.workspaces.payment_methods IS 'Metodos de pago del negocio: [{key,name,fee_percent,fee_fixed,active,created_at}]. La key no cambia nunca; no se borran, se desactivan. Los escribe `updatePaymentMethods` (sales.settings). `enabled_payment_methods` quedo sin leerse.';
COMMENT ON COLUMN public.workspaces.finance_settings IS 'Configuracion de Finanzas: { expense_categories:[{key,name,color,group,system,archived_at}], processor_fees:{}, meta_ads:{}, auto_close_days }. La key de una categoria no cambia nunca; no se borran, se archivan. Se escribe solo por Server Action (expenses.manage).';
COMMENT ON COLUMN public.workspaces.known_contacts_settings IS 'A quien van los chats de un conocido (00256): {"by_channel": {"<channel_id>": "<user_id>"}, "default_user_id": "<user_id>"}. Sin nada, al Owner.';
COMMENT ON COLUMN public.workspaces.brand_name IS 'Nombre del negocio que ven los leads (formularios, contratos, agenda, emails). NULL = el de la instalacion (NEXT_PUBLIC_BRAND_NAME).';
COMMENT ON COLUMN public.workspaces.brand_logo_path IS 'Path del logo en el bucket publico brand-assets (<workspace>/logo/<id>.<ext>). NULL = el de la instalacion.';
COMMENT ON COLUMN public.workspaces.brand_color IS 'Color principal en #rrggbb. NULL = el de la instalacion (NEXT_PUBLIC_BRAND_COLOR).';
COMMENT ON COLUMN public.workspaces.ai_language_style IS 'Como escribe la IA de este negocio, por ejemplo "español rioplatense (vos/tenés)". NULL = AI_LANGUAGE_STYLE.';
COMMENT ON COLUMN public.workspaces.customer_contacts_settings IS 'A quien van los chats de un cliente (00268): {"by_channel": {"<channel_id>": "<user_id>"}, "default_user_id": "<user_id>"}. Sin nada, el responsable no cambia.';
COMMENT ON COLUMN public.workspaces.team_alerts_settings IS 'Avisos al equipo: { whatsapp_channel_id } = el canal de WhatsApp (Evolution) desde el que se mandan. Sin canal, nadie recibe avisos por WhatsApp.';
COMMENT ON COLUMN public.workspaces.website_settings IS 'La web del negocio: { allowed_origins: [{ origin, dev }] } = los dominios exactos desde los que un navegador puede mandar formularios y pedir un link de baja (CORS). Lo escribe el servidor (lib/actions/website-settings.ts).';
COMMENT ON COLUMN public.workspaces.services_enabled IS 'Modulo de Servicios prendido en este negocio (F97). Sin pantalla: lo cambia la plataforma con app_servicio.set_module_enabled (service_role). Apagado, ningun trigger del modulo hace nada (00330).';
COMMENT ON COLUMN public.workspaces.portal_settings IS 'Servicios v12: Ajustes del portal (F43). Solo la escribe app_servicio.portal_admin_save_settings; extensions solo la plataforma (00332).';
COMMENT ON COLUMN public.workspaces.affiliate_settings IS 'Las reglas de afiliados (F72). {} = los defaults de lib/affiliates/assign.ts.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.workspaces FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.table_views (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  table_key text NOT NULL,
  name text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  owner_id uuid NOT NULL,
  visibility text DEFAULT 'private'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT table_views_pkey PRIMARY KEY (id),
  CONSTRAINT table_views_config_check CHECK (((jsonb_typeof(config) = 'object'::text) AND (pg_column_size(config) < 20000))),
  CONSTRAINT table_views_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 60))),
  CONSTRAINT table_views_table_key_check CHECK ((table_key ~ '^[a-z][a-z0-9_]{1,40}$'::text)),
  CONSTRAINT table_views_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'workspace'::text, 'selected'::text]))),
  CONSTRAINT table_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT table_views_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.table_views ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.table_views IS 'Vistas guardadas de una tabla (columnas y filtros). Privadas, para todo el equipo o para personas elegidas. Escribe solo save_table_view / delete_table_view.';
REVOKE ALL ON TABLE public.table_views FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.table_views FROM authenticated;

CREATE TABLE IF NOT EXISTS public.table_view_defaults (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  table_key text NOT NULL,
  view_id uuid NOT NULL,
  assigned_by uuid,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT table_view_defaults_pkey PRIMARY KEY (workspace_id, user_id, table_key),
  CONSTRAINT table_view_defaults_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT table_view_defaults_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT table_view_defaults_view_id_fkey FOREIGN KEY (view_id) REFERENCES public.table_views(id) ON DELETE CASCADE,
  CONSTRAINT table_view_defaults_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.table_view_defaults ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.table_view_defaults IS 'La vista predeterminada de cada persona por tabla. La puede dejar la propia persona o un Owner/Admin (assigned_by).';
REVOKE ALL ON TABLE public.table_view_defaults FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.table_view_defaults FROM authenticated;

CREATE TABLE IF NOT EXISTS public.table_view_members (
  view_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT table_view_members_pkey PRIMARY KEY (view_id, user_id),
  CONSTRAINT table_view_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT table_view_members_view_id_fkey FOREIGN KEY (view_id) REFERENCES public.table_views(id) ON DELETE CASCADE
);
ALTER TABLE public.table_view_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.table_view_members FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.table_view_members FROM authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  system_role text,
  permissions jsonb DEFAULT '{"keys": [], "scopes": {"leads": "own", "conversations": "own"}}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_roles_pkey PRIMARY KEY (id),
  CONSTRAINT workspace_roles_system_check CHECK (((system_role IS NULL) OR (system_role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))),
  CONSTRAINT workspace_roles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_roles ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.workspace_roles IS 'Los roles de un workspace: los tres de sistema (system_role no nulo, no editables) y los personalizados.';
COMMENT ON COLUMN public.workspace_roles.permissions IS 'Las claves de permiso y los alcances. El catalogo vive en lib/auth/permissions.ts.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.workspace_roles FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  email text NOT NULL,
  role text DEFAULT 'member'::text NOT NULL,
  invited_by uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval),
  role_id uuid,
  delivery text DEFAULT 'email'::text NOT NULL,
  email_status text,
  email_error text,
  last_sent_at timestamp with time zone,
  send_count integer DEFAULT 0 NOT NULL,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  CONSTRAINT workspace_invites_pkey PRIMARY KEY (id),
  CONSTRAINT workspace_invites_delivery_check CHECK ((delivery = ANY (ARRAY['email'::text, 'link'::text]))),
  CONSTRAINT workspace_invites_email_status_check CHECK (((email_status IS NULL) OR (email_status = ANY (ARRAY['sent'::text, 'failed'::text, 'not_configured'::text])))),
  CONSTRAINT workspace_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text]))),
  CONSTRAINT workspace_invites_send_count_check CHECK ((send_count >= 0)),
  CONSTRAINT workspace_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text]))),
  CONSTRAINT workspace_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id),
  CONSTRAINT workspace_invites_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_invites_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.workspace_roles(id) ON DELETE SET NULL,
  CONSTRAINT workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.workspace_invites.role_id IS 'El rol con el que entra la persona. NULL = el rol base `role`. Si el rol se borra antes de aceptar, cae al Member de sistema.';
COMMENT ON COLUMN public.workspace_invites.delivery IS 'email = se mando un correo; link = solo se genero el link para pasarlo a mano.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.workspace_invites FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text DEFAULT 'owner'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  role_id uuid,
  closer_emails text[] DEFAULT '{}'::text[] NOT NULL,
  affiliate_code text,
  CONSTRAINT workspace_members_pkey PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_members_affiliate_code_format CHECK (((affiliate_code IS NULL) OR (affiliate_code ~ '^[a-z0-9]{4,24}$'::text))),
  CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))),
  CONSTRAINT workspace_members_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.workspace_roles(id) ON DELETE SET NULL,
  CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.workspace_members.role_id IS 'El rol con los permisos finos. `role` sigue siendo owner/admin/member y es lo que leen las policies viejas.';
COMMENT ON COLUMN public.workspace_members.closer_emails IS 'Los otros correos con los que esta persona graba en Fathom. Los carga ella en Mi Fathom.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.workspace_members FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.call_areas_of(p_permissions jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_permissions #>> '{scopes,calls}' = 'areas' AND jsonb_typeof(p_permissions -> 'call_areas') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_permissions -> 'call_areas'))
    ELSE ARRAY[]::text[]
  END
$function$;
REVOKE ALL ON FUNCTION private.call_areas_of(p_permissions jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.call_areas_of(p_permissions jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.call_areas_exceed(p_wanted jsonb, p_before jsonb, p_actor jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_wanted #>> '{scopes,calls}' IS DISTINCT FROM 'areas' THEN false
    WHEN p_actor #>> '{scopes,calls}' = 'all' THEN false
    WHEN p_before #>> '{scopes,calls}' = 'all' THEN false
    ELSE EXISTS (
      SELECT 1 FROM unnest(private.call_areas_of(p_wanted)) AS a(area_id)
      WHERE NOT (a.area_id = ANY (private.call_areas_of(p_before)))
        AND NOT (a.area_id = ANY (private.call_areas_of(p_actor)))
    )
  END
$function$;
REVOKE ALL ON FUNCTION private.call_areas_exceed(p_wanted jsonb, p_before jsonb, p_actor jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.call_areas_exceed(p_wanted jsonb, p_before jsonb, p_actor jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.channel_grant_exceeds(p_wanted jsonb, p_before jsonb, p_actor jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_wanted IS NULL THEN false
    WHEN private.channel_scope_rank(p_wanted ->> 'scope') > private.channel_scope_rank(p_before ->> 'scope')
     AND private.channel_scope_rank(p_wanted ->> 'scope') > private.channel_scope_rank(p_actor ->> 'scope') THEN true
    ELSE COALESCE((p_wanted -> 'reply') = 'true'::jsonb, false)
     AND NOT COALESCE((p_before -> 'reply') = 'true'::jsonb, false)
     AND NOT COALESCE((p_actor -> 'reply') = 'true'::jsonb, false)
  END
$function$;
REVOKE ALL ON FUNCTION private.channel_grant_exceeds(p_wanted jsonb, p_before jsonb, p_actor jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.channel_grant_exceeds(p_wanted jsonb, p_before jsonb, p_actor jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.channels_from_legacy(p_workspace_id uuid, p_permissions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_keys   jsonb := COALESCE(p_permissions -> 'keys', '[]'::jsonb);
  v_scopes jsonb := COALESCE(p_permissions -> 'scopes', '{}'::jsonb);
  v_scope  text;
  v_ig_v   boolean; v_wa_v boolean; v_em_v boolean;
  v_ig_r   boolean; v_wa_r boolean; v_em_r boolean;
  v_by     jsonb;
BEGIN
  IF jsonb_typeof(v_keys) <> 'array' THEN v_keys := '[]'::jsonb; END IF;
  IF jsonb_typeof(v_scopes) <> 'object' THEN v_scopes := '{}'::jsonb; END IF;

  v_ig_v := v_keys ? 'inbox.instagram.view'; v_ig_r := v_keys ? 'inbox.instagram.reply';
  v_wa_v := v_keys ? 'inbox.whatsapp.view';  v_wa_r := v_keys ? 'inbox.whatsapp.reply';
  v_em_v := v_keys ? 'inbox.email.view';     v_em_r := v_keys ? 'inbox.email.reply';
  -- "Responder" sin "ver" no existia (la pantalla agregaba ver): se cuenta como ver.
  v_ig_v := v_ig_v OR v_ig_r; v_wa_v := v_wa_v OR v_wa_r; v_em_v := v_em_v OR v_em_r;

  IF NOT (v_ig_v OR v_wa_v OR v_em_v) THEN
    RETURN '{"mode":"custom","byChannel":{}}'::jsonb;
  END IF;

  v_scope := CASE
    WHEN v_scopes ->> 'conversations' = 'all' OR v_scopes ->> 'leads' = 'all' THEN 'all'
    WHEN v_scopes ->> 'leads' = 'own_unassigned' THEN 'own_unassigned'
    ELSE 'own'
  END;

  IF v_ig_v AND v_wa_v AND v_em_v AND v_ig_r = v_wa_r AND v_wa_r = v_em_r THEN
    RETURN jsonb_build_object('mode', 'all', 'all', jsonb_build_object('scope', v_scope, 'reply', v_ig_r));
  END IF;

  SELECT COALESCE(jsonb_object_agg(ch.id::text, jsonb_build_object('scope', v_scope, 'reply',
           CASE ch.platform
             WHEN 'instagram' THEN v_ig_r
             WHEN 'whatsapp' THEN v_wa_r
             WHEN 'email' THEN v_em_r
             ELSE (v_ig_r OR v_wa_r OR v_em_r)
           END)), '{}'::jsonb)
    INTO v_by
  FROM public.channels ch
  WHERE ch.workspace_id = p_workspace_id
    AND CASE ch.platform
          WHEN 'instagram' THEN v_ig_v
          WHEN 'whatsapp' THEN v_wa_v
          WHEN 'email' THEN v_em_v
          ELSE true
        END;

  RETURN jsonb_build_object('mode', 'custom', 'byChannel', v_by);
END;
$function$;
REVOKE ALL ON FUNCTION private.channels_from_legacy(p_workspace_id uuid, p_permissions jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.channels_from_legacy(p_workspace_id uuid, p_permissions jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.member_channels()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT '{"mode":"all","all":{"scope":"own","reply":true}}'::jsonb
$function$;
REVOKE ALL ON FUNCTION private.member_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.member_channels() TO service_role;

CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view',
    'designer.view',
    'designer.edit',
    'services.view',
    'services.items',
    'portal.view_as', 'affiliates.use'
  ]::text[]
$function$;
REVOKE ALL ON FUNCTION private.member_permission_keys() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.my_call_permissions(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN '{"scopes":{"calls":"all"}}'::jsonb;
  END IF;
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN '{"scopes":{"calls":"own"}}'::jsonb;
  END IF;
  RETURN v_permissions;
END;
$function$;
REVOKE ALL ON FUNCTION private.my_call_permissions(p_workspace_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.my_call_permissions(p_workspace_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.normalize_channel_grant(p_grant jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_grant IS NULL OR jsonb_typeof(p_grant) <> 'object' THEN NULL
    WHEN (p_grant ->> 'scope') IN ('own', 'own_unassigned', 'all') THEN
      jsonb_build_object('scope', p_grant ->> 'scope', 'reply', COALESCE((p_grant -> 'reply') = 'true'::jsonb, false))
    ELSE NULL
  END
$function$;
REVOKE ALL ON FUNCTION private.normalize_channel_grant(p_grant jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.normalize_channel_grant(p_grant jsonb) TO service_role;

CREATE OR REPLACE FUNCTION private.owner_only_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'team.remove',
    'workspace.transfer'
  ]::text[]
$function$;
REVOKE ALL ON FUNCTION private.owner_only_keys() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.role_channel_grant(p_channels jsonb, p_channel_id text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_channels IS NULL OR jsonb_typeof(p_channels) <> 'object' THEN NULL
    WHEN p_channels ->> 'mode' = 'all' THEN private.normalize_channel_grant(p_channels -> 'all')
    WHEN p_channels ->> 'mode' = 'custom' AND p_channel_id IS NOT NULL AND jsonb_typeof(p_channels -> 'byChannel') = 'object'
      THEN private.normalize_channel_grant(p_channels -> 'byChannel' -> p_channel_id)
    ELSE NULL
  END
$function$;
REVOKE ALL ON FUNCTION private.role_channel_grant(p_channels jsonb, p_channel_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.role_channel_grant(p_channels jsonb, p_channel_id text) TO service_role;

CREATE OR REPLACE FUNCTION private.role_sees_call_area(p_permissions jsonb, p_area_id uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT COALESCE(
    p_permissions #>> '{scopes,calls}' = 'all'
    OR (p_area_id IS NOT NULL AND p_area_id::text = ANY (private.call_areas_of(p_permissions))),
    false
  )
$function$;
REVOKE ALL ON FUNCTION private.role_sees_call_area(p_permissions jsonb, p_area_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.role_sees_call_area(p_permissions jsonb, p_area_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.ungrantable_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'scheduling.team_events',
    'team.remove',
    'workspace.transfer'
  ]::text[]
$function$;
REVOKE ALL ON FUNCTION private.ungrantable_keys() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.workspace_roles_channels_default()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.system_role IS NOT NULL OR (COALESCE(NEW.permissions, '{}'::jsonb) ? 'channels') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (COALESCE(OLD.permissions, '{}'::jsonb) ? 'channels') THEN
    NEW.permissions := COALESCE(NEW.permissions, '{}'::jsonb) || jsonb_build_object('channels', OLD.permissions -> 'channels');
  ELSE
    NEW.permissions := COALESCE(NEW.permissions, '{}'::jsonb)
      || jsonb_build_object('channels', private.channels_from_legacy(NEW.workspace_id, NEW.permissions));
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.workspace_roles_channels_default() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.can_give_role(p_workspace_id uuid, p_role_id uuid, p_base_role text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor       text;
  v_system_role text;
  v_permissions jsonb;
  v_role_ws     uuid;
BEGIN
  SELECT m.role INTO v_actor
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_actor IS NULL THEN
    RETURN false;
  END IF;

  -- El rol Admin solo lo da un Owner o un Admin, aunque la invitacion apunte a un rol personalizado.
  IF p_base_role = 'admin' AND v_actor NOT IN ('owner', 'admin') THEN
    RETURN false;
  END IF;

  IF p_role_id IS NULL THEN
    IF p_base_role = 'admin' THEN
      RETURN v_actor IN ('owner', 'admin');
    END IF;
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
       AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
  END IF;

  SELECT r.system_role, COALESCE(r.permissions, '{}'::jsonb), r.workspace_id
    INTO v_system_role, v_permissions, v_role_ws
  FROM public.workspace_roles r
  WHERE r.id = p_role_id;

  IF NOT FOUND OR v_role_ws <> p_workspace_id THEN
    RETURN false;
  END IF;

  -- El Owner no se da: es unico y se transfiere.
  IF v_system_role = 'owner' THEN
    RETURN false;
  END IF;
  IF v_system_role = 'admin' THEN
    RETURN v_actor IN ('owner', 'admin');
  END IF;
  IF v_system_role = 'member' THEN
    RETURN public.can_grant_permissions(p_workspace_id, to_jsonb(private.member_permission_keys()), '{}'::jsonb)
       AND public.can_grant_channels(p_workspace_id, private.member_channels(), NULL);
  END IF;

  RETURN public.can_grant_permissions(p_workspace_id, COALESCE(v_permissions -> 'keys', '[]'::jsonb), COALESCE(v_permissions -> 'scopes', '{}'::jsonb))
     AND public.can_grant_channels(p_workspace_id, v_permissions -> 'channels', NULL)
     AND public.can_grant_call_areas(p_workspace_id, v_permissions, NULL);
END;
$function$;
REVOKE ALL ON FUNCTION public.can_give_role(p_workspace_id uuid, p_role_id uuid, p_base_role text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_grant_call_areas(p_workspace_id uuid, p_wanted jsonb, p_before jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_actor jsonb;
BEGIN
  v_actor := private.my_call_permissions(p_workspace_id);
  IF v_actor IS NULL THEN
    RETURN false;
  END IF;
  RETURN NOT private.call_areas_exceed(p_wanted, p_before, v_actor);
END;
$function$;
REVOKE ALL ON FUNCTION public.can_grant_call_areas(p_workspace_id uuid, p_wanted jsonb, p_before jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_grant_channels(p_workspace_id uuid, p_wanted jsonb, p_before jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  text;
  v_actor jsonb;
BEGIN
  SELECT m.role INTO v_role
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;
  IF p_wanted IS NULL OR jsonb_typeof(p_wanted) <> 'object' THEN
    RETURN true;
  END IF;

  v_actor := private.my_channels(p_workspace_id);

  -- "Todas las cuentas" (tambien las futuras) solo la da quien la tiene, con un alcance igual o mayor.
  IF p_wanted ->> 'mode' = 'all' THEN
    RETURN NOT private.channel_grant_exceeds(
      private.normalize_channel_grant(p_wanted -> 'all'),
      CASE WHEN p_before ->> 'mode' = 'all' THEN private.normalize_channel_grant(p_before -> 'all') END,
      CASE WHEN v_actor ->> 'mode' = 'all' THEN private.normalize_channel_grant(v_actor -> 'all') END
    );
  END IF;

  IF p_wanted ->> 'mode' = 'custom' AND jsonb_typeof(p_wanted -> 'byChannel') = 'object' THEN
    RETURN NOT EXISTS (
      SELECT 1 FROM jsonb_each(p_wanted -> 'byChannel') AS e(channel_id, grant_value)
      WHERE private.channel_grant_exceeds(
        private.normalize_channel_grant(e.grant_value),
        private.role_channel_grant(p_before, e.channel_id),
        private.role_channel_grant(v_actor, e.channel_id)
      )
    );
  END IF;

  -- Una forma que no se entiende no da ninguna cuenta.
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.can_grant_channels(p_workspace_id uuid, p_wanted jsonb, p_before jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_grant_permissions(p_workspace_id uuid, p_keys jsonb, p_scopes jsonb DEFAULT '{}'::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
  v_actor_keys  jsonb;
  v_actor_scopes jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- Una clave solo-Owner o reservada no viaja en un rol: ni el Owner la da.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_keys, '[]'::jsonb)) AS k(key)
    WHERE k.key = ANY (private.ungrantable_keys())
  ) THEN
    RETURN false;
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN true;
  END IF;

  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    v_actor_keys := to_jsonb(private.member_permission_keys());
    v_actor_scopes := '{}'::jsonb;
  ELSE
    v_actor_keys := COALESCE(v_permissions -> 'keys', '[]'::jsonb);
    v_actor_scopes := COALESCE(v_permissions -> 'scopes', '{}'::jsonb);
  END IF;

  -- Cada clave que se da tiene que estar en poder de quien la da.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_keys, '[]'::jsonb)) AS k(key)
    WHERE NOT (v_actor_keys ? k.key)
  ) THEN
    RETURN false;
  END IF;

  -- Y ningun alcance puede ser mas ancho que el suyo.
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(COALESCE(p_scopes, '{}'::jsonb)) AS s(module, value)
    WHERE private.scope_rank(s.value) > private.scope_rank(COALESCE(v_actor_scopes ->> s.module, 'own'))
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.can_grant_permissions(p_workspace_id uuid, p_keys jsonb, p_scopes jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.delete_table_view(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.table_views%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.table_views WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NOT public.is_workspace_member(v_row.workspace_id)
     OR NOT (v_row.owner_id = v_uid OR (public.is_workspace_admin(v_row.workspace_id) AND v_row.visibility <> 'private')) THEN
    RAISE EXCEPTION 'No podes borrar esta vista' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.table_views WHERE id = p_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_table_view(p_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
  v_invite_id uuid;
  v_has_pending_invite boolean;
begin
  -- 00316: la marca llega en un UPDATE posterior al alta. Solo cuando pasa a
  -- `true` y la persona todavia no tiene ningun workspace.
  if tg_op = 'UPDATE' then
    if coalesce(new.raw_app_meta_data->>'ssa_create_workspace', '') <> 'true'
       or coalesce(old.raw_app_meta_data->>'ssa_create_workspace', '') = 'true' then
      return new;
    end if;
    if exists (select 1 from public.workspace_members m where m.user_id = new.id) then
      return new;
    end if;
  end if;

  -- Alta por invitacion: no se crea workspace propio. registerFromInvite ya
  -- valido la invitacion antes de crear esta cuenta y suma la membresia el
  -- mismo, con finalizeAcceptInvite.
  v_invite_id := (new.raw_user_meta_data->>'invite_id')::uuid;
  if v_invite_id is not null then
    select exists (
      select 1 from public.workspace_invites
      where id = v_invite_id
        and email = new.email
        and status = 'pending'
        and expires_at > now()
    ) into v_has_pending_invite;

    if v_has_pending_invite then
      return new;
    end if;
  end if;

  -- 00309: un registro publico no se arma un negocio. Solo la primera cuenta
  -- de una instalacion vacia, o una creada por el servidor con la marca en
  -- app_metadata (que el registro publico no puede escribir).
  if coalesce(new.raw_app_meta_data->>'ssa_create_workspace', '') <> 'true'
     and exists (select 1 from public.workspaces) then
    return new;
  end if;

  user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (user_name || '''s Workspace', workspace_slug)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
exception when others then
  raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_permission(p_workspace_id uuid, p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role        text;
  v_role_id     uuid;
  v_system_role text;
  v_permissions jsonb;
BEGIN
  SELECT m.role, m.role_id, r.system_role, COALESCE(r.permissions, '{}'::jsonb)
    INTO v_role, v_role_id, v_system_role, v_permissions
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL OR p_key IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  -- El Admin tiene todo menos lo solo-Owner.
  IF v_role = 'admin' THEN
    RETURN NOT (p_key = ANY (private.owner_only_keys()));
  END IF;

  -- El Member de sistema (sin rol asignado, o con la fila del rol de sistema Member): su lista vive
  -- en TypeScript y se copia en private.member_permission_keys(). Su fila de workspace_roles tiene
  -- los permisos vacios a proposito.
  IF v_role_id IS NULL OR v_system_role = 'member' THEN
    RETURN COALESCE(p_key = ANY (private.member_permission_keys()), false);
  END IF;

  -- Un rol personalizado: lo que tiene tildado.
  RETURN COALESCE(v_permissions -> 'keys' @> to_jsonb(ARRAY[p_key]), false);
END;
$function$;
REVOKE ALL ON FUNCTION public.has_permission(p_workspace_id uuid, p_key text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.is_own_role(p_workspace_id uuid, p_role_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid() AND m.role_id = p_role_id
  )
$function$;
REVOKE ALL ON FUNCTION public.is_own_role(p_workspace_id uuid, p_role_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$function$;
COMMENT ON FUNCTION public.is_workspace_admin(ws_id uuid) IS 'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
REVOKE ALL ON FUNCTION public.is_workspace_admin(ws_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$function$;
COMMENT ON FUNCTION public.is_workspace_member(ws_id uuid) IS 'Helper de RLS. authenticated NECESITA EXECUTE: la llaman ~37 policies y una expresion de policy se evalua con el rol de la sesion. Revocarlo rompe toda lectura de la app.';
REVOKE ALL ON FUNCTION public.is_workspace_member(ws_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(ws_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role = 'owner'
  );
$function$;
COMMENT ON FUNCTION public.is_workspace_owner(ws_id uuid) IS 'Helper de RLS. authenticated NECESITA EXECUTE (ver is_workspace_member).';
REVOKE ALL ON FUNCTION public.is_workspace_owner(ws_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.permission_scope(p_workspace_id uuid, p_module text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role  text;
  v_scope text;
BEGIN
  SELECT m.role, r.permissions #>> ARRAY['scopes', p_module]
    INTO v_role, v_scope
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid();

  IF v_role IS NULL THEN
    RETURN 'own';
  END IF;

  IF v_role IN ('owner', 'admin') THEN
    RETURN 'all';
  END IF;

  RETURN COALESCE(v_scope, 'own');
END;
$function$;
REVOKE ALL ON FUNCTION public.permission_scope(p_workspace_id uuid, p_module text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.protect_system_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Borrar un rol de sistema A MANO no se permite; que se vaya con su
    -- workspace, si. Sin esta distincion el trigger frena el borrado en
    -- cascada y no se puede borrar un workspace (lo encontro la limpieza de
    -- verify-rls, que es justo para lo que esta).
    IF OLD.system_role IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden borrar';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.system_role IS NOT NULL THEN
    -- Se deja cambiar la descripcion: es texto y no afecta a nadie.
    IF NEW.system_role IS DISTINCT FROM OLD.system_role
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.permissions IS DISTINCT FROM OLD.permissions THEN
      RAISE EXCEPTION 'los roles de sistema no se pueden editar';
    END IF;
  END IF;

  -- Un rol personalizado no puede convertirse en uno de sistema.
  IF OLD.system_role IS NULL AND NEW.system_role IS NOT NULL THEN
    RAISE EXCEPTION 'un rol personalizado no puede volverse de sistema';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_table_view(p_id uuid, p_workspace uuid, p_table_key text, p_name text, p_config jsonb, p_visibility text DEFAULT 'private'::text, p_member_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_row   public.table_views%ROWTYPE;
  v_ws    uuid;
  v_admin boolean;
  v_vis   text := COALESCE(p_visibility, 'private');
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  IF v_vis NOT IN ('private', 'workspace', 'selected') THEN
    RAISE EXCEPTION 'Visibilidad invalida' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.table_views WHERE id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La vista no existe' USING ERRCODE = 'P0002';
    END IF;
    v_ws := v_row.workspace_id;
  ELSE
    v_ws := p_workspace;
  END IF;

  IF NOT public.is_workspace_member(v_ws) THEN
    RAISE EXCEPTION 'No sos parte de este negocio' USING ERRCODE = '42501';
  END IF;
  v_admin := public.is_workspace_admin(v_ws);

  IF p_id IS NOT NULL AND NOT (v_row.owner_id = v_uid OR (v_admin AND v_row.visibility <> 'private')) THEN
    RAISE EXCEPTION 'No podes editar esta vista' USING ERRCODE = '42501';
  END IF;
  IF v_vis <> 'private' AND NOT v_admin THEN
    RAISE EXCEPTION 'Solo Owner y Admin pueden compartir vistas' USING ERRCODE = '42501';
  END IF;
  IF v_vis = 'selected' AND p_member_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_member_ids) AS u(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = u.user_id)
  ) THEN
    RAISE EXCEPTION 'Hay personas que no son parte de este negocio' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.table_views (workspace_id, table_key, name, config, owner_id, visibility)
    VALUES (v_ws, p_table_key, btrim(p_name), COALESCE(p_config, '{}'::jsonb), v_uid, v_vis)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.table_views
       SET name = btrim(p_name), config = COALESCE(p_config, config), visibility = v_vis
     WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  IF v_vis = 'selected' THEN
    IF p_member_ids IS NOT NULL THEN
      DELETE FROM public.table_view_members WHERE view_id = v_id AND NOT (user_id = ANY (p_member_ids));
      INSERT INTO public.table_view_members (view_id, user_id)
      SELECT v_id, u.user_id FROM unnest(p_member_ids) AS u(user_id)
      ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    DELETE FROM public.table_view_members WHERE view_id = v_id;
  END IF;

  -- Quien ya no puede ver la vista deja de tenerla como predeterminada.
  DELETE FROM public.table_view_defaults d
   WHERE d.view_id = v_id AND NOT public.table_view_visible_to(v_id, d.user_id);

  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.save_table_view(p_id uuid, p_workspace uuid, p_table_key text, p_name text, p_config jsonb, p_visibility text, p_member_ids uuid[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.seed_workspace_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.workspace_roles (workspace_id, name, description, system_role)
  VALUES
    (NEW.id, 'Owner',  'Puede todo, incluida la propiedad del negocio.', 'owner'),
    (NEW.id, 'Admin',  'Puede todo menos transferir la propiedad.',      'admin'),
    (NEW.id, 'Member', 'Ve y atiende los leads que tiene asignados.',    'member')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.seed_workspace_roles() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_table_view_default(p_workspace uuid, p_table_key text, p_view uuid, p_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_targets uuid[];
  v_view    public.table_views%ROWTYPE;
  v_target  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No hay sesion' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_workspace_member(p_workspace) THEN
    RAISE EXCEPTION 'No sos parte de este negocio' USING ERRCODE = '42501';
  END IF;
  v_targets := COALESCE(p_user_ids, ARRAY[v_uid]);
  IF EXISTS (SELECT 1 FROM unnest(v_targets) AS t(user_id) WHERE t.user_id <> v_uid) AND NOT public.is_workspace_admin(p_workspace) THEN
    RAISE EXCEPTION 'Solo Owner y Admin pueden elegir la vista de otras personas' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_targets) AS t(user_id)
    WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = p_workspace AND wm.user_id = t.user_id)
  ) THEN
    RAISE EXCEPTION 'Hay personas que no son parte de este negocio' USING ERRCODE = '22023';
  END IF;

  IF p_view IS NULL THEN
    DELETE FROM public.table_view_defaults
     WHERE workspace_id = p_workspace AND table_key = p_table_key AND user_id = ANY (v_targets);
    RETURN;
  END IF;

  SELECT * INTO v_view FROM public.table_views WHERE id = p_view AND workspace_id = p_workspace AND table_key = p_table_key;
  IF NOT FOUND OR NOT (
    public.table_view_visible_to(p_view, v_uid)
    OR (public.is_workspace_admin(p_workspace) AND v_view.visibility <> 'private')
  ) THEN
    RAISE EXCEPTION 'La vista no existe' USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_target IN ARRAY v_targets LOOP
    IF NOT public.table_view_visible_to(p_view, v_target) THEN
      IF v_view.visibility = 'selected' THEN
        INSERT INTO public.table_view_members (view_id, user_id) VALUES (p_view, v_target) ON CONFLICT DO NOTHING;
      ELSE
        RAISE EXCEPTION 'La vista es privada: compartila antes de dejarla como predeterminada de otra persona' USING ERRCODE = '22023';
      END IF;
    END IF;
    INSERT INTO public.table_view_defaults (workspace_id, user_id, table_key, view_id, assigned_by)
    VALUES (p_workspace, v_target, p_table_key, p_view, CASE WHEN v_target = v_uid THEN NULL ELSE v_uid END)
    ON CONFLICT (workspace_id, user_id, table_key)
    DO UPDATE SET view_id = EXCLUDED.view_id, assigned_by = EXCLUDED.assigned_by, updated_at = now();
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_table_view_default(p_workspace uuid, p_table_key text, p_view uuid, p_user_ids uuid[]) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.table_view_visible_to(p_view uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = v.workspace_id AND wm.user_id = p_user
    ) AND (
      v.owner_id = p_user
      OR v.visibility = 'workspace'
      OR (v.visibility = 'selected' AND EXISTS (SELECT 1 FROM public.table_view_members m WHERE m.view_id = v.id AND m.user_id = p_user))
    )
    FROM public.table_views v WHERE v.id = p_view
  ), false);
$function$;
REVOKE ALL ON FUNCTION public.table_view_visible_to(p_view uuid, p_user uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.table_view_workspace(p_view uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT v.workspace_id FROM public.table_views v WHERE v.id = p_view;
$function$;
REVOKE ALL ON FUNCTION public.table_view_workspace(p_view uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.workspace_member_profiles(p_workspace_id uuid)
 RETURNS TABLE(user_id uuid, role text, role_id uuid, joined_at timestamp with time zone, email text, full_name text, meta_name text, avatar_path text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    m.user_id,
    m.role::text,
    m.role_id,
    m.created_at,
    u.email::text,
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    p.avatar_path
  FROM public.workspace_members m
  LEFT JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.user_profiles p ON p.user_id = m.user_id
  WHERE m.workspace_id = p_workspace_id;
$function$;
COMMENT ON FUNCTION public.workspace_member_profiles(p_workspace_id uuid) IS 'Miembros de un workspace con email, nombre (de auth.users) y foto (de user_profiles) en una sola consulta. Solo service_role.';
REVOKE ALL ON FUNCTION public.workspace_member_profiles(p_workspace_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.workspace_roles_grant_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_added  jsonb;
  v_raised jsonb;
BEGIN
  -- El service role (migraciones, el servidor) no pasa por la regla de "quien da".
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_agg(k.key), '[]'::jsonb) INTO v_added
  FROM jsonb_array_elements_text(COALESCE(NEW.permissions -> 'keys', '[]'::jsonb)) AS k(key)
  WHERE NOT (COALESCE(OLD.permissions -> 'keys', '[]'::jsonb) ? k.key);

  SELECT COALESCE(jsonb_object_agg(s.module, s.value), '{}'::jsonb) INTO v_raised
  FROM jsonb_each_text(COALESCE(NEW.permissions -> 'scopes', '{}'::jsonb)) AS s(module, value)
  WHERE private.scope_rank(s.value) > private.scope_rank(COALESCE(OLD.permissions -> 'scopes' ->> s.module, 'own'));

  IF NOT public.can_grant_permissions(NEW.workspace_id, v_added, v_raised) THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;

  IF (NEW.permissions -> 'channels') IS DISTINCT FROM (OLD.permissions -> 'channels')
     AND NOT public.can_grant_channels(NEW.workspace_id, NEW.permissions -> 'channels', OLD.permissions -> 'channels') THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_grant_call_areas(NEW.workspace_id, NEW.permissions, OLD.permissions) THEN
    RAISE EXCEPTION 'No podés dar permisos que no tenés' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.workspace_roles_grant_check() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_table_view_defaults_view ON public.table_view_defaults USING btree (view_id);

CREATE INDEX IF NOT EXISTS idx_table_view_members_user ON public.table_view_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_table_views_lookup ON public.table_views USING btree (workspace_id, table_key, visibility);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON public.workspace_invites USING btree (email);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON public.workspace_invites USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status ON public.workspace_invites USING btree (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON public.workspace_members USING btree (role_id) WHERE (role_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_views_owner_name ON public.table_views USING btree (workspace_id, owner_id, table_key, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_members_affiliate_code ON public.workspace_members USING btree (workspace_id, affiliate_code) WHERE (affiliate_code IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_name ON public.workspace_roles USING btree (workspace_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_roles_system ON public.workspace_roles USING btree (workspace_id, system_role) WHERE (system_role IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_portal_host ON public.workspaces USING btree (lower((portal_settings ->> 'host'::text))) WHERE (NULLIF((portal_settings ->> 'host'::text), ''::text) IS NOT NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE TRIGGER on_auth_user_workspace_flag AFTER UPDATE OF raw_app_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.table_views FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER protect_system_roles BEFORE DELETE OR UPDATE ON public.workspace_roles FOR EACH ROW EXECUTE FUNCTION public.protect_system_roles();

CREATE OR REPLACE TRIGGER set_updated_at_workspace_roles BEFORE UPDATE ON public.workspace_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER workspace_roles_channels_default BEFORE INSERT OR UPDATE ON public.workspace_roles FOR EACH ROW EXECUTE FUNCTION private.workspace_roles_channels_default();

CREATE OR REPLACE TRIGGER workspace_roles_grant_check BEFORE UPDATE ON public.workspace_roles FOR EACH ROW WHEN ((old.permissions IS DISTINCT FROM new.permissions)) EXECUTE FUNCTION public.workspace_roles_grant_check();

CREATE OR REPLACE TRIGGER seed_roles_on_workspace AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_roles();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY table_view_defaults_select ON public.table_view_defaults FOR SELECT TO public
    USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.is_workspace_admin(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY table_view_members_select ON public.table_view_members FOR SELECT TO public
    USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.is_workspace_admin(public.table_view_workspace(view_id))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY table_views_select ON public.table_views FOR SELECT TO public
    USING ((public.is_workspace_member(workspace_id) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR (visibility = 'workspace'::text) OR ((visibility = 'selected'::text) AND (EXISTS ( SELECT 1
   FROM public.table_view_members m
  WHERE ((m.view_id = table_views.id) AND (m.user_id = ( SELECT auth.uid() AS uid)))))) OR ((visibility <> 'private'::text) AND public.is_workspace_admin(workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_insert ON public.user_preferences FOR INSERT TO public
    WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_select ON public.user_preferences FOR SELECT TO public
    USING ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_preferences_update ON public.user_preferences FOR UPDATE TO public
    USING ((user_id = ( SELECT auth.uid() AS uid)))
    WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_profiles_insert ON public.user_profiles FOR INSERT TO public
    WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_profiles_select ON public.user_profiles FOR SELECT TO public
    USING ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY user_profiles_update ON public.user_profiles FOR UPDATE TO public
    USING ((user_id = ( SELECT auth.uid() AS uid)))
    WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_invites_delete ON public.workspace_invites FOR DELETE TO public
    USING (( SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_invites_insert ON public.workspace_invites FOR INSERT TO public
    WITH CHECK ((( SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite'::text) AS has_permission) AND public.can_give_role(workspace_id, role_id, role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_invites_select ON public.workspace_invites FOR SELECT TO public
    USING (( SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_invites_update ON public.workspace_invites FOR UPDATE TO public
    USING (( SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite'::text) AS has_permission))
    WITH CHECK ((( SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite'::text) AS has_permission) AND public.can_give_role(workspace_id, role_id, role)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can delete members" ON public.workspace_members FOR DELETE TO public
    USING ((public.is_workspace_owner(workspace_id) AND ( SELECT public.has_permission(workspace_members.workspace_id, 'team.remove'::text) AS has_permission)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can insert members" ON public.workspace_members FOR INSERT TO public
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.workspace_members wm
  WHERE ((wm.workspace_id = workspace_members.workspace_id) AND (wm.user_id = auth.uid()) AND (wm.role = 'owner'::text)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_members_select ON public.workspace_members FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_members_update ON public.workspace_members FOR UPDATE TO public
    USING ((public.is_workspace_owner(workspace_id) OR (( SELECT public.has_permission(workspace_members.workspace_id, 'team.manage'::text) AS has_permission) AND (role <> 'owner'::text))))
    WITH CHECK ((public.is_workspace_owner(workspace_id) OR (( SELECT public.has_permission(workspace_members.workspace_id, 'team.manage'::text) AS has_permission) AND (role <> 'owner'::text) AND public.can_give_role(workspace_id, role_id, role))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_roles_delete ON public.workspace_roles FOR DELETE TO public
    USING ((( SELECT public.has_permission(workspace_roles.workspace_id, 'roles.manage'::text) AS has_permission) AND (system_role IS NULL) AND (public.is_workspace_admin(workspace_id) OR (NOT public.is_own_role(workspace_id, id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_roles_insert ON public.workspace_roles FOR INSERT TO public
    WITH CHECK ((( SELECT public.has_permission(workspace_roles.workspace_id, 'roles.manage'::text) AS has_permission) AND (system_role IS NULL) AND public.can_grant_permissions(workspace_id, COALESCE((permissions -> 'keys'::text), '[]'::jsonb), COALESCE((permissions -> 'scopes'::text), '{}'::jsonb)) AND public.can_grant_channels(workspace_id, (permissions -> 'channels'::text), NULL::jsonb) AND public.can_grant_call_areas(workspace_id, permissions, NULL::jsonb)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_roles_select ON public.workspace_roles FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspace_roles_update ON public.workspace_roles FOR UPDATE TO public
    USING ((( SELECT public.has_permission(workspace_roles.workspace_id, 'roles.manage'::text) AS has_permission) AND (public.is_workspace_admin(workspace_id) OR (NOT public.is_own_role(workspace_id, id)))))
    WITH CHECK (( SELECT public.has_permission(workspace_roles.workspace_id, 'roles.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view their workspaces" ON public.workspaces FOR SELECT TO public
    USING (public.is_workspace_member(id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY workspaces_update ON public.workspaces FOR UPDATE TO public
    USING (public.is_workspace_admin(id))
    WITH CHECK (public.is_workspace_admin(id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
