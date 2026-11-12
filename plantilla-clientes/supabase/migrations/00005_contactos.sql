-- ============================================================================
-- Contactos
--
-- El contacto es la entidad central del sistema. Todo contacto nuevo nace en un solo
-- lugar (find_or_create_contact), con bloqueo por dato: dos llegadas simultaneas de la
-- misma persona dan un solo contacto. Se reconoce a una persona por un dato fuerte
-- (canal, telefono, WhatsApp, email o usuario de una red), nunca por el nombre.
--
-- Tambien: los canales vinculados a cada contacto, etiquetas (algunas con efecto),
-- campos personalizados, notas, el estado de setter y de vendedor con su historial, las
-- marcas "conocido" y "cliente", el "no contactar", el estado de suscripcion a emails (con la
-- baja, que gana siempre) y las importaciones por CSV. Un Member solo ve los contactos que le
-- corresponden (can_see_contact).
--
-- Tambien el nivel de calificacion del lead (de 1 a 5) con su historial de cambios.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  display_name text,
  email text,
  avatar_url text,
  is_subscribed boolean DEFAULT true NOT NULL,
  last_interaction_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  phone text,
  secondary_email text,
  country text,
  instagram_username text,
  tiktok_username text,
  youtube_channel_id text,
  linkedin_profile_url text,
  whatsapp_phone text,
  twitter_username text,
  facebook_id text,
  setter_id uuid,
  vendedor_id uuid,
  next_followup_date timestamp with time zone,
  do_not_contact boolean DEFAULT false NOT NULL,
  do_not_contact_reason text,
  do_not_contact_at timestamp with time zone,
  ai_conversation_summary text,
  lead_temperature text,
  attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
  deleted_at timestamp with time zone,
  notes text,
  ai_summary_updated_at timestamp with time zone,
  timezone text,
  avatar_source text DEFAULT 'external'::text NOT NULL,
  avatar_updated_at timestamp with time zone,
  referred_by_user_id uuid,
  referred_by_contact_id uuid,
  assignment_locked_at timestamp with time zone,
  payment_health jsonb DEFAULT '{}'::jsonb NOT NULL,
  setter_status text,
  setter_status_at timestamp with time zone,
  setter_status_by_agent boolean DEFAULT false NOT NULL,
  closer_status text,
  closer_status_at timestamp with time zone,
  last_status_role text,
  last_status text,
  last_status_at timestamp with time zone,
  interest_product_id uuid,
  interest_variant_id uuid,
  is_known boolean DEFAULT false NOT NULL,
  known_marked_by uuid,
  known_marked_at timestamp with time zone,
  is_customer boolean DEFAULT false NOT NULL,
  customer_marked_by uuid,
  customer_marked_at timestamp with time zone,
  customer_source text,
  email_status text DEFAULT 'subscribed'::text NOT NULL,
  email_status_at timestamp with time zone DEFAULT now(),
  email_status_source text,
  email_subscribed_at timestamp with time zone DEFAULT now(),
  email_unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
  first_inbound_at timestamp with time zone,
  is_anonymous boolean GENERATED ALWAYS AS ((((lower(btrim(COALESCE(display_name, ''::text))) = ANY (ARRAY[''::text, 'instagram user'::text, 'facebook user'::text, 'whatsapp user'::text, 'unknown commenter'::text])) OR ((btrim(COALESCE(display_name, ''::text)) ~ '^\+?[0-9]{8,}$'::text) AND (first_inbound_at IS NULL))) AND (email IS NULL) AND (secondary_email IS NULL) AND (phone IS NULL) AND (whatsapp_phone IS NULL) AND (instagram_username IS NULL))) STORED,
  qualification_level smallint,
  qualification_at timestamp with time zone,
  qualification_by_agent boolean DEFAULT false NOT NULL,
  affiliate_code text,
  affiliate_user_id uuid,
  affiliate_contact_id uuid,
  affiliate_kind text,
  affiliate_assigned_at timestamp with time zone,
  affiliate_expires_at timestamp with time zone,
  affiliate_last_ref_at timestamp with time zone,
  affiliate_source text,
  display_name_source text,
  CONSTRAINT contacts_pkey PRIMARY KEY (id),
  CONSTRAINT contacts_affiliate_code_format CHECK (((affiliate_code IS NULL) OR (affiliate_code ~ '^[a-z0-9]{4,24}$'::text))),
  CONSTRAINT contacts_affiliate_kind_check CHECK (((affiliate_kind IS NULL) OR (affiliate_kind = ANY (ARRAY['originated'::text, 'influenced'::text])))),
  CONSTRAINT contacts_affiliate_not_self CHECK (((affiliate_contact_id IS NULL) OR (affiliate_contact_id <> id))),
  CONSTRAINT contacts_affiliate_one CHECK ((num_nonnulls(affiliate_user_id, affiliate_contact_id) <= 1)),
  CONSTRAINT contacts_affiliate_source_check CHECK (((affiliate_source IS NULL) OR (affiliate_source = ANY (ARRAY['link'::text, 'manual'::text])))),
  CONSTRAINT contacts_avatar_source_check CHECK ((avatar_source = ANY (ARRAY['external'::text, 'storage'::text, 'manual'::text]))),
  CONSTRAINT contacts_customer_source_check CHECK (((customer_source IS NULL) OR (customer_source = ANY (ARRAY['manual'::text, 'sale'::text])))),
  CONSTRAINT contacts_display_name_source_check CHECK (((display_name_source IS NULL) OR (display_name_source = 'manual'::text))),
  CONSTRAINT contacts_email_status_check CHECK ((email_status = ANY (ARRAY['subscribed'::text, 'not_subscribed'::text, 'unsubscribed'::text, 'bounced'::text, 'complained'::text]))),
  CONSTRAINT contacts_last_status_role_check CHECK (((last_status_role IS NULL) OR (last_status_role = ANY (ARRAY['setter'::text, 'closer'::text])))),
  CONSTRAINT contacts_lead_temperature_check CHECK (((lead_temperature IS NULL) OR (lead_temperature = ANY (ARRAY['cold'::text, 'warm'::text, 'hot'::text])))),
  CONSTRAINT contacts_qualification_dates_check CHECK (((qualification_level IS NULL) = (qualification_at IS NULL))),
  CONSTRAINT contacts_qualification_level_check CHECK (((qualification_level IS NULL) OR ((qualification_level >= 1) AND (qualification_level <= 5)))),
  CONSTRAINT contacts_status_dates_check CHECK ((((setter_status IS NULL) = (setter_status_at IS NULL)) AND ((closer_status IS NULL) = (closer_status_at IS NULL)) AND ((last_status IS NULL) = (last_status_role IS NULL)) AND ((last_status IS NULL) = (last_status_at IS NULL)))),
  CONSTRAINT contacts_affiliate_contact_id_fkey FOREIGN KEY (affiliate_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT contacts_affiliate_user_id_fkey FOREIGN KEY (affiliate_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_customer_marked_by_fkey FOREIGN KEY (customer_marked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_interest_product_id_fkey FOREIGN KEY (interest_product_id) REFERENCES public.products(id),
  CONSTRAINT contacts_interest_variant_id_fkey FOREIGN KEY (interest_variant_id) REFERENCES public.product_variants(id),
  CONSTRAINT contacts_known_marked_by_fkey FOREIGN KEY (known_marked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_referred_by_contact_id_fkey FOREIGN KEY (referred_by_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL,
  CONSTRAINT contacts_referred_by_user_id_fkey FOREIGN KEY (referred_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_setter_id_fkey FOREIGN KEY (setter_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_vendedor_id_fkey FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.contacts.phone IS 'Telefono principal, normalizado como "+<digitos>" por lib/phone.ts. Clave de deduplicacion cross-canal.';
COMMENT ON COLUMN public.contacts.instagram_username IS 'Usuario de Instagram sin la arroba, en minusculas. Lo normaliza lib/contacts/fields.ts.';
COMMENT ON COLUMN public.contacts.whatsapp_phone IS 'Telefono de WhatsApp cuando difiere del principal. Mismo formato normalizado que phone.';
COMMENT ON COLUMN public.contacts.setter_id IS 'Quien contacta y califica. Junto con vendedor_id define el scope de leads (migracion 00024).';
COMMENT ON COLUMN public.contacts.vendedor_id IS 'Quien cierra. Independiente de setter_id: un lead puede tener uno, los dos o ninguno.';
COMMENT ON COLUMN public.contacts.next_followup_date IS 'Proximo seguimiento. Se llena a mano en Etapa 1; es la base del agendamiento de Etapa 4.';
COMMENT ON COLUMN public.contacts.ai_conversation_summary IS 'Memoria acumulativa del agente IA. Queda vacio hasta la Fase 3; se crea ahora para no volver a migrar.';
COMMENT ON COLUMN public.contacts.attribution IS '{ "first_click": {...}, "last_click": {...} } con UTMs, fbclid, gclid, ad_id, campaign_id, referrer_url, landing_page y captured_at. first_click no se pisa nunca.';
COMMENT ON COLUMN public.contacts.deleted_at IS 'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';
COMMENT ON COLUMN public.contacts.notes IS 'Notas internas del contacto, en un solo texto. Reemplaza a la tabla contact_notes desde el Bloque 4. Quien cambio que queda en audit_log.';
COMMENT ON COLUMN public.contacts.ai_summary_updated_at IS 'Cuando se actualizo por ultima vez ai_conversation_summary (la memoria del agente). NULL en las memorias anteriores a la 00070.';
COMMENT ON COLUMN public.contacts.timezone IS 'Zona IANA del contacto (ej. America/Mexico_City). La aprende la agenda del invitado; el agente de chat la confirma antes de proponer horarios.';
COMMENT ON COLUMN public.contacts.avatar_source IS 'De donde sale avatar_url. external: la URL cruda del proveedor (vence, se puede refrescar con el proximo mensaje). storage: F16 ya la copio a nuestro bucket avatars (se refresca cada 30 dias desde TypeScript). manual: alguien la cargo a mano (nunca se pisa).';
COMMENT ON COLUMN public.contacts.avatar_updated_at IS 'Cuando se actualizo avatar_url por ultima vez. Lo usa F16 para decidir si refrescar una foto storage (cada 30 dias) y la retencion (borra la de un contacto storage sin mensajes en 6 meses).';
COMMENT ON COLUMN public.contacts.assignment_locked_at IS 'Se escribe cuando alguien asigna a mano setter o vendedor: desde ahi la asignacion automatica no toca a este contacto (00161).';
COMMENT ON COLUMN public.contacts.payment_health IS 'Salud de pago: {on_time, late, early, avg_delay_days, has_active_overdue, total_paid}. La recalcula el servidor al cobrar, revertir o pasar a moroso (F31).';
COMMENT ON COLUMN public.contacts.is_known IS 'Conocido (00256): alguien personal. Apaga el agente, pausa secuencias y sus chats van a la persona de cada cuenta (workspaces.known_contacts_settings).';
COMMENT ON COLUMN public.contacts.is_customer IS 'Cliente (00268): ya compro. Mismos efectos que is_known: apaga el agente, pausa secuencias y sus chats van a la persona configurada por cuenta (workspaces.customer_contacts_settings).';
COMMENT ON COLUMN public.contacts.customer_source IS 'De donde vino la marca de cliente: manual (una persona) o sale (se cobro un pago; customer_marked_by queda NULL).';
COMMENT ON COLUMN public.contacts.email_status IS 'Estado de las direcciones de email del contacto: subscribed | not_subscribed | unsubscribed | bounced | complained. Se cambia SOLO con public.set_email_status / set_email_status_by_address (00271, 00278). No es is_subscribed (difusiones por chat).';
COMMENT ON COLUMN public.contacts.email_unsubscribe_token IS 'Token opaco del link de baja (/baja/<token>). Solo permite darse de baja.';
COMMENT ON COLUMN public.contacts.first_inbound_at IS 'Cuando escribio la persona por primera vez, por cualquier canal. Null = nunca escribio, o escribio antes de que se guardaran los mensajes entrantes. La mantienen los triggers messages_zz_contact_wrote y conversations_zz_contact_wrote (00298).';
COMMENT ON COLUMN public.contacts.is_anonymous IS 'true cuando no hay con que reconocer a la persona: sin ningun dato de contacto y con un nombre vacio, un relleno de la plataforma, o un id numerico si nunca escribio. Es sobre la identidad, no sobre el trabajo hecho: un contacto con tags y vendedor asignado sigue siendo anonimo. La calcula la base, asi que se apaga sola.';
COMMENT ON COLUMN public.contacts.affiliate_code IS 'El codigo de afiliado de un contacto (F71). Unico por negocio con workspace_members.affiliate_code; no cambia nunca.';
COMMENT ON COLUMN public.contacts.display_name_source IS 'manual = una persona del equipo edito el nombre; NULL = lo puso un camino automatico (puede reescribirlo la agenda).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contacts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.contact_channels (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  platform_sender_id text NOT NULL,
  platform_username text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT contact_channels_pkey PRIMARY KEY (id),
  CONSTRAINT contact_channels_channel_id_platform_sender_id_key UNIQUE (channel_id, platform_sender_id),
  CONSTRAINT contact_channels_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE,
  CONSTRAINT contact_channels_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_channels ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contact_channels FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.contact_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  content text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  service_id uuid,
  CONSTRAINT contact_notes_pkey PRIMARY KEY (id),
  CONSTRAINT contact_notes_content_not_blank CHECK ((length(btrim(content)) > 0)),
  CONSTRAINT contact_notes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.contact_notes IS 'DEPRECADA desde la migracion 00033: las notas viven en contacts.notes. La tabla se conserva para no perder lo que hubiera y porque purge_soft_deleted todavia la nombra. Nadie le escribe.';
COMMENT ON COLUMN public.contact_notes.service_id IS 'Comentario interno de un servicio (Servicios F28). NULL = del cliente (00331).';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contact_notes FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.contact_qualification_changes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  old_level smallint,
  new_level smallint,
  source text NOT NULL,
  changed_by uuid,
  changed_by_agent_id uuid,
  flow_id uuid,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT contact_qualification_changes_pkey PRIMARY KEY (id),
  CONSTRAINT contact_qualification_changes_check CHECK ((old_level IS DISTINCT FROM new_level)),
  CONSTRAINT contact_qualification_changes_new_level_check CHECK (((new_level IS NULL) OR ((new_level >= 1) AND (new_level <= 5)))),
  CONSTRAINT contact_qualification_changes_old_level_check CHECK (((old_level IS NULL) OR ((old_level >= 1) AND (old_level <= 5)))),
  CONSTRAINT contact_qualification_changes_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 300))),
  CONSTRAINT contact_qualification_changes_source_check CHECK ((source = ANY (ARRAY['person'::text, 'agent'::text, 'automation'::text, 'import'::text, 'merge'::text, 'seed'::text]))),
  CONSTRAINT contact_qualification_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_qualification_changes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_qualification_changes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_qualification_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_qualification_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.contact_qualification_changes FROM authenticated;

CREATE TABLE IF NOT EXISTS public.contact_status_changes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role text NOT NULL,
  old_status text,
  new_status text,
  changed_by uuid,
  changed_by_agent_id uuid,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT contact_status_changes_pkey PRIMARY KEY (id),
  CONSTRAINT contact_status_changes_check CHECK ((old_status IS DISTINCT FROM new_status)),
  CONSTRAINT contact_status_changes_reason_check CHECK (((reason IS NULL) OR (char_length(reason) <= 300))),
  CONSTRAINT contact_status_changes_role_check CHECK ((role = ANY (ARRAY['setter'::text, 'closer'::text]))),
  CONSTRAINT contact_status_changes_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT contact_status_changes_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_status_changes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_status_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.contact_status_changes FROM authenticated;

CREATE TABLE IF NOT EXISTS public.csv_imports (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  file_name text NOT NULL,
  total_rows integer DEFAULT 0 NOT NULL,
  imported integer DEFAULT 0 NOT NULL,
  updated integer DEFAULT 0 NOT NULL,
  errors integer DEFAULT 0 NOT NULL,
  error_details jsonb DEFAULT '[]'::jsonb NOT NULL,
  imported_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  finished_at timestamp with time zone,
  CONSTRAINT csv_imports_pkey PRIMARY KEY (id),
  CONSTRAINT csv_imports_error_details_is_array CHECK ((jsonb_typeof(error_details) = 'array'::text)),
  CONSTRAINT csv_imports_file_name_not_blank CHECK ((length(btrim(file_name)) > 0)),
  CONSTRAINT csv_imports_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT csv_imports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.csv_imports IS 'Una fila por importacion de CSV (F19): contadores, detalle de los errores y quien la corrio. Sin soft delete, como el audit log.';
COMMENT ON COLUMN public.csv_imports.error_details IS 'Array de { line, error } con el numero de fila como lo ve la persona en la planilla. La app lo corta en los primeros 200.';
COMMENT ON COLUMN public.csv_imports.finished_at IS 'NULL mientras la importacion corre. Una que quedo con NULL y contadores que no suman total_rows es una que se corto a la mitad.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.csv_imports FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  type text DEFAULT 'text'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT custom_field_definitions_pkey PRIMARY KEY (id),
  CONSTRAINT custom_field_definitions_workspace_id_slug_key UNIQUE (workspace_id, slug),
  CONSTRAINT custom_field_definitions_type_check CHECK ((type = ANY (ARRAY['text'::text, 'number'::text, 'boolean'::text, 'date'::text, 'url'::text, 'email'::text]))),
  CONSTRAINT custom_field_definitions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.custom_field_definitions.slug IS 'Identificador estable del campo. Se genera del nombre al crearlo y NO cambia al renombrar: el flow builder busca los campos por slug y esos slugs viven adentro del JSON de los flows, que nada migra.';
COMMENT ON COLUMN public.custom_field_definitions.deleted_at IS 'Borrado logico. Borrar de verdad la definicion se llevaria por cascade el valor que ese campo tenia en cada contacto.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.custom_field_definitions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.contact_custom_fields (
  contact_id uuid NOT NULL,
  field_id uuid NOT NULL,
  value text NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  value_number numeric,
  value_date date,
  CONSTRAINT contact_custom_fields_pkey PRIMARY KEY (contact_id, field_id),
  CONSTRAINT contact_custom_fields_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_custom_fields_field_id_fkey FOREIGN KEY (field_id) REFERENCES public.custom_field_definitions(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_custom_fields ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contact_custom_fields FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tags (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  color text DEFAULT '#6366f1'::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  disables_agent boolean DEFAULT false NOT NULL,
  assigns_to uuid,
  CONSTRAINT tags_pkey PRIMARY KEY (id),
  CONSTRAINT tags_workspace_id_name_key UNIQUE (workspace_id, name),
  CONSTRAINT tags_assigns_to_fkey FOREIGN KEY (assigns_to) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.tags.disables_agent IS 'Etiqueta con efecto (00073): el agente queda forzado apagado en las conversaciones del contacto.';
COMMENT ON COLUMN public.tags.assigns_to IS 'Etiqueta con efecto (00073): al ponerla, setter y vendedor del contacto pasan a esta persona.';
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.tags FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.contact_tags (
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT contact_tags_pkey PRIMARY KEY (contact_id, tag_id),
  CONSTRAINT contact_tags_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
  CONSTRAINT contact_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE
);
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.contact_tags FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.contact_custom_fields_typed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_type text;
BEGIN
  SELECT type INTO v_type FROM public.custom_field_definitions WHERE id = NEW.field_id;
  NEW.value_number := CASE WHEN v_type = 'number' THEN private.custom_value_number(NEW.value) END;
  NEW.value_date   := CASE WHEN v_type = 'date'   THEN private.custom_value_date(NEW.value)   END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca tumba el guardado de un valor.
  RAISE WARNING 'contact_custom_fields_typed: %', SQLERRM;
  NEW.value_number := NULL;
  NEW.value_date := NULL;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contact_custom_fields_typed() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contact_identity_lookup(p_workspace_id uuid, p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_id        uuid;
  v_hits      jsonb := '[]'::jsonb;
  v_winner    uuid;
  v_by        text;
  v_conflicts jsonb;
  v_phone     text := p_identity ->> 'phone';
  v_wa        text := p_identity ->> 'whatsapp_phone';
  v_email     text := p_identity ->> 'email';
  v_email2    text := p_identity ->> 'secondary_email';
  v_ig        text := p_identity ->> 'instagram';
  v_tt        text := p_identity ->> 'tiktok';
  v_x         text := p_identity ->> 'x';
  v_li        text := public.linkedin_slug(p_identity ->> 'linkedin');
  v_fb        text := p_identity ->> 'facebook';
BEGIN
  -- 1. El canal: el remitente ya es conocido. Gana y corta (no hay conflictos que mirar).
  IF p_identity ->> 'channel_id' IS NOT NULL THEN
    -- Sin filtrar `deleted_at`, como `find_or_link_contact` desde siempre: si el contacto de un remitente
    -- conocido esta borrado, el mensaje sigue yendo a el (crear otro dejaria un canal huerfano).
    SELECT cc.contact_id INTO v_id
    FROM public.contact_channels cc
    WHERE cc.channel_id = (p_identity ->> 'channel_id')::uuid
      AND cc.platform_sender_id = p_identity ->> 'sender_id'
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('contact_id', v_id, 'matched_by', 'channel', 'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb);
    END IF;
  END IF;

  -- 2. Telefono: el recibido como `phone` y despues el de WhatsApp; cada uno contra las dos columnas.
  IF v_phone IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_phone OR c.whatsapp_phone = v_phone)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_wa IS NOT NULL AND v_wa IS DISTINCT FROM v_phone THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (c.phone = v_wa OR c.whatsapp_phone = v_wa)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'phone', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 3. Email: el principal y despues el secundario recibido; cada uno contra las dos columnas.
  IF v_email IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email OR public.normalize_email(c.secondary_email) = v_email)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_email2 IS NOT NULL AND v_email2 IS DISTINCT FROM v_email THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
      AND (public.normalize_email(c.email) = v_email2 OR public.normalize_email(c.secondary_email) = v_email2)
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'email', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  -- 4. Redes sociales, en este orden. Se compara en minusculas (los contactos viejos pueden no estarlo).
  IF v_ig IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.instagram_username) = v_ig
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'instagram', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_tt IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.tiktok_username) = v_tt
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'tiktok', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_x IS NOT NULL THEN
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.twitter_username) = v_x
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'x', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_li IS NOT NULL THEN
    -- LinkedIn se compara por el slug de la URL, no por el texto entero.
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND public.linkedin_slug(c.linkedin_profile_url) = v_li
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'linkedin', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;
  IF v_fb IS NOT NULL THEN
    -- Facebook solo busca cuando el que llama lo pide (un canal de Facebook): sus ids no son
    -- confiables para formularios, que nunca lo mandan como parte de la identidad.
    SELECT c.id INTO v_id FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND lower(c.facebook_id) = v_fb
    ORDER BY c.created_at ASC, c.id ASC LIMIT 1;
    IF v_id IS NOT NULL THEN v_hits := v_hits || jsonb_build_array(jsonb_build_object('by', 'facebook', 'contact_id', v_id)); END IF;
    v_id := NULL;
  END IF;

  IF jsonb_array_length(v_hits) = 0 THEN
    RETURN jsonb_build_object('contact_id', NULL, 'matched_by', NULL, 'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb);
  END IF;

  v_winner := (v_hits -> 0 ->> 'contact_id')::uuid;
  v_by := v_hits -> 0 ->> 'by';

  SELECT COALESCE(jsonb_agg(h), '[]'::jsonb) INTO v_conflicts
  FROM jsonb_array_elements(v_hits) h
  WHERE (h ->> 'contact_id')::uuid <> v_winner;

  RETURN jsonb_build_object(
    'contact_id', v_winner,
    'matched_by', v_by,
    'conflict_contact_id', v_conflicts -> 0 ->> 'contact_id',
    'conflicts', v_conflicts
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.contact_identity_lookup(p_workspace_id uuid, p_identity jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contact_normalize_identity(p_identity jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_in      jsonb := CASE WHEN jsonb_typeof(p_identity) = 'object' THEN p_identity ELSE '{}'::jsonb END;
  v_ch      text  := NULLIF(btrim(v_in ->> 'channel_id'), '');
  v_sender  text  := NULLIF(btrim(v_in ->> 'sender_id'), '');
  v_li_raw  text  := v_in ->> 'linkedin';
  v_li_slug text;
BEGIN
  -- LinkedIn: el slug de la URL; si no es una URL, el texto solo si parece un slug.
  v_li_slug := public.linkedin_slug(v_li_raw);
  IF v_li_slug IS NULL AND lower(btrim(COALESCE(v_li_raw, ''))) ~ '^[a-z0-9_.%-]+$' THEN
    v_li_slug := lower(btrim(v_li_raw));
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    -- El canal vale solo con las dos puntas: el canal y el id del remitente.
    'channel_id',      CASE WHEN v_ch IS NOT NULL AND v_sender IS NOT NULL THEN v_ch END,
    'sender_id',       CASE WHEN v_ch IS NOT NULL AND v_sender IS NOT NULL THEN v_sender END,
    'phone',           public.normalize_phone(v_in ->> 'phone'),
    'whatsapp_phone',  public.normalize_phone(v_in ->> 'whatsapp_phone'),
    'email',           public.normalize_email(v_in ->> 'email'),
    'secondary_email', public.normalize_email(v_in ->> 'secondary_email'),
    'instagram',       public.normalize_handle(v_in ->> 'instagram'),
    'tiktok',          public.normalize_handle(v_in ->> 'tiktok'),
    'x',               public.normalize_handle(v_in ->> 'x'),
    'linkedin',        CASE WHEN v_li_slug IS NOT NULL THEN 'https://www.linkedin.com/in/' || v_li_slug END,
    'facebook',        public.normalize_handle(v_in ->> 'facebook')
  ));
END;
$function$;
REVOKE ALL ON FUNCTION private.contact_normalize_identity(p_identity jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contact_value_taken(p_workspace_id uuid, p_exclude_contact uuid, p_kind text, p_value text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_value IS NULL THEN false
    WHEN p_kind = 'phone' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (c.phone = p_value OR c.whatsapp_phone = p_value))
    WHEN p_kind = 'email' THEN EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL
        AND c.id IS DISTINCT FROM p_exclude_contact
        AND (public.normalize_email(c.email) = p_value OR public.normalize_email(c.secondary_email) = p_value))
    ELSE false
  END;
$function$;
REVOKE ALL ON FUNCTION private.contact_value_taken(p_workspace_id uuid, p_exclude_contact uuid, p_kind text, p_value text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_email_inherit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_addr text;
  v_worst text;
  v_current text;
BEGIN
  BEGIN
    FOR v_addr IN
      SELECT DISTINCT a
        FROM unnest(ARRAY[public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email)]) AS a
       WHERE a IS NOT NULL
         AND (TG_OP = 'INSERT'
              OR (a IS DISTINCT FROM public.normalize_email(OLD.email)
                  AND a IS DISTINCT FROM public.normalize_email(OLD.secondary_email)))
    LOOP
      PERFORM private.email_status_lock(NEW.workspace_id, v_addr);

      SELECT c.email_status INTO v_worst
        FROM public.contacts c
       WHERE c.workspace_id = NEW.workspace_id
         AND c.id <> NEW.id
         AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)
       ORDER BY private.email_status_rank(c.email_status) DESC
       LIMIT 1;

      SELECT email_status INTO v_current FROM public.contacts WHERE id = NEW.id;

      IF v_worst IS NOT NULL AND private.email_status_rank(v_worst) > private.email_status_rank(v_current) THEN
        PERFORM private.email_status_apply(
          NEW.workspace_id, ARRAY[NEW.id], v_addr, v_worst, 'inherit', now(),
          'La direccion ya estaba dada de baja en otro contacto', NULL, 'system', NULL,
          jsonb_build_object('inherited', true));
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[email_status] no pude heredar el estado de email del contacto % (%): %', NEW.id, SQLSTATE, SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'email_status_inherit_failed', NULL,
              jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE,
                                 'address', coalesce(public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email))),
              NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[email_status] tampoco pude anotar el fallo de herencia del contacto %: %', NEW.id, SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_email_inherit() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_email_on_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main uuid;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL OR NEW.email_status = 'subscribed' THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  -- Sin candado por direccion: merge_contacts ya tiene bloqueadas las dos filas, y
  -- email_status_apply relee la del principal con FOR UPDATE.
  PERFORM private.email_status_apply(
    NEW.workspace_id, ARRAY[v_main],
    coalesce(public.normalize_email(NEW.email), public.normalize_email(NEW.secondary_email)),
    NEW.email_status, 'merge', coalesce(NEW.email_status_at, now()),
    'Fusion de contactos', NULL, 'system', NULL,
    jsonb_build_object('merged_from', NEW.id, 'original_source', NEW.email_status_source));
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_email_on_merge() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_email_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(current_setting('app.email_status_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.email_status IS DISTINCT FROM 'subscribed' THEN
      RAISE EXCEPTION 'El estado de email de un contacto se cambia con set_email_status' USING ERRCODE = 'EM003';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.email_status IS DISTINCT FROM OLD.email_status
     OR NEW.email_status_at IS DISTINCT FROM OLD.email_status_at
     OR NEW.email_status_source IS DISTINCT FROM OLD.email_status_source
     OR NEW.email_subscribed_at IS DISTINCT FROM OLD.email_subscribed_at
     OR NEW.email_unsubscribe_token IS DISTINCT FROM OLD.email_unsubscribe_token THEN
    RAISE EXCEPTION 'El estado de email de un contacto se cambia con set_email_status' USING ERRCODE = 'EM003';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_email_status_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_interest_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_product_ws uuid;
  v_variant_product uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.interest_product_id IS NOT DISTINCT FROM OLD.interest_product_id
     AND NEW.interest_variant_id IS NOT DISTINCT FROM OLD.interest_variant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.interest_variant_id IS NOT NULL AND NEW.interest_product_id IS NULL THEN
    RAISE EXCEPTION 'Una variante de interes necesita su producto' USING ERRCODE = 'CI001';
  END IF;

  IF NEW.interest_product_id IS NOT NULL THEN
    SELECT workspace_id INTO v_product_ws FROM public.products WHERE id = NEW.interest_product_id;
    IF v_product_ws IS DISTINCT FROM NEW.workspace_id THEN
      RAISE EXCEPTION 'El producto de interes no es de este workspace' USING ERRCODE = 'CI002';
    END IF;
  END IF;

  IF NEW.interest_variant_id IS NOT NULL THEN
    SELECT product_id INTO v_variant_product FROM public.product_variants WHERE id = NEW.interest_variant_id;
    IF v_variant_product IS DISTINCT FROM NEW.interest_product_id THEN
      RAISE EXCEPTION 'La variante de interes no es de ese producto' USING ERRCODE = 'CI003';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_interest_check() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_qualification_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(current_setting('app.contact_qualification_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.qualification_level IS NOT NULL OR NEW.qualification_at IS NOT NULL OR NEW.qualification_by_agent THEN
      RAISE EXCEPTION 'El nivel de calificacion se cambia con set_contact_qualification' USING ERRCODE = 'QL001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qualification_level IS DISTINCT FROM OLD.qualification_level
     OR NEW.qualification_at IS DISTINCT FROM OLD.qualification_at
     OR NEW.qualification_by_agent IS DISTINCT FROM OLD.qualification_by_agent THEN
    RAISE EXCEPTION 'El nivel de calificacion se cambia con set_contact_qualification' USING ERRCODE = 'QL001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_qualification_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.contacts_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(current_setting('app.contact_status_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.setter_status IS NOT NULL OR NEW.closer_status IS NOT NULL OR NEW.last_status IS NOT NULL
       OR NEW.setter_status_by_agent THEN
      RAISE EXCEPTION 'El estado de un contacto se cambia con set_contact_status' USING ERRCODE = 'CS001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.setter_status IS DISTINCT FROM OLD.setter_status
     OR NEW.setter_status_at IS DISTINCT FROM OLD.setter_status_at
     OR NEW.setter_status_by_agent IS DISTINCT FROM OLD.setter_status_by_agent
     OR NEW.closer_status IS DISTINCT FROM OLD.closer_status
     OR NEW.closer_status_at IS DISTINCT FROM OLD.closer_status_at
     OR NEW.last_status_role IS DISTINCT FROM OLD.last_status_role
     OR NEW.last_status IS DISTINCT FROM OLD.last_status
     OR NEW.last_status_at IS DISTINCT FROM OLD.last_status_at THEN
    RAISE EXCEPTION 'El estado de un contacto se cambia con set_contact_status' USING ERRCODE = 'CS001';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.contacts_status_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.customer_assignee(p_workspace_id uuid, p_channel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings jsonb;
  v_pick     uuid;
  v_text     text;
BEGIN
  SELECT customer_contacts_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  FOREACH v_text IN ARRAY ARRAY[
    v_settings -> 'by_channel' ->> p_channel_id::text,
    v_settings ->> 'default_user_id'
  ] LOOP
    CONTINUE WHEN v_text IS NULL OR v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    SELECT wm.user_id INTO v_pick
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = v_text::uuid;
    IF v_pick IS NOT NULL THEN
      RETURN v_pick;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private.customer_assignee(p_workspace_id uuid, p_channel_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.customer_assignee(p_workspace_id uuid, p_channel_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.default_contact_status_settings()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT $defaults${
    "setter": [
      {"key": "nuevo", "name": "Nuevo", "color": "#64748b", "archived_at": null},
      {"key": "contactado", "name": "Contactado", "color": "#2563eb", "archived_at": null},
      {"key": "en_conversacion", "name": "En conversación", "color": "#0891b2", "archived_at": null},
      {"key": "calificado", "name": "Calificado", "color": "#16a34a", "archived_at": null},
      {"key": "agendado", "name": "Agendado", "color": "#7c3aed", "archived_at": null},
      {"key": "no_calificado", "name": "No calificado", "color": "#ca8a04", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ],
    "closer": [
      {"key": "llamada_agendada", "name": "Llamada agendada", "color": "#7c3aed", "archived_at": null},
      {"key": "no_se_presento", "name": "No se presentó", "color": "#ca8a04", "archived_at": null},
      {"key": "en_seguimiento", "name": "En seguimiento", "color": "#0891b2", "archived_at": null},
      {"key": "propuesta_enviada", "name": "Propuesta enviada", "color": "#2563eb", "archived_at": null},
      {"key": "ganado", "name": "Ganado", "color": "#16a34a", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ]
  }$defaults$::jsonb;
$function$;
REVOKE ALL ON FUNCTION private.default_contact_status_settings() FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.email_pause_enrollments(p_contact_id uuid, p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_status NOT IN ('not_subscribed', 'unsubscribed', 'bounced', 'complained') THEN RETURN 0; END IF; -- 00278: suma not_subscribed

  UPDATE public.sequence_enrollments e
     SET status = 'paused',
         paused_reason = 'email_' || p_status,
         paused_at = now(),
         locked_at = NULL
    FROM public.channels ch, public.sequences s
   WHERE e.contact_id = p_contact_id
     AND e.status = 'active'
     AND ch.id = e.channel_id
     AND ch.provider = 'resend'
     AND s.id = e.sequence_id
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.steps) = 'array' THEN s.steps ELSE '[]'::jsonb END)
              WITH ORDINALITY AS st(step, ord)
        WHERE st.ord - 1 >= e.current_step_index
          AND st.step ->> 'type' IN ('message', 'aiMessage', 'asset')
          AND coalesce(st.step ->> 'emailCategory', 'marketing') = 'marketing');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION private.email_pause_enrollments(p_contact_id uuid, p_status text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.email_status_apply(p_workspace_id uuid, p_contact_ids uuid[], p_address text, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamp with time zone, p_extra jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_at timestamptz := LEAST(coalesce(p_occurred_at, now()), now());
  v_sub_at timestamptz := CASE WHEN p_subscribed_at IS NULL THEN NULL ELSE LEAST(p_subscribed_at, now()) END;
  v_c record;
  v_decision text;
  v_changed integer := 0;
  v_kept boolean := false;
  v_paused integer;
  v_paused_total integer := 0;
  v_before text := NULL;
  v_after text := NULL;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin', 'consent') -- 00278: suma 'consent'
     OR private.email_status_rank(p_status) = 0 THEN
    RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
  END IF;
  IF NULLIF(btrim(coalesce(p_source, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Falta el origen del cambio de estado de email' USING ERRCODE = 'EM001';
  END IF;

  FOR v_c IN
    SELECT c.id, c.workspace_id, c.email_status, c.email_subscribed_at, c.email_status_at, c.email_status_source
      FROM public.contacts c
     WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[]))
       AND c.workspace_id = p_workspace_id
     ORDER BY c.id
       FOR UPDATE
  LOOP
    IF v_before IS NULL OR private.email_status_rank(v_c.email_status) > private.email_status_rank(v_before) THEN
      v_before := v_c.email_status;
    END IF;

    v_decision := private.email_status_decide(v_c.email_status, p_status, p_mode, p_reason);

    IF v_decision = 'reason_required' THEN
      RAISE EXCEPTION 'Para volver a suscribir una direccion que rebota o marco spam hace falta un motivo' USING ERRCODE = 'EM002';
    ELSIF v_decision = 'invalid' THEN
      RAISE EXCEPTION 'Estado o modo de email no valido' USING ERRCODE = 'EM001';
    ELSIF v_decision = 'apply' THEN
      PERFORM set_config('app.email_status_internal', 'on', true);
      UPDATE public.contacts
         SET email_status = p_status,
             email_status_at = v_at,
             email_status_source = p_source,
             email_subscribed_at = CASE WHEN p_status = 'subscribed' THEN coalesce(v_sub_at, v_at) ELSE email_subscribed_at END
       WHERE id = v_c.id;
      PERFORM set_config('app.email_status_internal', 'off', true);

      v_paused := private.email_pause_enrollments(v_c.id, p_status);
      v_paused_total := v_paused_total + v_paused;

      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        v_c.workspace_id, 'contact', v_c.id, 'email_status',
        jsonb_build_object('email_status', jsonb_build_object('old', v_c.email_status, 'new', p_status)),
        coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
          'source', p_source,
          'reason', NULLIF(btrim(coalesce(p_reason, '')), ''),
          'address', p_address,
          'mode', p_mode,
          'occurred_at', v_at,
          'enrollments_paused', v_paused),
        p_performed_by);
      v_changed := v_changed + 1;
    ELSIF v_decision = 'kept' THEN
      v_kept := true;
    ELSIF v_decision = 'noop' AND p_status = 'subscribed' AND v_sub_at IS NOT NULL
          AND v_sub_at < coalesce(v_c.email_subscribed_at, 'infinity'::timestamptz) THEN
      -- La misma suscripcion, pero con un consentimiento mas viejo (una importacion
      -- con su fecha original): se corrige la fecha. No es un cambio de estado.
      PERFORM set_config('app.email_status_internal', 'on', true);
      UPDATE public.contacts
         SET email_subscribed_at = v_sub_at,
             email_status_at = LEAST(coalesce(email_status_at, v_sub_at), v_sub_at),
             email_status_source = coalesce(NULLIF(email_status_source, 'backfill'), p_source)
       WHERE id = v_c.id;
      PERFORM set_config('app.email_status_internal', 'off', true);
    END IF;
  END LOOP;

  SELECT c.email_status INTO v_after
    FROM public.contacts c
   WHERE c.id = ANY (coalesce(p_contact_ids, '{}'::uuid[])) AND c.workspace_id = p_workspace_id
   ORDER BY private.email_status_rank(c.email_status) DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'status', v_after,
    'previous_status', v_before,
    'changed', v_changed > 0,
    'kept_existing', v_kept AND v_changed = 0,
    'contacts_changed', v_changed,
    'enrollments_paused', v_paused_total);
END;
$function$;
REVOKE ALL ON FUNCTION private.email_status_apply(p_workspace_id uuid, p_contact_ids uuid[], p_address text, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamp with time zone, p_extra jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.email_status_decide(p_from text, p_to text, p_mode text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('system', 'person', 'admin', 'consent') THEN RETURN 'invalid'; END IF;
  IF private.email_status_rank(p_to) = 0 OR private.email_status_rank(p_from) = 0 THEN RETURN 'invalid'; END IF;
  IF p_from = p_to THEN RETURN 'noop'; END IF;

  IF p_mode = 'system' THEN
    IF p_to <> 'subscribed' AND private.email_status_rank(p_to) > private.email_status_rank(p_from) THEN
      RETURN 'apply';
    END IF;
    RETURN 'kept';
  END IF;

  -- 00278: la casilla de marketing de un formulario. Solo saca de 'not_subscribed' a 'subscribed':
  -- nunca levanta una baja, un rebote ni una queja (cualquiera puede llenar un formulario con un
  -- email ajeno). Cualquier otro destino tampoco.
  IF p_mode = 'consent' THEN
    IF p_from = 'not_subscribed' AND p_to = 'subscribed' THEN RETURN 'apply'; END IF;
    RETURN 'kept';
  END IF;

  IF p_mode = 'person' THEN
    IF p_from IN ('bounced', 'complained') THEN RETURN 'kept'; END IF;
    IF p_to IN ('subscribed', 'unsubscribed') THEN RETURN 'apply'; END IF;
    RETURN 'kept';
  END IF;

  -- admin
  IF p_to = 'subscribed' AND p_from IN ('bounced', 'complained')
     AND NULLIF(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN 'reason_required';
  END IF;
  RETURN 'apply';
END;
$function$;
REVOKE ALL ON FUNCTION private.email_status_decide(p_from text, p_to text, p_mode text, p_reason text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.email_status_lock(p_workspace_id uuid, p_address text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  SELECT pg_advisory_xact_lock(hashtextextended('email_status:' || p_workspace_id::text || ':' || coalesce(p_address, ''), 0));
$function$;
REVOKE ALL ON FUNCTION private.email_status_lock(p_workspace_id uuid, p_address text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.email_status_rank(p_status text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE p_status
    WHEN 'complained' THEN 5
    WHEN 'bounced' THEN 4
    WHEN 'unsubscribed' THEN 3
    -- 00278: nunca acepto marketing. Mas grave que suscripto, menos que una baja.
    WHEN 'not_subscribed' THEN 2
    WHEN 'subscribed' THEN 1
    ELSE 0
  END;
$function$;
REVOKE ALL ON FUNCTION private.email_status_rank(p_status text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.known_assignee(p_workspace_id uuid, p_channel_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings jsonb;
  v_pick     uuid;
  v_text     text;
BEGIN
  SELECT known_contacts_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  FOREACH v_text IN ARRAY ARRAY[
    v_settings -> 'by_channel' ->> p_channel_id::text,
    v_settings ->> 'default_user_id'
  ] LOOP
    CONTINUE WHEN v_text IS NULL OR v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    SELECT wm.user_id INTO v_pick
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = v_text::uuid;
    IF v_pick IS NOT NULL THEN
      RETURN v_pick;
    END IF;
  END LOOP;

  SELECT wm.user_id INTO v_pick
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id AND wm.role = 'owner'
  ORDER BY wm.created_at
  LIMIT 1;
  RETURN v_pick;
END;
$function$;
REVOKE ALL ON FUNCTION private.known_assignee(p_workspace_id uuid, p_channel_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.known_assignee(p_workspace_id uuid, p_channel_id uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.qualification_next_level(p_old smallint, p_mode text, p_value integer)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v integer;
BEGIN
  IF p_mode = 'clear' THEN
    RETURN NULL;
  ELSIF p_mode = 'set' THEN
    IF p_value IS NULL OR p_value < 1 OR p_value > 5 THEN RETURN -1; END IF;
    RETURN p_value;
  ELSIF p_mode = 'add' THEN
    IF p_value IS NULL THEN RETURN -1; END IF;
    v := coalesce(p_old, 0) + p_value;
    IF p_old IS NULL AND v < 1 THEN RETURN NULL; END IF;
    RETURN greatest(1, least(5, v));
  END IF;
  RETURN -1;
END;
$function$;
REVOKE ALL ON FUNCTION private.qualification_next_level(p_old smallint, p_mode text, p_value integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.qualification_next_level(p_old smallint, p_mode text, p_value integer) TO service_role;

CREATE OR REPLACE FUNCTION private.tag_effect_apply(p_contact_id uuid, p_tag_id uuid, p_origin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tag      public.tags%ROWTYPE;
  v_contact  public.contacts%ROWTYPE;
  v_forced   jsonb := '[]'::jsonb;
  v_assigned boolean := false;
BEGIN
  SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id;
  IF NOT FOUND OR (NOT v_tag.disables_agent AND v_tag.assigns_to IS NULL) THEN
    RETURN;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_tag.disables_agent THEN
    -- Solo las que no estaban apagadas: una apagada a mano (Human Takeover,
    -- respuesta manual) no se "reclama", asi sacar la etiqueta no la prende.
    WITH prev AS (
      SELECT c.id, c.agent_enabled
      FROM public.conversations c
      WHERE c.contact_id = p_contact_id
        AND c.deleted_at IS NULL
        AND c.agent_enabled IS DISTINCT FROM false
    ), upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_tag_id = p_tag_id
      FROM prev
      WHERE c.id = prev.id
      RETURNING c.id, prev.agent_enabled AS previous
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', upd.id, 'previous', upd.previous)), '[]'::jsonb)
      INTO v_forced
      FROM upd;
  END IF;

  -- Asignar solo a un miembro vigente, y solo si algo cambia: no se emiten
  -- eventos assignment_changed de mas (contacts_automation_changes, 00039).
  IF v_tag.assigns_to IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = v_tag.workspace_id AND m.user_id = v_tag.assigns_to
     )
     AND (v_contact.setter_id IS DISTINCT FROM v_tag.assigns_to
          OR v_contact.vendedor_id IS DISTINCT FROM v_tag.assigns_to) THEN
    UPDATE public.contacts
    SET setter_id = v_tag.assigns_to, vendedor_id = v_tag.assigns_to
    WHERE id = p_contact_id;
    v_assigned := true;
  END IF;

  IF jsonb_array_length(v_forced) = 0 AND NOT v_assigned THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_contact.workspace_id, 'contact', p_contact_id, 'tag_effect',
    CASE WHEN v_assigned THEN jsonb_build_object(
      'setter_id', jsonb_build_object('old', v_contact.setter_id, 'new', v_tag.assigns_to),
      'vendedor_id', jsonb_build_object('old', v_contact.vendedor_id, 'new', v_tag.assigns_to)
    ) END,
    jsonb_build_object(
      'applied', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', v_tag.name,
      'conversations_forced_off', v_forced,
      'assigned_to', CASE WHEN v_assigned THEN v_tag.assigns_to END,
      'previous_setter_id', v_contact.setter_id,
      'previous_vendedor_id', v_contact.vendedor_id
    ),
    auth.uid()
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.tag_effect_apply(p_contact_id uuid, p_tag_id uuid, p_origin text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.tag_effect_release(p_contact_id uuid, p_tag_id uuid, p_origin text, p_tag_name text, p_always_audit boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_workspace uuid;
  v_other     uuid;
  v_known     boolean;
  v_customer  boolean;
  v_restored  jsonb := '[]'::jsonb;
  v_moved     jsonb := '[]'::jsonb;
BEGIN
  SELECT workspace_id, is_known, is_customer INTO v_workspace, v_known, v_customer
  FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Otra etiqueta con efecto que el contacto conserva: la marca pasa a esa y
  -- nada se prende.
  SELECT ct.tag_id INTO v_other
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = p_contact_id
    AND ct.tag_id <> p_tag_id
    AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    -- Solo la marca: agent_enabled no esta en el SET, asi que la marca no se limpia.
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_tag_id = v_other
      WHERE contact_id = p_contact_id AND agent_disabled_by_tag_id = p_tag_id
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  -- 00268: si sigue siendo conocido o cliente, la marca pasa a esa y nada se prende.
  ELSIF coalesce(v_known, false) OR coalesce(v_customer, false) THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_tag_id = NULL,
          agent_disabled_by_known = coalesce(v_known, false),
          agent_disabled_by_customer = NOT coalesce(v_known, false)
      WHERE contact_id = p_contact_id AND agent_disabled_by_tag_id = p_tag_id
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    WITH upd AS (
      UPDATE public.conversations
      SET agent_enabled = NULL, agent_disabled_by_tag_id = NULL
      WHERE contact_id = p_contact_id
        AND agent_disabled_by_tag_id = p_tag_id
        AND agent_enabled = false
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
  END IF;

  IF NOT p_always_audit AND jsonb_array_length(v_restored) = 0 AND jsonb_array_length(v_moved) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace, 'contact', p_contact_id, 'tag_effect', NULL,
    jsonb_build_object(
      'removed', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', p_tag_name,
      'conversations_restored', v_restored,
      'still_disabled_by_tag_id', v_other,
      'conversations_still_disabled', v_moved,
      'assignment_kept', true
    ),
    auth.uid()
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.tag_effect_release(p_contact_id uuid, p_tag_id uuid, p_origin text, p_tag_name text, p_always_audit boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.apply_opt_out_check(p_contact_id uuid, p_conversation_id uuid DEFAULT NULL::uuid, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_workspace_id uuid;
  v_already      boolean;
  v_phrases      jsonb;
  v_phrase       text;
  v_match        text := NULL;
  v_paused       integer := 0;
BEGIN
  IF p_contact_id IS NULL OR btrim(coalesce(p_text, '')) = '' THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  SELECT c.workspace_id, c.do_not_contact
    INTO v_workspace_id, v_already
  FROM public.contacts c
  WHERE c.id = p_contact_id;

  IF v_workspace_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- Ya marcado: no se vuelve a escribir nada. Sin esta guarda, cada mensaje
  -- posterior del lead sumaria otra entrada identica al audit log y pisaria la
  -- razon original, que es la que explica por que quedo marcado.
  IF v_already THEN
    RETURN jsonb_build_object('matched', false, 'already', true, 'sequences_paused', 0);
  END IF;

  SELECT w.opt_out_phrases INTO v_phrases
  FROM public.workspaces w WHERE w.id = v_workspace_id;

  FOR v_phrase IN SELECT jsonb_array_elements_text(coalesce(v_phrases, '[]'::jsonb))
  LOOP
    IF public.text_matches_phrase(p_text, v_phrase) THEN
      v_match := v_phrase;
      EXIT;
    END IF;
  END LOOP;

  IF v_match IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'already', false, 'sequences_paused', 0);
  END IF;

  -- is_subscribed tambien baja: es la marca que ya miraban los broadcasts y
  -- las palabras clave globales del sistema original, y seria raro que un contacto
  -- quede "no contactar" pero suscripto.
  UPDATE public.contacts
  SET do_not_contact = true,
      do_not_contact_reason = 'auto: ' || v_match,
      do_not_contact_at = now(),
      is_subscribed = false
  WHERE id = p_contact_id;

  UPDATE public.sequence_enrollments
  SET status = 'paused'
  WHERE contact_id = p_contact_id AND status = 'active';
  GET DIAGNOSTICS v_paused = ROW_COUNT;

  -- performed_by en null: lo hizo el sistema, no una persona.
  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace_id, 'contact', p_contact_id, 'do_not_contact',
    jsonb_build_object('do_not_contact', jsonb_build_object('old', false, 'new', true)),
    jsonb_build_object(
      'source', 'auto',
      'phrase', v_match,
      'conversation_id', p_conversation_id,
      'sequences_paused', v_paused
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'matched', true, 'phrase', v_match, 'already', false, 'sequences_paused', v_paused
  );
END;
$function$;
COMMENT ON FUNCTION public.apply_opt_out_check(p_contact_id uuid, p_conversation_id uuid, p_text text) IS 'Marca el contacto como "no contactar" si el mensaje trae una frase de opt-out del workspace: pausa sus secuencias activas y deja la entrada en audit_log, todo en una transaccion. La llaman los dos receptores de webhooks. Idempotente: sobre un contacto ya marcado no escribe nada.';
REVOKE ALL ON FUNCTION public.apply_opt_out_check(p_contact_id uuid, p_conversation_id uuid, p_text text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_see_contact(c public.contacts)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_scope    text;
  v_channels jsonb;
BEGIN
  IF NOT public.is_workspace_member(c.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(c.workspace_id) THEN
    RETURN true;
  END IF;

  -- El alcance de leads de MI rol. Un valor que no conoce se trata como 'own':
  -- ante la duda, lo mas angosto.
  v_scope := public.permission_scope(c.workspace_id, 'leads');

  IF v_scope = 'all' THEN
    RETURN true;
  END IF;

  -- Asignado a mi, por cualquiera de las tres vias.
  IF private.contact_is_mine(c) THEN
    RETURN true;
  END IF;

  -- Sin asignar: lo decide el rol. "Asignado" incluye tener setter o vendedor,
  -- aunque ninguna conversacion tenga agente.
  IF v_scope = 'own_unassigned' AND private.contact_is_unassigned(c) THEN
    RETURN true;
  END IF;

  -- Ver un chat deja ver la ficha (00249): si el contacto tiene una conversacion en una cuenta donde mi rol
  -- ve "todas", o "asignadas + sin asignar" y el contacto no es de nadie. (Lo "suyo" ya paso arriba.)
  v_channels := private.my_channels(c.workspace_id);
  IF v_channels ->> 'mode' = 'all' THEN
    IF (private.role_channel_grant(v_channels, NULL) ->> 'scope') = 'all'
       OR ((private.role_channel_grant(v_channels, NULL) ->> 'scope') = 'own_unassigned' AND private.contact_is_unassigned(c)) THEN
      RETURN EXISTS (SELECT 1 FROM public.conversations conv WHERE conv.contact_id = c.id AND conv.deleted_at IS NULL);
    END IF;
  ELSIF v_channels ->> 'mode' = 'custom' THEN
    IF EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.contact_id = c.id
        AND conv.deleted_at IS NULL
        AND (
          (private.role_channel_grant(v_channels, conv.channel_id::text) ->> 'scope') = 'all'
          OR ((private.role_channel_grant(v_channels, conv.channel_id::text) ->> 'scope') = 'own_unassigned'
              AND private.contact_is_unassigned(c))
        )
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;
COMMENT ON FUNCTION public.can_see_contact(c public.contacts) IS 'Se ve un contacto si es del workspace y: sos Admin, o tu rol tiene alcance leads=all, o es tuyo (setter, vendedor o conversacion asignada), o tu rol tiene leads=own_unassigned y nadie lo tiene asignado, o (00249) tiene una conversacion que ves por su cuenta con "todas" o con "asignadas + sin asignar" y nadie lo tiene.';
REVOKE ALL ON FUNCTION public.can_see_contact(c public.contacts) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.contact_attribution_options(p_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH vals AS (
    SELECT t.touch, k.key, k.value
      FROM public.contacts c
      CROSS JOIN LATERAL (VALUES ('first', c.attribution -> 'first_touch'), ('last', c.attribution -> 'last_touch')) AS t(touch, data)
      CROSS JOIN LATERAL (VALUES ('campaign', t.data ->> 'campaign'), ('content', t.data ->> 'content'), ('term', t.data ->> 'term')) AS k(key, value)
     WHERE c.workspace_id = p_workspace_id
       AND c.deleted_at IS NULL
       AND jsonb_typeof(t.data) = 'object'
       AND nullif(btrim(k.value), '') IS NOT NULL
  ),
  lists AS (
    SELECT touch, key, (SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT value AS v FROM vals x WHERE x.touch = g.touch AND x.key = g.key ORDER BY 1 LIMIT 300) d) AS items
      FROM (SELECT DISTINCT touch, key FROM vals) g
  )
  SELECT coalesce(jsonb_object_agg(touch || '_' || key, items), '{}'::jsonb) FROM lists
$function$;
COMMENT ON FUNCTION public.contact_attribution_options(p_workspace_id uuid) IS 'Valores de campaña, contenido y término del primer y último toque (claves first_campaign, last_term…), para los filtros de la lista de contactos. SECURITY INVOKER: respeta la RLS de quien llama.';
REVOKE ALL ON FUNCTION public.contact_attribution_options(p_workspace_id uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.contact_custom_fields_emit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_slug    text;
BEGIN
  -- Un update que deja el mismo valor no es un cambio.
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = NEW.contact_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.custom_field_definitions WHERE id = NEW.field_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id, 'field_changed', v_contact.id,
    jsonb_build_object(
      'field_id', NEW.field_id,
      'field_slug', v_slug,
      'value', NEW.value,
      'previous_value', CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END
    )
  );

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_custom_fields_emit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_tags_apply_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_name     text;
  v_disables boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'tag_added');
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- En la cascada de un DELETE en tags la fila ya no esta: ese caso lo
    -- resolvio tags_effect_changed antes de borrar.
    SELECT name, disables_agent INTO v_name, v_disables FROM public.tags WHERE id = OLD.tag_id;
    IF FOUND AND v_disables THEN
      PERFORM private.tag_effect_release(OLD.contact_id, OLD.tag_id, 'tag_removed', v_name, true);
    END IF;
    RETURN NULL;
  END IF;

  -- UPDATE OF contact_id: la fusion de contactos mueve las etiquetas del
  -- duplicado al principal (lib/actions/contacts.ts, linkContacts).
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'contact_merge');
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_tags_apply_effects() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_tags_emit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_tag_name text;
  v_tag_id   uuid;
BEGIN
  v_tag_id := COALESCE(NEW.tag_id, OLD.tag_id);

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT name INTO v_tag_name FROM public.tags WHERE id = v_tag_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'tag_added' ELSE 'tag_removed' END,
    v_contact.id,
    jsonb_build_object('tag_id', v_tag_id, 'tag_name', v_tag_name)
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;
REVOKE ALL ON FUNCTION public.contact_tags_emit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_customer_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_assigned jsonb := '[]'::jsonb;
  v_forced   jsonb := '[]'::jsonb;
  v_restored jsonb := '[]'::jsonb;
  v_moved    jsonb := '[]'::jsonb;
  v_tag      uuid;
BEGIN
  IF NEW.is_customer IS NOT DISTINCT FROM OLD.is_customer THEN
    RETURN NULL;
  END IF;

  IF NEW.is_customer THEN
    WITH target AS (
      SELECT c.id, c.assigned_to AS previous, private.customer_assignee(c.workspace_id, c.channel_id) AS next
      FROM public.conversations c
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL
    ), upd AS (
      UPDATE public.conversations c
      SET assigned_to = target.next
      FROM target
      WHERE c.id = target.id AND target.next IS NOT NULL AND c.assigned_to IS DISTINCT FROM target.next
      RETURNING c.id, target.previous, target.next
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'old', upd.previous, 'new', upd.next)), '[]'::jsonb)
      INTO v_assigned FROM upd;

    WITH upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_customer = true
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL AND c.agent_enabled IS DISTINCT FROM false
      RETURNING c.id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_forced FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'customer',
      jsonb_build_object('is_customer', jsonb_build_object('old', false, 'new', true)),
      jsonb_build_object('source', NEW.customer_source, 'conversations_assigned', v_assigned, 'conversations_forced_off', v_forced),
      auth.uid()
    );
    RETURN NULL;
  END IF;

  -- Quitar. Si sigue siendo conocido, la marca pasa a la de conocido.
  IF NEW.is_known THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_customer = false, agent_disabled_by_known = true
      WHERE contact_id = NEW.id AND agent_disabled_by_customer
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    SELECT ct.tag_id INTO v_tag
    FROM public.contact_tags ct
    JOIN public.tags t ON t.id = ct.tag_id
    WHERE ct.contact_id = NEW.id AND t.disables_agent
    ORDER BY ct.created_at
    LIMIT 1;

    IF v_tag IS NOT NULL THEN
      WITH upd AS (
        UPDATE public.conversations
        SET agent_disabled_by_customer = false, agent_disabled_by_tag_id = v_tag
        WHERE contact_id = NEW.id AND agent_disabled_by_customer
        RETURNING id
      )
      SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
    ELSE
      WITH upd AS (
        UPDATE public.conversations
        SET agent_enabled = NULL, agent_disabled_by_customer = false
        WHERE contact_id = NEW.id AND agent_disabled_by_customer AND agent_enabled = false
        RETURNING id
      )
      SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
    END IF;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    NEW.workspace_id, 'contact', NEW.id, 'customer',
    jsonb_build_object('is_customer', jsonb_build_object('old', true, 'new', false)),
    jsonb_build_object('conversations_restored', v_restored, 'still_known', NEW.is_known, 'still_disabled_by_tag_id', v_tag,
      'conversations_still_disabled', v_moved, 'assignment_kept', true),
    auth.uid()
  );
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_customer_effects() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_customer_on_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main uuid;
BEGIN
  IF NOT OLD.is_customer OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  UPDATE public.contacts
  SET is_customer = true,
      customer_marked_by = coalesce(customer_marked_by, OLD.customer_marked_by),
      customer_marked_at = coalesce(customer_marked_at, OLD.customer_marked_at, now()),
      customer_source = coalesce(customer_source, OLD.customer_source, 'manual')
  WHERE id = v_main AND workspace_id = NEW.workspace_id AND NOT is_customer;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_customer_on_merge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_emit_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.setter_id IS DISTINCT FROM OLD.setter_id AND NEW.setter_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'setter', 'user_id', NEW.setter_id)
    );
  END IF;

  IF NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id AND NEW.vendedor_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'vendedor', 'user_id', NEW.vendedor_id)
    );
  END IF;

  -- Solo al activarse: desmarcar no es un evento que valga la pena automatizar.
  IF COALESCE(NEW.do_not_contact, false) AND NOT COALESCE(OLD.do_not_contact, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'do_not_contact', NEW.id,
      jsonb_build_object('reason', NEW.do_not_contact_reason)
    );
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_emit_changes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_emit_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_automation_event(
    NEW.workspace_id,
    'contact_created',
    NEW.id,
    jsonb_build_object(
      'source',
      COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown')
    )
  );
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_emit_created() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_emit_deanonymized()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF COALESCE(OLD.is_anonymous, false) AND NOT COALESCE(NEW.is_anonymous, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id,
      'contact_created',
      NEW.id,
      jsonb_build_object(
        'source',
        COALESCE(NEW.attribution->'first_touch'->>'source', NEW.attribution->>'source', 'unknown'),
        'deanonymized', true
      )
    );
  END IF;
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION public.contacts_emit_deanonymized() IS 'Emite contact_created cuando un contacto anonimo se completa. Escucha las columnas que alimentan is_anonymous, porque una columna generada nunca aparece en el SET de un UPDATE y un trigger UPDATE OF sobre ella no dispara nunca.';
REVOKE ALL ON FUNCTION public.contacts_emit_deanonymized() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_known_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_assigned jsonb := '[]'::jsonb;
  v_forced   jsonb := '[]'::jsonb;
  v_restored jsonb := '[]'::jsonb;
  v_moved    jsonb := '[]'::jsonb;
  v_tag      uuid;
BEGIN
  IF NEW.is_known IS NOT DISTINCT FROM OLD.is_known THEN
    RETURN NULL;
  END IF;

  IF NEW.is_known THEN
    -- Responsable: la persona de la cuenta de cada conversacion.
    WITH target AS (
      SELECT c.id, c.assigned_to AS previous, private.known_assignee(c.workspace_id, c.channel_id) AS next
      FROM public.conversations c
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL
    ), upd AS (
      UPDATE public.conversations c
      SET assigned_to = target.next
      FROM target
      WHERE c.id = target.id AND target.next IS NOT NULL AND c.assigned_to IS DISTINCT FROM target.next
      RETURNING c.id, target.previous, target.next
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'old', upd.previous, 'new', upd.next)), '[]'::jsonb)
      INTO v_assigned FROM upd;

    -- Agente: solo las que no estaban apagadas (un apagado a mano no se reclama).
    WITH upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_known = true
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL AND c.agent_enabled IS DISTINCT FROM false
      RETURNING c.id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_forced FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'known',
      jsonb_build_object('is_known', jsonb_build_object('old', false, 'new', true)),
      jsonb_build_object('conversations_assigned', v_assigned, 'conversations_forced_off', v_forced),
      auth.uid()
    );
    RETURN NULL;
  END IF;

  -- 00268: si sigue siendo cliente, la marca pasa a la de cliente y nada se prende.
  IF NEW.is_customer THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_known = false, agent_disabled_by_customer = true
      WHERE contact_id = NEW.id AND agent_disabled_by_known
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'known',
      jsonb_build_object('is_known', jsonb_build_object('old', true, 'new', false)),
      jsonb_build_object('still_customer', true, 'conversations_still_disabled', v_moved, 'assignment_kept', true),
      auth.uid()
    );
    RETURN NULL;
  END IF;

  -- Quitar: si conserva una etiqueta que apaga el agente, la marca pasa a esa.
  SELECT ct.tag_id INTO v_tag
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = NEW.id AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_tag IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_known = false, agent_disabled_by_tag_id = v_tag
      WHERE contact_id = NEW.id AND agent_disabled_by_known
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    WITH upd AS (
      UPDATE public.conversations
      SET agent_enabled = NULL, agent_disabled_by_known = false
      WHERE contact_id = NEW.id AND agent_disabled_by_known AND agent_enabled = false
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    NEW.workspace_id, 'contact', NEW.id, 'known',
    jsonb_build_object('is_known', jsonb_build_object('old', true, 'new', false)),
    jsonb_build_object('conversations_restored', v_restored, 'still_disabled_by_tag_id', v_tag, 'conversations_still_disabled', v_moved, 'assignment_kept', true),
    auth.uid()
  );
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_known_effects() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_known_on_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main uuid;
BEGIN
  IF NOT OLD.is_known OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  UPDATE public.contacts
  SET is_known = true,
      known_marked_by = coalesce(known_marked_by, OLD.known_marked_by),
      known_marked_at = coalesce(known_marked_at, OLD.known_marked_at, now())
  WHERE id = v_main AND workspace_id = NEW.workspace_id AND NOT is_known;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_known_on_merge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contacts_qualification_on_merge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_main      uuid;
  v_main_lvl  smallint;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  BEGIN
    UPDATE public.contact_qualification_changes
       SET contact_id = v_main
     WHERE contact_id = OLD.id AND workspace_id = NEW.workspace_id;

    IF OLD.qualification_level IS NOT NULL THEN
      SELECT qualification_level INTO v_main_lvl
        FROM public.contacts
       WHERE id = v_main AND workspace_id = NEW.workspace_id;
      IF FOUND AND (v_main_lvl IS NULL OR OLD.qualification_level > v_main_lvl) THEN
        PERFORM set_config('app.contact_qualification_internal', 'on', true);
        UPDATE public.contacts
           SET qualification_level = OLD.qualification_level,
               qualification_at = coalesce(OLD.qualification_at, now()),
               qualification_by_agent = OLD.qualification_by_agent
         WHERE id = v_main AND workspace_id = NEW.workspace_id;
        PERFORM set_config('app.contact_qualification_internal', 'off', true);
        INSERT INTO public.contact_qualification_changes
          (workspace_id, contact_id, old_level, new_level, source, reason)
        VALUES
          (NEW.workspace_id, v_main, v_main_lvl, OLD.qualification_level, 'merge', 'Fusión de contactos');
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM set_config('app.contact_qualification_internal', 'off', true);
    RAISE WARNING 'contacts_qualification_on_merge: no pude mover la calificacion del contacto %: %', OLD.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.contacts_qualification_on_merge() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_address_send_state(p_workspace_id uuid, p_email text, p_contact_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_addr text := public.normalize_email(p_email);
  v_token uuid;
  v_matched boolean;
  v_dnc boolean;
BEGIN
  IF v_addr IS NULL THEN
    RETURN jsonb_build_object('status', 'subscribed', 'do_not_contact', false, 'token', NULL, 'matched', false);
  END IF;

  SELECT EXISTS (
           SELECT 1 FROM public.contacts c
            WHERE c.workspace_id = p_workspace_id
              AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)),
         EXISTS (
           SELECT 1 FROM public.contacts c
            WHERE c.workspace_id = p_workspace_id AND c.deleted_at IS NULL AND c.do_not_contact
              AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr))
    INTO v_matched, v_dnc;

  -- El token: el del contacto del envio si esa direccion es suya; si no, el de
  -- un contacto con esa direccion (los vivos primero, el mas antiguo).
  SELECT c.email_unsubscribe_token INTO v_token
    FROM public.contacts c
   WHERE c.workspace_id = p_workspace_id
     AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr)
   ORDER BY (c.id = p_contact_id) DESC, (c.deleted_at IS NULL) DESC, c.created_at
   LIMIT 1;

  RETURN jsonb_build_object(
    'status', public.email_address_status(p_workspace_id, v_addr),
    'do_not_contact', coalesce(v_dnc, false),
    'token', v_token,
    'matched', coalesce(v_matched, false));
END;
$function$;
REVOKE ALL ON FUNCTION public.email_address_send_state(p_workspace_id uuid, p_email text, p_contact_id uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.email_address_status(p_workspace_id uuid, p_email text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    (SELECT c.email_status
       FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id
        AND public.normalize_email(p_email) IS NOT NULL
        AND (public.normalize_email(c.email) = public.normalize_email(p_email)
             OR public.normalize_email(c.secondary_email) = public.normalize_email(p_email))
      ORDER BY private.email_status_rank(c.email_status) DESC
      LIMIT 1),
    'subscribed');
$function$;
REVOKE ALL ON FUNCTION public.email_address_status(p_workspace_id uuid, p_email text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_or_create_contact(p_workspace_id uuid, p_identity jsonb, p_defaults jsonb DEFAULT '{}'::jsonb, p_mode text DEFAULT 'create'::text, p_allow_without_identity boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ident     jsonb;
  v_defaults  jsonb := CASE WHEN jsonb_typeof(p_defaults) = 'object' THEN p_defaults ELSE '{}'::jsonb END;
  v_key       text;
  v_found     jsonb;
  v_row       jsonb;
  v_cols      text;
  v_id        uuid;
  v_has_ident boolean;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact: falta el workspace' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('create', 'link_channel', 'find_only') THEN
    RAISE EXCEPTION 'find_or_create_contact: modalidad invalida (%)', p_mode USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_ident := private.contact_normalize_identity(p_identity);

  IF p_mode = 'link_channel' AND v_ident ->> 'channel_id' IS NULL THEN
    RAISE EXCEPTION 'find_or_create_contact: link_channel necesita el canal y el id del remitente' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_has_ident := v_ident ? 'channel_id' OR v_ident ? 'phone' OR v_ident ? 'whatsapp_phone' OR v_ident ? 'email'
                 OR v_ident ? 'secondary_email' OR v_ident ? 'instagram' OR v_ident ? 'tiktok' OR v_ident ? 'x'
                 OR v_ident ? 'linkedin' OR v_ident ? 'facebook';

  IF NOT v_has_ident AND NOT (p_allow_without_identity AND p_mode <> 'find_only') THEN
    RETURN jsonb_build_object('contact_id', NULL, 'created', false, 'matched_by', NULL,
                              'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'no_identity');
  END IF;

  -- Un bloqueo por cada dato, SIEMPRE ordenados por la clave.
  FOR v_key IN
    SELECT k FROM unnest(ARRAY[
      'channel:' || (v_ident ->> 'channel_id') || ':' || (v_ident ->> 'sender_id'),
      'phone:' || (v_ident ->> 'phone'),
      'phone:' || (v_ident ->> 'whatsapp_phone'),
      'email:' || (v_ident ->> 'email'),
      'email:' || (v_ident ->> 'secondary_email'),
      'instagram:' || (v_ident ->> 'instagram'),
      'tiktok:' || (v_ident ->> 'tiktok'),
      'x:' || (v_ident ->> 'x'),
      'linkedin:' || (v_ident ->> 'linkedin'),
      'facebook:' || (v_ident ->> 'facebook')
    ]) AS k WHERE k IS NOT NULL GROUP BY k ORDER BY k COLLATE "C"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('contact-identity:' || p_workspace_id::text || ':' || v_key, 0));
  END LOOP;

  IF v_has_ident THEN
    v_found := private.contact_identity_lookup(p_workspace_id, v_ident);
    IF v_found ->> 'contact_id' IS NOT NULL THEN
      RETURN jsonb_build_object(
        'contact_id', v_found ->> 'contact_id', 'created', false, 'matched_by', v_found ->> 'matched_by',
        'conflict_contact_id', v_found ->> 'conflict_contact_id', 'conflicts', v_found -> 'conflicts', 'status', 'found');
    END IF;
  END IF;

  IF p_mode = 'find_only' THEN
    RETURN jsonb_build_object('contact_id', NULL, 'created', false, 'matched_by', NULL,
                              'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'not_found');
  END IF;

  -- Crear. Las columnas de identidad salen SOLO de la identidad normalizada; los defaults no pisan nada
  -- de lo estructural.
  v_row := (v_defaults - ARRAY['id', 'workspace_id', 'deleted_at', 'created_at', 'updated_at',
                               'phone', 'whatsapp_phone', 'email', 'secondary_email',
                               'instagram_username', 'tiktok_username', 'twitter_username', 'linkedin_profile_url'])
           || jsonb_strip_nulls(jsonb_build_object(
                'workspace_id',         p_workspace_id,
                'phone',                v_ident -> 'phone',
                'whatsapp_phone',       v_ident -> 'whatsapp_phone',
                'email',                v_ident -> 'email',
                'secondary_email',      v_ident -> 'secondary_email',
                'instagram_username',   v_ident -> 'instagram',
                'tiktok_username',      v_ident -> 'tiktok',
                'twitter_username',     v_ident -> 'x',
                'linkedin_profile_url', v_ident -> 'linkedin',
                'facebook_id',          v_ident -> 'facebook'));

  -- Solo las claves que son columnas reales de `contacts` (y no generadas).
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.contacts'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND v_row ? a.attname::text;

  BEGIN
    EXECUTE format(
      'INSERT INTO public.contacts (%s) SELECT %s FROM jsonb_populate_record(NULL::public.contacts, $1) RETURNING id',
      v_cols, v_cols
    ) INTO v_id USING v_row;
  EXCEPTION WHEN unique_violation THEN
    -- Otro camino gano la carrera por un dato (no pasa si todos usan esta funcion, pero la base manda):
    -- se vuelve a buscar y se devuelve a quien ya estaba.
    IF v_has_ident THEN
      v_found := private.contact_identity_lookup(p_workspace_id, v_ident);
      IF v_found ->> 'contact_id' IS NOT NULL THEN
        RETURN jsonb_build_object(
          'contact_id', v_found ->> 'contact_id', 'created', false, 'matched_by', v_found ->> 'matched_by',
          'conflict_contact_id', v_found ->> 'conflict_contact_id', 'conflicts', v_found -> 'conflicts', 'status', 'found');
      END IF;
    END IF;
    RAISE;
  END;

  IF p_mode = 'link_channel' THEN
    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_id, (v_ident ->> 'channel_id')::uuid, v_ident ->> 'sender_id',
            COALESCE(v_ident ->> 'instagram', v_ident ->> 'tiktok', v_ident ->> 'x', v_ident ->> 'facebook'))
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('contact_id', v_id, 'created', true, 'matched_by', NULL,
                            'conflict_contact_id', NULL, 'conflicts', '[]'::jsonb, 'status', 'created');
END;
$function$;
REVOKE ALL ON FUNCTION public.find_or_create_contact(p_workspace_id uuid, p_identity jsonb, p_defaults jsonb, p_mode text, p_allow_without_identity boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_or_link_contact(p_channel_id uuid, p_sender_id text, p_display_name text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_avatar_url text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_interaction_at timestamp with time zone DEFAULT now(), p_stamp_existing boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws         uuid;
  v_platform   text;
  v_contact    uuid;
  v_suggested  uuid;
  v_linked_by  text := NULL;
  v_phone      text := public.normalize_phone(p_phone);
  v_email      text := public.normalize_email(p_email);
  v_handle     text := public.normalize_handle(p_username);
  v_name       text := NULLIF(btrim(p_display_name), '');
  v_known      boolean := false;
  v_central    jsonb;
  v_identity   jsonb;
  v_skip_phone boolean := false;
  v_skip_email boolean := false;
BEGIN
  SELECT ch.workspace_id, ch.platform INTO v_ws, v_platform
  FROM public.channels ch WHERE ch.id = p_channel_id;

  IF v_ws IS NULL THEN
    RETURN jsonb_build_object('contact_id', NULL, 'existed', false,
                              'linked_by', NULL, 'suggested_contact_id', NULL);
  END IF;

  -- ---- 1. El remitente ya es conocido en este canal (sin bloqueos: es lo comun) ------------------
  SELECT cc.contact_id INTO v_contact
  FROM public.contact_channels cc
  WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;
  v_known := v_contact IS NOT NULL;

  -- ---- 2. Buscar o crear con la regla central ---------------------------------------------------
  IF NOT v_known THEN
    v_identity := jsonb_strip_nulls(jsonb_build_object(
      'channel_id',     p_channel_id,
      'sender_id',      p_sender_id,
      'phone',          v_phone,
      'whatsapp_phone', CASE WHEN v_platform = 'whatsapp' THEN v_phone END,
      'email',          v_email,
      'instagram',      CASE WHEN v_platform = 'instagram' THEN v_handle END,
      'x',              CASE WHEN v_platform = 'twitter'   THEN v_handle END,
      'facebook',       CASE WHEN v_platform = 'facebook'  THEN v_handle END,
      'tiktok',         CASE WHEN v_platform = 'tiktok'    THEN v_handle END
    ));

    v_central := public.find_or_create_contact(
      v_ws,
      v_identity,
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', v_name,
        'avatar_url', p_avatar_url,
        'last_interaction_at', p_interaction_at,
        'metadata', '{}'::jsonb
      )),
      'link_channel'
    );
    v_contact := (v_central ->> 'contact_id')::uuid;

    -- La regla central tambien mira el canal: otro mensaje de este mismo remitente pudo ganarnos de mano.
    IF v_central ->> 'matched_by' = 'channel' THEN v_known := true; END IF;
  END IF;

  -- ---- Remitente ya conocido ---------------------------------------------------------------------
  IF v_known THEN
    UPDATE public.contacts c SET
      last_interaction_at = CASE
        WHEN p_stamp_existing THEN p_interaction_at
        ELSE c.last_interaction_at
      END,
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE c.display_name
      END,
      -- F16: una foto external se refresca con la URL fresca que trae este mensaje. storage y manual
      -- no se pisan nunca.
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
      instagram_username = CASE
        WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle)
        ELSE c.instagram_username
      END,
      twitter_username = CASE
        WHEN v_platform = 'twitter' THEN COALESCE(c.twitter_username, v_handle)
        ELSE c.twitter_username
      END,
      facebook_id = CASE
        WHEN v_platform = 'facebook' THEN COALESCE(c.facebook_id, v_handle)
        ELSE c.facebook_id
      END,
      tiktok_username = CASE
        WHEN v_platform = 'tiktok' THEN COALESCE(c.tiktok_username, v_handle)
        ELSE c.tiktok_username
      END
    WHERE c.id = v_contact;

    UPDATE public.contact_channels cc
    SET platform_username = COALESCE(cc.platform_username, v_handle)
    WHERE cc.channel_id = p_channel_id AND cc.platform_sender_id = p_sender_id;

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', 'channel', 'suggested_contact_id', NULL);
  END IF;

  -- ---- Lo encontro por otro dato: vincular al contacto -------------------------------------------
  IF (v_central ->> 'status') = 'found' THEN
    v_linked_by := CASE v_central ->> 'matched_by'
                     WHEN 'phone' THEN 'phone'
                     WHEN 'email' THEN 'email'
                     ELSE 'username'
                   END;

    -- Un telefono o email que ya es de OTRO contacto no se escribe en este.
    v_skip_phone := private.contact_value_taken(v_ws, v_contact, 'phone', v_phone);
    v_skip_email := private.contact_value_taken(v_ws, v_contact, 'email', v_email);

    UPDATE public.contacts c SET
      last_interaction_at = GREATEST(COALESCE(c.last_interaction_at, p_interaction_at), p_interaction_at),
      display_name = CASE
        WHEN v_name IS NOT NULL
         AND NOT public.is_placeholder_name(v_name)
         AND public.is_placeholder_name(c.display_name)
        THEN v_name
        ELSE COALESCE(c.display_name, v_name)
      END,
      avatar_url = CASE
        WHEN c.avatar_source = 'external' AND p_avatar_url IS NOT NULL THEN p_avatar_url
        ELSE COALESCE(c.avatar_url, p_avatar_url)
      END,
      phone               = CASE WHEN v_skip_phone THEN c.phone ELSE COALESCE(c.phone, v_phone) END,
      email               = CASE WHEN v_skip_email THEN c.email ELSE COALESCE(c.email, v_email) END,
      whatsapp_phone      = CASE WHEN v_platform = 'whatsapp' AND NOT v_skip_phone THEN COALESCE(c.whatsapp_phone, v_phone) ELSE c.whatsapp_phone END,
      instagram_username  = CASE WHEN v_platform = 'instagram' THEN COALESCE(c.instagram_username, v_handle) ELSE c.instagram_username END,
      twitter_username    = CASE WHEN v_platform = 'twitter'   THEN COALESCE(c.twitter_username, v_handle)   ELSE c.twitter_username END,
      facebook_id         = CASE WHEN v_platform = 'facebook'  THEN COALESCE(c.facebook_id, v_handle)        ELSE c.facebook_id END,
      tiktok_username     = CASE WHEN v_platform = 'tiktok'    THEN COALESCE(c.tiktok_username, v_handle)    ELSE c.tiktok_username END
    WHERE c.id = v_contact;

    INSERT INTO public.contact_channels (contact_id, channel_id, platform_sender_id, platform_username)
    VALUES (v_contact, p_channel_id, p_sender_id, v_handle)
    ON CONFLICT (channel_id, platform_sender_id) DO NOTHING;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
    VALUES (v_ws, 'contact', v_contact, 'link',
            jsonb_build_object('linked_by', v_linked_by, 'channel_id', p_channel_id,
                               'platform', v_platform, 'automatic', true),
            NULL);

    RETURN jsonb_build_object('contact_id', v_contact, 'existed', true,
                              'linked_by', v_linked_by, 'suggested_contact_id', NULL);
  END IF;

  -- ---- Contacto nuevo (ya lo creo la regla central, con el canal vinculado) ----------------------
  IF v_handle IS NOT NULL THEN
    SELECT c.id INTO v_suggested
    FROM public.contacts c
    WHERE c.workspace_id = v_ws
      AND c.deleted_at IS NULL
      AND c.id <> v_contact
      AND (lower(c.instagram_username) = v_handle
           OR lower(c.twitter_username) = v_handle
           OR lower(c.facebook_id) = v_handle
           OR lower(c.tiktok_username) = v_handle)
    ORDER BY c.created_at
    LIMIT 1;

    IF v_suggested IS NOT NULL THEN
      UPDATE public.contacts c
      SET metadata = jsonb_build_object('link_suggestions', jsonb_build_array(
            jsonb_build_object('contact_id', v_suggested, 'reason', 'username',
                               'handle', v_handle, 'at', p_interaction_at)))
      WHERE c.id = v_contact;
    END IF;
  END IF;

  INSERT INTO public.analytics_events (workspace_id, contact_id, event_type, metadata)
  VALUES (v_ws, v_contact, 'contact_created',
          jsonb_build_object('channel_id', p_channel_id, 'platform', v_platform));

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, metadata, performed_by)
  VALUES (v_ws, 'contact', v_contact, 'create',
          jsonb_build_object('source', 'inbound', 'channel_id', p_channel_id,
                             'platform', v_platform), NULL);

  RETURN jsonb_build_object('contact_id', v_contact, 'existed', false,
                            'linked_by', NULL, 'suggested_contact_id', v_suggested);
END;
$function$;
COMMENT ON FUNCTION public.find_or_link_contact(p_channel_id uuid, p_sender_id text, p_display_name text, p_username text, p_avatar_url text, p_phone text, p_email text, p_interaction_at timestamp with time zone, p_stamp_existing boolean) IS 'Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts). F16: el avatar_url de un contacto external se refresca con cada mensaje; storage y manual no se pisan nunca (avatar_source).';
REVOKE ALL ON FUNCTION public.find_or_link_contact(p_channel_id uuid, p_sender_id text, p_display_name text, p_username text, p_avatar_url text, p_phone text, p_email text, p_interaction_at timestamp with time zone, p_stamp_existing boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_contact_qualification(p_workspace_id uuid, p_contact_id uuid, p_mode text, p_value integer DEFAULT NULL::integer, p_actor_user uuid DEFAULT NULL::uuid, p_actor_agent uuid DEFAULT NULL::uuid, p_source text DEFAULT 'person'::text, p_flow_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_respect_human boolean DEFAULT false, p_only_raise boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_old     smallint;
  v_next    integer;
  v_new     smallint;
  v_now     timestamptz := now();
  v_change  uuid;
  v_dir     text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('set', 'add', 'clear') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('person', 'agent', 'automation', 'import') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;

  SELECT * INTO v_contact
    FROM public.contacts
   WHERE id = p_contact_id
     AND workspace_id = p_workspace_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  v_old := v_contact.qualification_level;
  v_next := private.qualification_next_level(v_old, p_mode, p_value);
  IF v_next = -1 THEN
    RETURN jsonb_build_object('result', 'invalid', 'old_level', v_old);
  END IF;
  v_new := v_next::smallint;

  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object('result', 'unchanged', 'old_level', v_old, 'new_level', v_new);
  END IF;

  IF p_respect_human AND v_old IS NOT NULL AND NOT v_contact.qualification_by_agent THEN
    RETURN jsonb_build_object('result', 'protected', 'old_level', v_old, 'new_level', v_new);
  END IF;

  IF p_only_raise AND v_old IS NOT NULL AND (v_new IS NULL OR v_new < v_old) THEN
    RETURN jsonb_build_object('result', 'not_raised', 'old_level', v_old, 'new_level', v_new);
  END IF;

  PERFORM set_config('app.contact_qualification_internal', 'on', true);
  UPDATE public.contacts
     SET qualification_level = v_new,
         qualification_at = CASE WHEN v_new IS NULL THEN NULL ELSE v_now END,
         qualification_by_agent = v_new IS NOT NULL AND p_actor_agent IS NOT NULL,
         updated_at = v_now
   WHERE id = p_contact_id;
  PERFORM set_config('app.contact_qualification_internal', 'off', true);

  INSERT INTO public.contact_qualification_changes
    (workspace_id, contact_id, old_level, new_level, source, changed_by, changed_by_agent_id, flow_id, reason, created_at)
  VALUES
    (p_workspace_id, p_contact_id, v_old, v_new, p_source, p_actor_user, p_actor_agent, p_flow_id,
     left(nullif(btrim(coalesce(p_reason, '')), ''), 300), v_now)
  RETURNING id INTO v_change;

  v_dir := CASE
    WHEN v_new IS NULL THEN 'cleared'
    WHEN v_old IS NULL OR v_new > v_old THEN 'up'
    ELSE 'down'
  END;

  -- El evento de automatizacion nunca tumba el cambio.
  BEGIN
    PERFORM public.emit_automation_event(
      p_workspace_id, 'qualification_changed', p_contact_id,
      jsonb_build_object('level', v_new, 'previous_level', v_old, 'direction', v_dir,
                         'source', p_source, 'change_id', v_change)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_contact_qualification: no pude emitir el evento: %', SQLERRM;
  END;

  RETURN jsonb_build_object('result', 'changed', 'old_level', v_old, 'new_level', v_new, 'change_id', v_change);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_contact_qualification(p_workspace_id uuid, p_contact_id uuid, p_mode text, p_value integer, p_actor_user uuid, p_actor_agent uuid, p_source text, p_flow_id uuid, p_reason text, p_respect_human boolean, p_only_raise boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_contact_status(p_workspace_id uuid, p_contact_id uuid, p_role text, p_status text, p_actor_user uuid DEFAULT NULL::uuid, p_actor_agent uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_respect_human boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_settings jsonb;
  v_list     jsonb;
  v_old      text;
  v_status   text := nullif(btrim(coalesce(p_status, '')), '');
  v_now      timestamptz := now();
  v_setter   text;
  v_setter_at timestamptz;
  v_closer   text;
  v_closer_at timestamptz;
  v_by_agent boolean;
  v_last_role text;
  v_last     text;
  v_last_at  timestamptz;
  v_change   uuid;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('setter', 'closer') THEN
    RAISE EXCEPTION 'Rol de estado invalido: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_contact
    FROM public.contacts
   WHERE id = p_contact_id
     AND workspace_id = p_workspace_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  v_old := CASE WHEN p_role = 'setter' THEN v_contact.setter_status ELSE v_contact.closer_status END;

  IF v_old IS NOT DISTINCT FROM v_status THEN
    RETURN jsonb_build_object('result', 'unchanged', 'old_status', v_old, 'new_status', v_status,
      'last_status_role', v_contact.last_status_role, 'last_status', v_contact.last_status,
      'last_status_at', v_contact.last_status_at);
  END IF;

  -- El estado tiene que existir en la lista de ese rol y no estar archivado.
  -- Sin la lista guardada, los estados por defecto (igual que parseStatusSettings).
  IF v_status IS NOT NULL THEN
    SELECT contact_status_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
    IF v_settings IS NULL OR jsonb_typeof(v_settings) <> 'object' OR NOT (v_settings ? p_role) THEN
      v_list := private.default_contact_status_settings() -> p_role;
    ELSE
      v_list := v_settings -> p_role;
    END IF;
    IF jsonb_typeof(v_list) <> 'array' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list) e
       WHERE e ->> 'key' = v_status
         AND (e -> 'archived_at' IS NULL OR jsonb_typeof(e -> 'archived_at') = 'null')
    ) THEN
      RETURN jsonb_build_object('result', 'invalid_status', 'old_status', v_old, 'new_status', v_status);
    END IF;
  END IF;

  IF p_respect_human AND p_role = 'setter' AND v_old IS NOT NULL AND NOT v_contact.setter_status_by_agent THEN
    RETURN jsonb_build_object('result', 'protected', 'old_status', v_old, 'new_status', v_status);
  END IF;

  v_setter := v_contact.setter_status;
  v_setter_at := v_contact.setter_status_at;
  v_closer := v_contact.closer_status;
  v_closer_at := v_contact.closer_status_at;
  v_by_agent := v_contact.setter_status_by_agent;

  IF p_role = 'setter' THEN
    v_setter := v_status;
    v_setter_at := CASE WHEN v_status IS NULL THEN NULL ELSE v_now END;
    v_by_agent := v_status IS NOT NULL AND p_actor_agent IS NOT NULL;
  ELSE
    v_closer := v_status;
    v_closer_at := CASE WHEN v_status IS NULL THEN NULL ELSE v_now END;
  END IF;

  -- El ultimo: el de fecha mas reciente; con la misma fecha, el del vendedor
  -- (gemela de `deriveLastStatus`, lib/contacts/statuses.ts).
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;

  PERFORM set_config('app.contact_status_internal', 'on', true);
  UPDATE public.contacts
     SET setter_status = v_setter,
         setter_status_at = v_setter_at,
         setter_status_by_agent = v_by_agent,
         closer_status = v_closer,
         closer_status_at = v_closer_at,
         last_status_role = v_last_role,
         last_status = v_last,
         last_status_at = v_last_at,
         updated_at = v_now
   WHERE id = p_contact_id;
  PERFORM set_config('app.contact_status_internal', 'off', true);

  INSERT INTO public.contact_status_changes
    (workspace_id, contact_id, role, old_status, new_status, changed_by, changed_by_agent_id, reason, created_at)
  VALUES
    (p_workspace_id, p_contact_id, p_role, v_old, v_status, p_actor_user, p_actor_agent,
     left(nullif(btrim(coalesce(p_reason, '')), ''), 300), v_now)
  RETURNING id INTO v_change;

  -- El evento de automatizacion nunca tumba el cambio.
  BEGIN
    PERFORM public.emit_automation_event(
      p_workspace_id, 'status_changed', p_contact_id,
      jsonb_build_object('role', p_role, 'status', v_status, 'previous_status', v_old, 'change_id', v_change)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_contact_status: no pude emitir el evento: %', SQLERRM;
  END;

  RETURN jsonb_build_object('result', 'changed', 'old_status', v_old, 'new_status', v_status,
    'last_status_role', v_last_role, 'last_status', v_last, 'last_status_at', v_last_at,
    'change_id', v_change);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_contact_status(p_workspace_id uuid, p_contact_id uuid, p_role text, p_status text, p_actor_user uuid, p_actor_agent uuid, p_reason text, p_respect_human boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_email_status_by_address(p_workspace_id uuid, p_email text, p_status text, p_source text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_performed_by uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'system'::text, p_subscribed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_addr text := public.normalize_email(p_email);
  v_ids uuid[];
BEGIN
  IF p_workspace_id IS NULL OR v_addr IS NULL THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;

  PERFORM private.email_status_lock(p_workspace_id, v_addr);

  SELECT array_agg(c.id) INTO v_ids
    FROM public.contacts c
   WHERE c.workspace_id = p_workspace_id
     AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr);

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;

  RETURN private.email_status_apply(p_workspace_id, v_ids, v_addr, p_status, p_source, p_occurred_at, p_reason,
                                    p_performed_by, p_mode, p_subscribed_at, p_extra);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_email_status_by_address(p_workspace_id uuid, p_email text, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_subscribed_at timestamp with time zone, p_extra jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_email_status(p_contact_id uuid, p_status text, p_source text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_reason text DEFAULT NULL::text, p_performed_by uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'system'::text, p_address text DEFAULT NULL::text, p_subscribed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_addr text;
  v_ids uuid[];
  v_contact public.contacts%ROWTYPE;
BEGIN
  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', NULL, 'previous_status', NULL, 'changed', false, 'kept_existing', false, 'not_found', true);
  END IF;
  v_ws := v_contact.workspace_id;
  v_addr := coalesce(public.normalize_email(p_address), public.normalize_email(v_contact.email), public.normalize_email(v_contact.secondary_email));

  PERFORM private.email_status_lock(v_ws, coalesce(v_addr, 'contact:' || p_contact_id::text));

  -- El contacto y todos los del workspace que comparten la direccion (vivos y borrados).
  SELECT array_agg(DISTINCT c.id) INTO v_ids
    FROM public.contacts c
   WHERE c.id = p_contact_id
      OR (v_addr IS NOT NULL AND c.workspace_id = v_ws
          AND (public.normalize_email(c.email) = v_addr OR public.normalize_email(c.secondary_email) = v_addr));

  RETURN private.email_status_apply(v_ws, v_ids, v_addr, p_status, p_source, p_occurred_at, p_reason,
                                    p_performed_by, p_mode, p_subscribed_at, p_extra);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_email_status(p_contact_id uuid, p_status text, p_source text, p_occurred_at timestamp with time zone, p_reason text, p_performed_by uuid, p_mode text, p_address text, p_subscribed_at timestamp with time zone, p_extra jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tags_effect_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- BEFORE DELETE: la fila todavia existe, se libera antes de la cascada.
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = OLD.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, OLD.id, 'tag_deleted', OLD.name, false);
    END LOOP;
    RETURN OLD;
  END IF;

  -- AFTER UPDATE OF disables_agent.
  IF NEW.disables_agent AND NOT OLD.disables_agent THEN
    FOR r IN SELECT contact_id FROM public.contact_tags WHERE tag_id = NEW.id LOOP
      PERFORM private.tag_effect_apply(r.contact_id, NEW.id, 'effect_enabled');
    END LOOP;
  ELSIF OLD.disables_agent AND NOT NEW.disables_agent THEN
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = NEW.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, NEW.id, 'effect_disabled', NEW.name, false);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tags_effect_changed() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contact_channels_contact ON public.contact_channels USING btree (contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_channels_sender ON public.contact_channels USING btree (platform_sender_id);

CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_date ON public.contact_custom_fields USING btree (field_id, value_date) WHERE (value_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_custom_fields_number ON public.contact_custom_fields USING btree (field_id, value_number) WHERE (value_number IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact ON public.contact_notes USING btree (contact_id, created_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contact_notes_deleted_at ON public.contact_notes USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_notes_service ON public.contact_notes USING btree (service_id) WHERE (service_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contact_qualification_changes_contact ON public.contact_qualification_changes USING btree (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_qualification_changes_workspace ON public.contact_qualification_changes USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_status_changes_contact ON public.contact_status_changes USING btree (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_status_changes_workspace ON public.contact_status_changes USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON public.contact_tags USING btree (tag_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_contact ON public.contacts USING btree (affiliate_contact_id) WHERE (affiliate_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_expires ON public.contacts USING btree (affiliate_expires_at) WHERE (affiliate_expires_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_affiliate_user ON public.contacts USING btree (workspace_id, affiliate_user_id) WHERE (affiliate_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_alive ON public.contacts USING btree (workspace_id, last_interaction_at DESC) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_closer_status ON public.contacts USING btree (workspace_id, closer_status) WHERE ((deleted_at IS NULL) AND (closer_status IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_country ON public.contacts USING btree (workspace_id, country) WHERE ((deleted_at IS NULL) AND (country IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_created ON public.contacts USING btree (workspace_id, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON public.contacts USING btree (workspace_id) WHERE is_customer;

CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at ON public.contacts USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts USING btree (workspace_id, lower(email)) WHERE (email IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_email_status ON public.contacts USING btree (workspace_id, email_status) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_facebook ON public.contacts USING btree (workspace_id, facebook_id) WHERE (facebook_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_campaign ON public.contacts USING btree (workspace_id, (((attribution -> 'first_touch'::text) ->> 'campaign'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_content_post ON public.contacts USING btree (workspace_id, (((attribution -> 'first_touch'::text) ->> 'content_post_id'::text))) WHERE ((deleted_at IS NULL) AND ((attribution -> 'first_touch'::text) ? 'content_post_id'::text));

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_medium ON public.contacts USING btree (workspace_id, (((attribution -> 'first_touch'::text) ->> 'medium'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_first_touch_source ON public.contacts USING btree (workspace_id, (((attribution -> 'first_touch'::text) ->> 'source'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_identified ON public.contacts USING btree (workspace_id, last_interaction_at DESC) WHERE ((deleted_at IS NULL) AND (NOT is_anonymous));

CREATE INDEX IF NOT EXISTS idx_contacts_instagram ON public.contacts USING btree (workspace_id, instagram_username) WHERE (instagram_username IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_instagram_lower ON public.contacts USING btree (workspace_id, lower(instagram_username)) WHERE ((deleted_at IS NULL) AND (instagram_username IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_interest_product ON public.contacts USING btree (workspace_id, interest_product_id) WHERE ((deleted_at IS NULL) AND (interest_product_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_interest_variant ON public.contacts USING btree (interest_variant_id) WHERE (interest_variant_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_known ON public.contacts USING btree (workspace_id) WHERE is_known;

CREATE INDEX IF NOT EXISTS idx_contacts_last_interaction ON public.contacts USING btree (workspace_id, last_interaction_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_last_status ON public.contacts USING btree (workspace_id, last_status_role, last_status) WHERE ((deleted_at IS NULL) AND (last_status IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_campaign ON public.contacts USING btree (workspace_id, (((attribution -> 'last_touch'::text) ->> 'campaign'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_medium ON public.contacts USING btree (workspace_id, (((attribution -> 'last_touch'::text) ->> 'medium'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_last_touch_source ON public.contacts USING btree (workspace_id, (((attribution -> 'last_touch'::text) ->> 'source'::text))) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_linkedin_slug ON public.contacts USING btree (workspace_id, public.linkedin_slug(linkedin_profile_url)) WHERE ((deleted_at IS NULL) AND (linkedin_profile_url IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_next_followup ON public.contacts USING btree (workspace_id, next_followup_date) WHERE ((deleted_at IS NULL) AND (next_followup_date IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON public.contacts USING btree (workspace_id, phone) WHERE (phone IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_qualification_level ON public.contacts USING btree (workspace_id, qualification_level) WHERE ((deleted_at IS NULL) AND (qualification_level IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_referred_by_contact ON public.contacts USING btree (referred_by_contact_id) WHERE (referred_by_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_secondary_email ON public.contacts USING btree (workspace_id, lower(secondary_email)) WHERE (secondary_email IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_setter ON public.contacts USING btree (workspace_id, setter_id) WHERE (setter_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_setter_status ON public.contacts USING btree (workspace_id, setter_status) WHERE ((deleted_at IS NULL) AND (setter_status IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_temperature ON public.contacts USING btree (workspace_id, lead_temperature) WHERE (lead_temperature IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_tiktok ON public.contacts USING btree (workspace_id, tiktok_username) WHERE (tiktok_username IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_tiktok_lower ON public.contacts USING btree (workspace_id, lower(tiktok_username)) WHERE ((deleted_at IS NULL) AND (tiktok_username IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_twitter ON public.contacts USING btree (workspace_id, twitter_username) WHERE (twitter_username IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_twitter_lower ON public.contacts USING btree (workspace_id, lower(twitter_username)) WHERE ((deleted_at IS NULL) AND (twitter_username IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_contacts_vendedor ON public.contacts USING btree (workspace_id, vendedor_id) WHERE (vendedor_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_phone ON public.contacts USING btree (workspace_id, whatsapp_phone) WHERE (whatsapp_phone IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace ON public.contacts USING btree (workspace_id);

CREATE INDEX IF NOT EXISTS idx_contacts_ws_created_alive ON public.contacts USING btree (workspace_id, created_at) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_ws_email_all ON public.contacts USING btree (workspace_id, public.normalize_email(email)) WHERE (public.normalize_email(email) IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contacts_ws_secondary_email_all ON public.contacts USING btree (workspace_id, public.normalize_email(secondary_email)) WHERE (public.normalize_email(secondary_email) IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_csv_imports_workspace ON public.csv_imports USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_alive ON public.custom_field_definitions USING btree (workspace_id, name) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_tags_with_effect ON public.tags USING btree (workspace_id) WHERE disables_agent;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_affiliate_code ON public.contacts USING btree (workspace_id, affiliate_code) WHERE (affiliate_code IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email_unsubscribe_token ON public.contacts USING btree (email_unsubscribe_token);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_email ON public.contacts USING btree (workspace_id, public.normalize_email(email)) WHERE ((deleted_at IS NULL) AND (public.normalize_email(email) IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_phone ON public.contacts USING btree (workspace_id, phone) WHERE ((deleted_at IS NULL) AND (phone IS NOT NULL) AND (btrim(phone) <> ''::text));

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER contact_custom_fields_automation AFTER INSERT OR UPDATE ON public.contact_custom_fields FOR EACH ROW EXECUTE FUNCTION public.contact_custom_fields_emit();

CREATE OR REPLACE TRIGGER contact_custom_fields_typed BEFORE INSERT OR UPDATE OF value, field_id ON public.contact_custom_fields FOR EACH ROW EXECUTE FUNCTION private.contact_custom_fields_typed();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER contact_tags_automation AFTER INSERT OR DELETE ON public.contact_tags FOR EACH ROW EXECUTE FUNCTION public.contact_tags_emit();

CREATE OR REPLACE TRIGGER contact_tags_effects AFTER INSERT OR DELETE OR UPDATE OF contact_id ON public.contact_tags FOR EACH ROW EXECUTE FUNCTION public.contact_tags_apply_effects();

CREATE OR REPLACE TRIGGER contacts_automation_changes AFTER UPDATE OF setter_id, vendedor_id, do_not_contact ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_changes();

CREATE OR REPLACE TRIGGER contacts_automation_created AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_created();

CREATE OR REPLACE TRIGGER contacts_automation_deanonymized AFTER UPDATE OF display_name, email, secondary_email, phone, whatsapp_phone, instagram_username, first_inbound_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

CREATE OR REPLACE TRIGGER contacts_customer_effects AFTER UPDATE OF is_customer ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_customer_effects();

CREATE OR REPLACE TRIGGER contacts_customer_on_merge AFTER UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_customer_on_merge();

CREATE OR REPLACE TRIGGER contacts_email_inherit AFTER INSERT OR UPDATE OF email, secondary_email ON public.contacts FOR EACH ROW WHEN ((new.deleted_at IS NULL)) EXECUTE FUNCTION private.contacts_email_inherit();

CREATE OR REPLACE TRIGGER contacts_email_on_merge AFTER UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.contacts_email_on_merge();

CREATE OR REPLACE TRIGGER contacts_email_status_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.contacts_email_status_guard();

CREATE OR REPLACE TRIGGER contacts_enqueue_sales_eval AFTER INSERT OR UPDATE OF attribution ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_enqueue_sales_eval();

CREATE OR REPLACE TRIGGER contacts_interest_check BEFORE INSERT OR UPDATE OF interest_product_id, interest_variant_id ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.contacts_interest_check();

CREATE OR REPLACE TRIGGER contacts_known_effects AFTER UPDATE OF is_known ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_known_effects();

CREATE OR REPLACE TRIGGER contacts_known_on_merge AFTER UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_known_on_merge();

CREATE OR REPLACE TRIGGER contacts_qualification_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.contacts_qualification_guard();

CREATE OR REPLACE TRIGGER contacts_qualification_on_merge AFTER UPDATE OF deleted_at ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.contacts_qualification_on_merge();

CREATE OR REPLACE TRIGGER contacts_status_guard BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.contacts_status_guard();

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER tags_effect_on_delete BEFORE DELETE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

CREATE OR REPLACE TRIGGER tags_effect_on_update AFTER UPDATE OF disables_agent ON public.tags FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY "Users can manage contact channels" ON public.contact_channels TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_channels.contact_id) AND public.is_workspace_member(c.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view contact channels via contact" ON public.contact_channels FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_channels.contact_id) AND public.is_workspace_member(c.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_custom_fields_select ON public.contact_custom_fields FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = contact_custom_fields.contact_id))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_custom_fields_write ON public.contact_custom_fields TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = contact_custom_fields.contact_id))))
    WITH CHECK ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = contact_custom_fields.contact_id))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE TO public
    USING (((created_by = auth.uid()) OR public.is_workspace_admin(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT TO public
    WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_notes.contact_id) AND (c.workspace_id = contact_notes.workspace_id))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT TO public
    USING (((deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = contact_notes.contact_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE TO public
    USING ((((created_by = auth.uid()) OR public.is_workspace_admin(workspace_id)) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = contact_notes.contact_id)))))
    WITH CHECK (((created_by = auth.uid()) OR public.is_workspace_admin(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_qualification_changes_select ON public.contact_qualification_changes FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_member(contact_qualification_changes.workspace_id) AS is_workspace_member) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_qualification_changes.contact_id) AND (c.workspace_id = contact_qualification_changes.workspace_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contact_status_changes_select ON public.contact_status_changes FOR SELECT TO authenticated
    USING ((( SELECT public.is_workspace_member(contact_status_changes.workspace_id) AS is_workspace_member) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_status_changes.contact_id) AND (c.workspace_id = contact_status_changes.workspace_id) AND public.can_see_contact(c.*))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can manage contact tags" ON public.contact_tags TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_tags.contact_id) AND public.is_workspace_member(c.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view contact tags" ON public.contact_tags FOR SELECT TO public
    USING ((EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE ((c.id = contact_tags.contact_id) AND public.is_workspace_member(c.workspace_id)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contacts_delete ON public.contacts FOR DELETE TO public
    USING (( SELECT public.has_permission(contacts.workspace_id, 'contacts.delete'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contacts_insert ON public.contacts FOR INSERT TO public
    WITH CHECK (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contacts_select ON public.contacts FOR SELECT TO public
    USING (((deleted_at IS NULL) AND public.can_see_contact(contacts.*)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY contacts_update ON public.contacts FOR UPDATE TO public
    USING (public.can_see_contact(contacts.*))
    WITH CHECK (public.can_see_contact(contacts.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY csv_imports_insert ON public.csv_imports FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (imported_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY csv_imports_select ON public.csv_imports FOR SELECT TO public
    USING ((( SELECT public.has_permission(csv_imports.workspace_id, 'contacts.import'::text) AS has_permission) OR (public.is_workspace_member(workspace_id) AND (imported_by = auth.uid()))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY csv_imports_update ON public.csv_imports FOR UPDATE TO public
    USING ((public.is_workspace_member(workspace_id) AND (imported_by = auth.uid())))
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (imported_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY custom_field_definitions_insert ON public.custom_field_definitions FOR INSERT TO public
    WITH CHECK (( SELECT public.has_permission(custom_field_definitions.workspace_id, 'custom_fields.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY custom_field_definitions_select ON public.custom_field_definitions FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY custom_field_definitions_update ON public.custom_field_definitions FOR UPDATE TO public
    USING (( SELECT public.has_permission(custom_field_definitions.workspace_id, 'custom_fields.manage'::text) AS has_permission))
    WITH CHECK (( SELECT public.has_permission(custom_field_definitions.workspace_id, 'custom_fields.manage'::text) AS has_permission));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tags_delete ON public.tags FOR DELETE TO public
    USING ((public.is_workspace_member(workspace_id) AND (( SELECT public.has_permission(tags.workspace_id, 'tags.manage'::text) AS has_permission) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tags_insert ON public.tags FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (( SELECT public.has_permission(tags.workspace_id, 'tags.manage'::text) AS has_permission) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY tags_update ON public.tags FOR UPDATE TO public
    USING ((public.is_workspace_member(workspace_id) AND (( SELECT public.has_permission(tags.workspace_id, 'tags.manage'::text) AS has_permission) OR ((disables_agent = false) AND (assigns_to IS NULL)))))
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (( SELECT public.has_permission(tags.workspace_id, 'tags.manage'::text) AS has_permission) OR ((disables_agent = false) AND (assigns_to IS NULL)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users can view tags in their workspaces" ON public.tags FOR SELECT TO public
    USING (public.is_workspace_member(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
