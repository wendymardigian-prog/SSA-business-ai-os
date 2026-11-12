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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-avatars', 'user-avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_chat_media(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_parts text[];
  v_ws    uuid;
  v_conv  public.conversations;
  v_group uuid;
BEGIN
  IF p_name IS NULL THEN
    RETURN false;
  END IF;
  v_parts := string_to_array(p_name, '/');
  -- Un path invalido nunca hace fallar la consulta (un cast roto tumbaria el listado entero): no se lee.
  IF cardinality(v_parts) < 3 OR v_parts[1] !~* v_uuid THEN
    RETURN false;
  END IF;
  v_ws := v_parts[1]::uuid;

  IF NOT public.is_workspace_member(v_ws) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(v_ws) THEN
    RETURN true;
  END IF;

  -- Las carpetas compartidas del negocio: la banca de recursos y la biblioteca de stickers.
  IF cardinality(v_parts) = 3 AND v_parts[2] IN ('library', 'stickers') THEN
    RETURN true;
  END IF;

  -- Un grupo de WhatsApp: <ws>/groups/<grupo>/<archivo>.
  IF cardinality(v_parts) = 4 AND v_parts[2] = 'groups' AND v_parts[3] ~* v_uuid THEN
    v_group := v_parts[3]::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.whatsapp_groups g WHERE g.id = v_group AND g.workspace_id = v_ws) THEN
      RETURN false;
    END IF;
    RETURN COALESCE(public.can_see_whatsapp_group(v_group), false);
  END IF;

  -- Una conversacion: <ws>/<conversacion>/<archivo>.
  IF cardinality(v_parts) = 3 AND v_parts[2] ~* v_uuid THEN
    SELECT * INTO v_conv FROM public.conversations c WHERE c.id = v_parts[2]::uuid AND c.workspace_id = v_ws;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    RETURN COALESCE(public.can_see_conversation(v_conv), false);
  END IF;

  RETURN false;
END;
$function$;
COMMENT ON FUNCTION public.can_read_chat_media(p_name text) IS 'Lectura de un archivo de chat-media: Owner/Admin todo su workspace; un Member, lo de una conversacion que ve (can_see_conversation), un grupo que ve (can_see_whatsapp_group) o las carpetas compartidas library/ y stickers/. Nunca NULL.';
REVOKE ALL ON FUNCTION public.can_read_chat_media(p_name text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_read_email_attachment(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_parts text[];
  v_ws    uuid;
BEGIN
  IF p_name IS NULL THEN
    RETURN false;
  END IF;
  v_parts := string_to_array(p_name, '/');
  IF cardinality(v_parts) < 3 OR v_parts[1] !~* v_uuid THEN
    RETURN false;
  END IF;
  v_ws := v_parts[1]::uuid;

  IF NOT public.is_workspace_member(v_ws) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(v_ws) THEN
    RETURN true;
  END IF;

  -- <ws>/<id del email>/<n>-<nombre>: el mensaje que trajo ese email, en una conversacion que ve.
  IF cardinality(v_parts) <> 3 OR v_parts[2] = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.workspace_id = v_ws
      AND m.platform_message_id = v_parts[2]
      AND c.workspace_id = v_ws
      AND COALESCE(public.can_see_conversation(c), false)
  );
END;
$function$;
COMMENT ON FUNCTION public.can_read_email_attachment(p_name text) IS 'Lectura de un adjunto de email: Owner/Admin todo su workspace; un Member, solo los adjuntos de un email de una conversacion que ve (can_see_conversation). Nunca NULL.';
REVOKE ALL ON FUNCTION public.can_read_email_attachment(p_name text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_read_knowledge(p_workspace_id uuid, p_internal_only boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN COALESCE(p_internal_only, false) THEN COALESCE(public.has_permission(p_workspace_id, 'knowledge.edit'), false)
    ELSE COALESCE(
      public.has_permission(p_workspace_id, 'knowledge.view')
        OR public.has_permission(p_workspace_id, 'knowledge.edit')
        OR public.has_permission(p_workspace_id, 'agents.view'),
      false
    )
  END;
$function$;
COMMENT ON FUNCTION public.can_read_knowledge(p_workspace_id uuid, p_internal_only boolean) IS 'Quien lee un documento de Conocimiento: uno interno, solo knowledge.edit (Owner/Admin siempre); uno que no es interno, knowledge.view, knowledge.edit o agents.view. Nunca NULL.';
REVOKE ALL ON FUNCTION public.can_read_knowledge(p_workspace_id uuid, p_internal_only boolean) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY knowledge_base_select ON public.knowledge_base FOR SELECT TO authenticated
    USING (public.can_read_knowledge(workspace_id, internal_only));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY knowledge_chunks_select ON public.knowledge_chunks FOR SELECT TO authenticated
    USING ((EXISTS ( SELECT 1
   FROM public.knowledge_base kb
  WHERE ((kb.id = knowledge_chunks.document_id) AND (kb.workspace_id = knowledge_chunks.workspace_id) AND public.can_read_knowledge(kb.workspace_id, kb.internal_only)))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
  CREATE POLICY chat_media_select ON storage.objects FOR SELECT TO authenticated
    USING (((bucket_id = 'chat-media'::text) AND public.can_read_chat_media(name)));
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
  CREATE POLICY email_attachments_select ON storage.objects FOR SELECT TO authenticated
    USING (((bucket_id = 'email-attachments'::text) AND public.can_read_email_attachment(name)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
