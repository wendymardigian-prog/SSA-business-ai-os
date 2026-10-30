-- ============================================================
-- 00273_user_profiles.sql
--
-- Mi cuenta: los datos personales de cada persona del equipo.
--
-- Hasta ahora una persona no tenia donde guardar lo suyo: el nombre vive en
-- `auth.users.user_metadata.full_name` (y ahi sigue: lo leen todos, ver
-- `workspace_member_profiles`), y no habia foto ni telefono. Esta tabla guarda
-- la foto, el telefono y el WhatsApp de la PERSONA, iguales en todos los
-- negocios de la instalacion (igual que `user_preferences`, 00121).
--
-- El WhatsApp se usa SOLO para mandarle a la persona los avisos que ella
-- elija en Mi cuenta → Notificaciones (00274/00275). Nadie mas lo lee desde el
-- navegador: la RLS deja ver, crear y editar unicamente la fila propia, y el
-- servidor lo lee con el cliente de servicio para mandar un aviso.
--
-- Bucket `user-avatars`: publico para leer (la foto se muestra en toda la app
-- y en la pagina publica de reserva), SIN policies de escritura: sube y borra
-- el service role desde la Server Action, despues de validar el archivo por
-- sus bytes. Es el mismo criterio que `chat-media` (00102). El bucket
-- `avatars` (00095) no sirve para esto: su policy deja escribir a cualquier
-- miembro en la carpeta de cualquiera.
--
-- Aditiva: se aplica ANTES de desplegar el codigo (la pagina Mi cuenta la lee).
--
-- Como volver atras:
--   DROP TABLE IF EXISTS public.user_profiles;
--   DELETE FROM storage.objects WHERE bucket_id = 'user-avatars';  (desde el panel o la API de Storage)
--   DELETE FROM storage.buckets WHERE id = 'user-avatars';
-- Riesgo: bajo. Tabla y bucket nuevos; no cambia nada existente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Ruta dentro del bucket `user-avatars` (<user_id>/<archivo>), nunca una URL.
  avatar_path            text,
  -- Telefono con codigo de pais, normalizado (+5491122334455).
  phone                  text,
  -- El WhatsApp, si es otro numero. Con `whatsapp_same_as_phone` se usa `phone`.
  whatsapp_phone         text,
  whatsapp_same_as_phone boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_phone_check') THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_phone_check
      CHECK (phone IS NULL OR phone ~ '^\+[0-9]{8,15}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_whatsapp_phone_check') THEN
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_whatsapp_phone_check
      CHECK (whatsapp_phone IS NULL OR whatsapp_phone ~ '^\+[0-9]{8,15}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_avatar_path_check') THEN
    -- La foto vive SIEMPRE en la carpeta de su persona.
    ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_avatar_path_check
      CHECK (avatar_path IS NULL OR avatar_path LIKE user_id::text || '/%');
  END IF;
END $$;

COMMENT ON TABLE public.user_profiles IS
  'Datos personales de cada persona del equipo (foto, telefono, WhatsApp), iguales en todos los negocios. El nombre sigue en auth.users.user_metadata.full_name.';
COMMENT ON COLUMN public.user_profiles.whatsapp_phone IS
  'WhatsApp para los avisos que la persona elija. Solo se usa si whatsapp_same_as_phone es false; si no, vale phone.';

DROP TRIGGER IF EXISTS set_updated_at ON public.user_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Cada uno ve, crea y edita UNICAMENTE su propia fila (mismo patron que
-- user_preferences, 00121/00124). Sin policy de DELETE: se borra en cascada
-- con el usuario.
DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_profiles_insert ON public.user_profiles;
CREATE POLICY user_profiles_insert ON public.user_profiles
  FOR INSERT WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_profiles_update ON public.user_profiles;
CREATE POLICY user_profiles_update ON public.user_profiles
  FOR UPDATE USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

REVOKE ALL ON public.user_profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

-- ------------------------------------------------------------
-- Bucket user-avatars
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-avatars', 'user-avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'user-avatars';

-- Sin policies sobre storage.objects a proposito: leer es publico por el
-- bucket, y escribir o borrar solo lo hace el service role.
