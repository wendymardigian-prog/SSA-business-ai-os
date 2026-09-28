-- ============================================================================
-- 00095 — Perfil de agenda y calendarios (Etapa 4, Bloque 1, F1)
-- ============================================================================
-- Lo que suma:
--
--  1. scheduling_profiles: una por persona y workspace. El "usuario" que va en
--     los links de sus eventos, su zona horaria y su formato de hora.
--  2. calendars: los calendarios de cada cuenta de Google conectada por una
--     persona. Cuales revisan conflictos y cual es el destino por defecto.
--  3. oauth_connections: el proveedor `google_calendar` (por persona, varias
--     cuentas), y el unico pasa a dos indices parciales sin expresiones:
--       - una conexion de WORKSPACE por proveedor (user_id NULL), como hoy;
--       - por PERSONA, una por cuenta externa (user_id + external_account_id).
--     El indice viejo (con coalesce) se borra en esta misma migracion. No toca
--     datos: la tabla esta vacia y, aunque no lo estuviera, las filas de hoy
--     cumplen los dos indices nuevos.
--     Ademas, cada persona puede LEER sus propias conexiones (antes solo los
--     admins leian la tabla).
--  4. contacts.timezone: la zona IANA del contacto, que la agenda aprende del
--     invitado y el agente de chat confirma.
--  5. Bucket `avatars` para la foto del perfil de agenda: publico para leer
--     (se muestra en la pagina publica de reserva, sin sesion), escritura
--     solo de miembros del workspace en su carpeta.
--  6. scheduling_can_manage(ws, user): la regla de "es la persona dueña o
--     tiene scheduling.manage_others", que usan las policies de este modulo.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 0. La regla de "puede administrar la agenda de esta persona"
-- ------------------------------------------------------------
-- Admin, o la propia persona, o alguien con `scheduling.manage_others`.
-- `has_permission` devuelve false para el rol Member de sistema (sus permisos
-- viven en TypeScript, no en la fila), y eso es lo que corresponde: un Member
-- de sistema no tiene manage_others.

CREATE OR REPLACE FUNCTION public.scheduling_can_manage(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(p_workspace_id)
     AND (
       auth.uid() = p_user_id
       OR public.is_workspace_admin(p_workspace_id)
       OR public.has_permission(p_workspace_id, 'scheduling.manage_others')
     );
$$;

REVOKE ALL ON FUNCTION public.scheduling_can_manage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduling_can_manage(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1. oauth_connections: proveedor google_calendar y unicos por persona
-- ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_connections_provider_check') THEN
    ALTER TABLE public.oauth_connections DROP CONSTRAINT oauth_connections_provider_check;
  END IF;
  ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
    CHECK (provider IN ('google', 'linkedin', 'threads', 'google_calendar'));
END $$;

-- Una conexion de workspace por proveedor (las de YouTube, LinkedIn, Threads).
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_workspace_provider
  ON public.oauth_connections (workspace_id, provider)
  WHERE user_id IS NULL;

-- Por persona: una fila por cuenta externa. Reconectar la misma cuenta
-- actualiza; una cuenta distinta suma una fila.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_user_account
  ON public.oauth_connections (workspace_id, provider, user_id, external_account_id)
  WHERE user_id IS NOT NULL;

DROP INDEX IF EXISTS public.uq_oauth_connections_ws_provider_user;

CREATE INDEX IF NOT EXISTS idx_oauth_connections_user
  ON public.oauth_connections (workspace_id, user_id, provider)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.oauth_connections.user_id IS
  'NULL = la conexion es del workspace (una por proveedor). Con valor = de esa persona (google_calendar): una fila por cuenta externa.';

-- Cada persona ve sus propias conexiones (sus cuentas de Google Calendar).
-- Los admins siguen viendo todas por la policy de la 00082.
DROP POLICY IF EXISTS "oauth_connections_select_own" ON public.oauth_connections;
CREATE POLICY "oauth_connections_select_own" ON public.oauth_connections
  FOR SELECT USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- ------------------------------------------------------------
-- 2. scheduling_profiles
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.scheduling_profiles (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id                         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Va en los links: /calendario/<username>/<evento>. Minusculas, numeros y guiones.
  username                        text NOT NULL,
  display_name                    text NOT NULL,
  avatar_url                      text,
  timezone                        text NOT NULL,
  time_format                     text NOT NULL DEFAULT '24h',
  welcome_message                 text,
  -- FK a availability_schedules se agrega en la 00096 (la tabla no existe todavia).
  default_schedule_id             uuid,
  default_destination_calendar_id uuid,
  is_active                       boolean NOT NULL DEFAULT true,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scheduling_profiles IS
  'El perfil de agenda de cada persona: usuario de los links, zona horaria, formato de hora, horario y calendario destino por defecto.';
COMMENT ON COLUMN public.scheduling_profiles.username IS
  'Slug de 3 a 40 caracteres, unico en el workspace sin distinguir mayusculas. Palabras reservadas: agenda, embed, api, equipo, admin.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_username_check') THEN
    ALTER TABLE public.scheduling_profiles ADD CONSTRAINT scheduling_profiles_username_check
      CHECK (username ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_time_format_check') THEN
    ALTER TABLE public.scheduling_profiles ADD CONSTRAINT scheduling_profiles_time_format_check
      CHECK (time_format IN ('12h', '24h'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_user
  ON public.scheduling_profiles (workspace_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduling_profiles_ws_username
  ON public.scheduling_profiles (workspace_id, lower(username));

DROP TRIGGER IF EXISTS set_updated_at ON public.scheduling_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.scheduling_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.scheduling_profiles ENABLE ROW LEVEL SECURITY;

-- Lo leen todos los miembros: hace falta para elegir anfitriones y para
-- mostrar de quien es cada agenda.
DROP POLICY IF EXISTS "scheduling_profiles_select" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_select" ON public.scheduling_profiles
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- Escribe la persona dueña o quien administra agendas ajenas. Sin DELETE: se
-- desactiva.
DROP POLICY IF EXISTS "scheduling_profiles_insert" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_insert" ON public.scheduling_profiles
  FOR INSERT WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

DROP POLICY IF EXISTS "scheduling_profiles_update" ON public.scheduling_profiles;
CREATE POLICY "scheduling_profiles_update" ON public.scheduling_profiles
  FOR UPDATE USING (public.scheduling_can_manage(workspace_id, user_id))
  WITH CHECK (public.scheduling_can_manage(workspace_id, user_id));

-- ------------------------------------------------------------
-- 3. calendars
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendars (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id           uuid NOT NULL REFERENCES public.oauth_connections(id) ON DELETE CASCADE,
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_calendar_id    text NOT NULL,
  name                    text NOT NULL,
  color                   text,
  access_role             text NOT NULL,
  is_primary              boolean NOT NULL DEFAULT false,
  check_conflicts         boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  -- Reservadas para la sincronizacion push (fase futura). Sin uso hoy.
  push_channel_id         text,
  push_channel_expires_at timestamptz,
  sync_token              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.calendars IS
  'Los calendarios de cada cuenta de Google conectada por una persona. check_conflicts = se leen sus horarios ocupados; is_active = sigue existiendo en la cuenta.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendars_access_role_check') THEN
    ALTER TABLE public.calendars ADD CONSTRAINT calendars_access_role_check
      CHECK (access_role IN ('owner', 'writer', 'reader', 'freeBusyReader'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendars_connection_external
  ON public.calendars (connection_id, external_calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendars_ws_user
  ON public.calendars (workspace_id, user_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at ON public.calendars;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calendars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;

-- Los ve la persona dueña (o quien administra agendas ajenas). Los titulos de
-- los eventos de Google nunca estan aca: solo el nombre del calendario.
DROP POLICY IF EXISTS "calendars_select" ON public.calendars;
CREATE POLICY "calendars_select" ON public.calendars
  FOR SELECT USING (public.scheduling_can_manage(workspace_id, user_id));

-- Insertar y borrar es del servidor (la sincronizacion con Google). La persona
-- solo cambia sus switches (check_conflicts).
DROP POLICY IF EXISTS "calendars_update_own" ON public.calendars;
CREATE POLICY "calendars_update_own" ON public.calendars
  FOR UPDATE USING (user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(workspace_id));

-- El destino por defecto del perfil apunta a un calendario (recien ahora que
-- la tabla existe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scheduling_profiles_default_destination_fk') THEN
    ALTER TABLE public.scheduling_profiles
      ADD CONSTRAINT scheduling_profiles_default_destination_fk
      FOREIGN KEY (default_destination_calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. contacts.timezone
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS timezone text;
COMMENT ON COLUMN public.contacts.timezone IS
  'Zona IANA del contacto (ej. America/Mexico_City). La aprende la agenda del invitado; el agente de chat la confirma antes de proponer horarios.';

-- ------------------------------------------------------------
-- 5. Bucket avatars
-- ------------------------------------------------------------
-- Publico para leer: la foto se muestra en la pagina publica de reserva, que
-- no tiene sesion. Escribir es de miembros del workspace, en su carpeta
-- (<workspace_id>/<user_id>/<archivo>).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'avatars';

DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
