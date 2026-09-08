-- ============================================================
-- MIGRACION 00022 — MODELO DE CONTACTO EXTENDIDO (F9 + F10)
-- ============================================================
-- ZernFlow trae un contacto minimo: display_name, email, avatar_url,
-- is_subscribed, last_interaction_at y metadata. Para un CRM de servicios
-- digitales falta todo lo demas: telefono, redes, asignaciones, seguimiento,
-- atribucion y borrado logico.
--
-- Tres decisiones que conviene tener a la vista:
--
-- 1. Los campos de identidad (telefono, email secundario, usernames de red)
--    son los que usa la deduplicacion cross-canal de la migracion 00025. Por
--    eso llevan indice: se consultan en cada mensaje entrante.
-- 2. setter_id y vendedor_id son los que enciende el scope de leads en la
--    migracion 00024. Los TODO "BLOQUE 3" de la 00018 apuntan a estas columnas.
-- 3. Hay campos que hoy quedan vacios a proposito (ai_conversation_summary,
--    next_followup_date, attribution): se agregan ahora para no volver a
--    migrar la tabla cuando lleguen las fases que los usan.
--
-- Esta migracion NO toca policies ni funciones: solo agrega columnas e
-- indices. can_see_contact se reescribe en la 00024, despues de que estas
-- columnas existan.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Datos de contacto
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS secondary_email text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS country text;

COMMENT ON COLUMN public.contacts.phone IS
  'Telefono principal, normalizado como "+<digitos>" por lib/phone.ts. Clave de deduplicacion cross-canal.';

-- ------------------------------------------------------------
-- 2. Identidades por plataforma
-- ------------------------------------------------------------
-- Una columna por red en vez de un jsonb: se filtra y se indexa directo, que
-- es lo que necesita el matching de cada mensaje entrante.
-- tiktok/youtube/linkedin quedan vacias hasta la Etapa 2; se crean ahora para
-- que el modelo no cambie cuando esos canales lleguen.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS instagram_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS tiktok_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS youtube_channel_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS linkedin_profile_url text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS whatsapp_phone text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS twitter_username text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS facebook_id text;

COMMENT ON COLUMN public.contacts.instagram_username IS
  'Usuario de Instagram sin la arroba, en minusculas. Lo normaliza lib/contacts/fields.ts.';
COMMENT ON COLUMN public.contacts.whatsapp_phone IS
  'Telefono de WhatsApp cuando difiere del principal. Mismo formato normalizado que phone.';

-- ------------------------------------------------------------
-- 3. Asignacion doble: setter y vendedor
-- ------------------------------------------------------------
-- Opcionales e independientes. ON DELETE SET NULL: si se borra el usuario, el
-- lead queda sin asignar, no se pierde.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS setter_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS vendedor_id uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contacts.setter_id IS
  'Quien contacta y califica. Junto con vendedor_id define el scope de leads (migracion 00024).';
COMMENT ON COLUMN public.contacts.vendedor_id IS
  'Quien cierra. Independiente de setter_id: un lead puede tener uno, los dos o ninguno.';

-- ------------------------------------------------------------
-- 4. Seguimiento, no contactar y temperatura
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS next_followup_date timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact_reason text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ai_conversation_summary text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_temperature text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contacts_lead_temperature_check'
  ) THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_lead_temperature_check
      CHECK (lead_temperature IS NULL OR lead_temperature IN ('cold', 'warm', 'hot'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.contacts.next_followup_date IS
  'Proximo seguimiento. Se llena a mano en Etapa 1; es la base del agendamiento de Etapa 4.';
COMMENT ON COLUMN public.contacts.ai_conversation_summary IS
  'Memoria acumulativa del agente IA. Queda vacio hasta la Fase 3; se crea ahora para no volver a migrar.';

-- ------------------------------------------------------------
-- 5. Atribucion (F10) — jsonb, sin tabla aparte
-- ------------------------------------------------------------
-- Es 1:1 con el contacto, asi que una tabla separada solo agregaria un JOIN.
-- first_click se escribe una sola vez, last_click se pisa en cada interaccion
-- atribuible. La logica de merge vive en lib/contacts/attribution.ts.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.contacts.attribution IS
  '{ "first_click": {...}, "last_click": {...} } con UTMs, fbclid, gclid, ad_id, campaign_id, referrer_url, landing_page y captured_at. first_click no se pisa nunca.';

-- ------------------------------------------------------------
-- 6. Borrado logico (F15)
-- ------------------------------------------------------------
-- Nada se borra de verdad: se marca y un cron diario purga a los 30 dias
-- (migracion 00025). Las policies de SELECT lo filtran en la 00024.

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.contacts.deleted_at IS
  'Borrado logico. Retencion de 30 dias, despues lo purga /api/cron/purge-deleted.';

-- ------------------------------------------------------------
-- 7. Indices
-- ------------------------------------------------------------
-- Los de identidad son parciales (WHERE ... IS NOT NULL): la mayoria de los
-- contactos no tiene todas las redes cargadas, asi que el indice queda chico.
-- Van compuestos con workspace_id porque el matching siempre busca dentro de
-- un workspace.

CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON public.contacts(workspace_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp_phone
  ON public.contacts(workspace_id, whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON public.contacts(workspace_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_secondary_email
  ON public.contacts(workspace_id, lower(secondary_email)) WHERE secondary_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_instagram
  ON public.contacts(workspace_id, instagram_username) WHERE instagram_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tiktok
  ON public.contacts(workspace_id, tiktok_username) WHERE tiktok_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_twitter
  ON public.contacts(workspace_id, twitter_username) WHERE twitter_username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_facebook
  ON public.contacts(workspace_id, facebook_id) WHERE facebook_id IS NOT NULL;

-- Filtros de la lista de contactos.
CREATE INDEX IF NOT EXISTS idx_contacts_setter
  ON public.contacts(workspace_id, setter_id) WHERE setter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_vendedor
  ON public.contacts(workspace_id, vendedor_id) WHERE vendedor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_temperature
  ON public.contacts(workspace_id, lead_temperature) WHERE lead_temperature IS NOT NULL;

-- Todos los listados filtran deleted_at IS NULL, asi que el indice parcial
-- inverso (los vivos) es el que sirve; el cron de purga usa el otro.
CREATE INDEX IF NOT EXISTS idx_contacts_alive
  ON public.contacts(workspace_id, last_interaction_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at
  ON public.contacts(deleted_at) WHERE deleted_at IS NOT NULL;
