-- ============================================================
-- 00274_notification_prefs.sql
--
-- Mi cuenta → Notificaciones: cada persona elige que avisos le llegan y por
-- donde (campana, email, WhatsApp).
--
--   1. `user_preferences.notification_prefs`: lo que la persona cambio. Lo
--      que no esta en el jsonb usa el valor por defecto del catalogo en
--      TypeScript (`lib/notifications/preferences.ts`): sumar un tipo de aviso
--      no necesita migracion. Forma: { "<evento>": { "bell": bool,
--      "email": bool, "whatsapp": bool } }, con cualquiera de las claves.
--   2. `workspaces.team_alerts_settings`: desde que WhatsApp del negocio se
--      mandan los avisos al equipo ({ "whatsapp_channel_id": uuid }). Lo
--      elige Owner/Admin en Ajustes → General.
--   3. `workspace_member_profiles` suma `avatar_path` (la foto de cada
--      persona, de `user_profiles`, 00273). Cambia el tipo de lo que
--      devuelve, asi que se borra y se vuelve a crear.
--   4. `private.enqueue_notification_delivery()`: la FUNCION del trigger que
--      encola la entrega por email y WhatsApp de cada aviso. El trigger en si
--      es la 00275, que se aplica DESPUES de desplegar el codigo que ejecuta
--      los jobs `notification_deliver` (si no, la cola los marcaria como
--      fallidos por tipo desconocido).
--
-- Los DEFAULT son literales: un DEFAULT se evalua con los permisos de quien
-- inserta y nunca puede llamar a una funcion de `private` (00248).
--
-- Aditiva: se aplica ANTES de desplegar el codigo.
--
-- Definicion vieja de workspace_member_profiles (00141), letra por letra,
-- para volver atras:
--   CREATE OR REPLACE FUNCTION public.workspace_member_profiles(p_workspace_id uuid)
--   RETURNS TABLE (user_id uuid, role text, role_id uuid, joined_at timestamptz, email text, full_name text, meta_name text)
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
--   AS $$
--     SELECT m.user_id, m.role::text, m.role_id, m.created_at, u.email::text,
--       u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'
--     FROM public.workspace_members m
--     LEFT JOIN auth.users u ON u.id = m.user_id
--     WHERE m.workspace_id = p_workspace_id;
--   $$;
--   COMMENT ON FUNCTION public.workspace_member_profiles(uuid) IS
--     'Miembros de un workspace con email y nombre (de auth.users) en una sola consulta. Solo service_role: reemplaza N llamadas a auth.admin.getUserById.';
--   REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO service_role;
--
-- Como volver atras (en este orden):
--   DROP TRIGGER IF EXISTS notifications_enqueue_delivery ON public.notifications;   (00275)
--   DROP FUNCTION IF EXISTS private.enqueue_notification_delivery();
--   DROP FUNCTION IF EXISTS public.workspace_member_profiles(uuid);  (y recrear la de arriba)
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS team_alerts_settings;
--   ALTER TABLE public.user_preferences DROP COLUMN IF EXISTS notification_prefs;
-- Riesgo: bajo. Dos columnas con default, una funcion que devuelve una
-- columna mas (los que la llaman leen por nombre) y una funcion sin trigger.
-- ============================================================

SET search_path = '';

-- 1. Preferencias de notificaciones por persona -------------------------------

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_notification_prefs_check') THEN
    ALTER TABLE public.user_preferences ADD CONSTRAINT user_preferences_notification_prefs_check
      CHECK (jsonb_typeof(notification_prefs) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.user_preferences.notification_prefs IS
  'Lo que la persona cambio de sus avisos: { evento: { bell, email, whatsapp } }. Lo que falta usa el valor por defecto de lib/notifications/preferences.ts.';

COMMENT ON TABLE public.user_preferences IS
  'Preferencias por persona, no por workspace: la zona horaria y que avisos le llegan y por donde.';

-- 2. Desde que WhatsApp se avisa al equipo -------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS team_alerts_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_team_alerts_settings_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_team_alerts_settings_check
      CHECK (jsonb_typeof(team_alerts_settings) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.team_alerts_settings IS
  'Avisos al equipo: { whatsapp_channel_id } = el canal de WhatsApp (Evolution) desde el que se mandan. Sin canal, nadie recibe avisos por WhatsApp.';

-- 3. Los miembros con su foto --------------------------------------------------

DROP FUNCTION IF EXISTS public.workspace_member_profiles(uuid);

CREATE FUNCTION public.workspace_member_profiles(p_workspace_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  role_id uuid,
  joined_at timestamptz,
  email text,
  full_name text,
  meta_name text,
  avatar_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.workspace_member_profiles(uuid) IS
  'Miembros de un workspace con email, nombre (de auth.users) y foto (de user_profiles) en una sola consulta. Solo service_role.';

REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO service_role;

-- 4. La funcion que encola la entrega (el trigger es la 00275) ------------------

CREATE OR REPLACE FUNCTION private.enqueue_notification_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Un aviso NUNCA deja de guardarse por esto: si no se puede encolar, queda
  -- solo en la campana y se avisa en el log.
  BEGIN
    INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
    VALUES ('notification_deliver', jsonb_build_object('notification_id', NEW.id), now(),
            'notification_deliver:' || NEW.id::text)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_notification_delivery: no pude encolar el aviso %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_notification_delivery() FROM PUBLIC, anon, authenticated;
