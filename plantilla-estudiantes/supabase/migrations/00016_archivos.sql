-- ============================================================================
-- Archivos
--
-- Las carpetas de archivos (buckets de Storage) y sus reglas de acceso. En las
-- privadas, el primer segmento de la ruta de cada archivo es el workspace: es lo unico
-- que miran las reglas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Carpetas de archivos
-- ----------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ad-creatives', 'ad-creatives', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('brand-assets', 'brand-assets', true, 524288, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-media', 'chat-media', false, 26214400, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/amr', 'audio/flac', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'text/csv', 'application/zip', 'application/octet-stream'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('content-media', 'content-media', false, 1073741824, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('email-attachments', 'email-attachments', false, 26214400, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('knowledge', 'knowledge', false, 26214400, ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY ad_creatives_select ON storage.objects FOR SELECT TO public
    USING (((bucket_id = 'ad-creatives'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid) AND public.has_permission(((storage.foldername(name))[1])::uuid, 'dashboards.ads.view'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO public
    USING (((bucket_id = 'avatars'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO public
    WITH CHECK (((bucket_id = 'avatars'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY avatars_select ON storage.objects FOR SELECT TO public
    USING ((bucket_id = 'avatars'::text));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO public
    USING (((bucket_id = 'avatars'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY chat_media_select ON storage.objects FOR SELECT TO public
    USING (((bucket_id = 'chat-media'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_media_delete ON storage.objects FOR DELETE TO public
    USING (((bucket_id = 'content-media'::text) AND public.is_workspace_admin(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_media_insert ON storage.objects FOR INSERT TO public
    WITH CHECK (((bucket_id = 'content-media'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_media_select ON storage.objects FOR SELECT TO public
    USING (((bucket_id = 'content-media'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY content_media_update ON storage.objects FOR UPDATE TO public
    USING (((bucket_id = 'content-media'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY email_attachments_select ON storage.objects FOR SELECT TO public
    USING (((bucket_id = 'email-attachments'::text) AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
