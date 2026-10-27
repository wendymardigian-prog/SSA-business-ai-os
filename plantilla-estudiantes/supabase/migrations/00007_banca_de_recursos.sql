-- ============================================================================
-- Banca de recursos
--
-- La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces que el
-- equipo y el agente mandan por el chat. Una sola tabla; el tipo (kind) decide que
-- columnas aplican y la base rechaza una forma invalida.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.response_assets (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  shortcut text,
  description text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  content text,
  storage_path text,
  mime_type text,
  duration_seconds integer,
  size_bytes bigint,
  transcript text,
  transcript_status text DEFAULT 'none'::text NOT NULL,
  transcript_error text,
  transcript_source text DEFAULT 'auto'::text NOT NULL,
  transcript_started_at timestamp with time zone,
  source text,
  agent_enabled boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  url text,
  link_kind text,
  preview_path text,
  caption text,
  usage_count integer DEFAULT 0 NOT NULL,
  last_used_at timestamp with time zone,
  CONSTRAINT response_assets_pkey PRIMARY KEY (id),
  CONSTRAINT response_assets_caption_kinds CHECK (((caption IS NULL) OR ((kind = ANY (ARRAY['image'::text, 'video'::text, 'file'::text])) AND (length(btrim(caption)) > 0)))),
  CONSTRAINT response_assets_description_not_blank CHECK (((description IS NULL) OR (length(btrim(description)) > 0))),
  CONSTRAINT response_assets_duration_kinds CHECK (((duration_seconds IS NULL) OR (kind = ANY (ARRAY['audio'::text, 'video'::text])))),
  CONSTRAINT response_assets_file_shape CHECK (((kind <> ALL (ARRAY['audio'::text, 'video'::text, 'image'::text, 'file'::text])) OR ((storage_path IS NOT NULL) AND (length(btrim(storage_path)) > 0) AND (mime_type IS NOT NULL) AND (content IS NULL) AND (description IS NOT NULL) AND (source IS NOT NULL) AND (url IS NULL) AND (link_kind IS NULL)))),
  CONSTRAINT response_assets_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'audio'::text, 'video'::text, 'image'::text, 'file'::text, 'link'::text]))),
  CONSTRAINT response_assets_link_kind_check CHECK (((link_kind IS NULL) OR ((kind = 'link'::text) AND (link_kind = ANY (ARRAY['video'::text, 'imagen'::text, 'testimonio'::text, 'articulo'::text, 'landing'::text, 'formulario'::text, 'agenda'::text, 'pago'::text, 'otro'::text]))))),
  CONSTRAINT response_assets_link_shape CHECK (((kind <> 'link'::text) OR ((url IS NOT NULL) AND (link_kind IS NOT NULL) AND (description IS NOT NULL) AND (content IS NULL) AND (storage_path IS NULL) AND (mime_type IS NULL) AND (duration_seconds IS NULL) AND (size_bytes IS NULL) AND (source IS NULL) AND (caption IS NULL) AND (preview_path IS NULL)))),
  CONSTRAINT response_assets_name_not_blank CHECK ((length(btrim(name)) > 0)),
  CONSTRAINT response_assets_no_transcript CHECK (((kind <> ALL (ARRAY['text'::text, 'image'::text, 'file'::text, 'link'::text])) OR ((transcript IS NULL) AND (transcript_status = 'none'::text) AND (transcript_error IS NULL) AND (transcript_started_at IS NULL)))),
  CONSTRAINT response_assets_preview_path_video_only CHECK (((preview_path IS NULL) OR ((kind = 'video'::text) AND (length(btrim(preview_path)) > 0)))),
  CONSTRAINT response_assets_recorded_audio_only CHECK (((source IS NULL) OR (kind = 'audio'::text) OR (source = 'uploaded'::text))),
  CONSTRAINT response_assets_shortcut_format CHECK (((shortcut IS NULL) OR (shortcut ~ '^/[a-z0-9][a-z0-9_-]{0,29}$'::text))),
  CONSTRAINT response_assets_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['recorded'::text, 'uploaded'::text, 'synthesized'::text])))),
  CONSTRAINT response_assets_tags_sane CHECK (((array_position(tags, NULL::text) IS NULL) AND (cardinality(tags) <= 20))),
  CONSTRAINT response_assets_text_shape CHECK (((kind <> 'text'::text) OR ((content IS NOT NULL) AND (length(btrim(content)) > 0) AND (storage_path IS NULL) AND (mime_type IS NULL) AND (duration_seconds IS NULL) AND (size_bytes IS NULL) AND (source IS NULL) AND (url IS NULL) AND (link_kind IS NULL) AND (caption IS NULL) AND (preview_path IS NULL)))),
  CONSTRAINT response_assets_transcript_source_check CHECK ((transcript_source = ANY (ARRAY['auto'::text, 'manual'::text]))),
  CONSTRAINT response_assets_transcript_status_check CHECK ((transcript_status = ANY (ARRAY['none'::text, 'pending'::text, 'ready'::text, 'failed'::text]))),
  CONSTRAINT response_assets_url_http CHECK (((url IS NULL) OR (url ~* '^https?://[^[:space:]]+$'::text))),
  CONSTRAINT response_assets_usage_count_positive CHECK ((usage_count >= 0)),
  CONSTRAINT response_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT response_assets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.response_assets ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.response_assets IS 'La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces en una sola tabla, distinguidos por `kind`. El atajo es unico entre todos los tipos.';
COMMENT ON COLUMN public.response_assets.kind IS 'text | audio | video | image | file | link. Decide que columnas aplican (ver los CHECK _text_shape, _file_shape y _link_shape). No se cambia despues de crear.';
COMMENT ON COLUMN public.response_assets.description IS 'Obligatoria para todo menos un texto. Es lo que lee el agente para decidir CUANDO usar este recurso, y lo que lee una persona para saber que es sin abrirlo. Nunca se manda.';
COMMENT ON COLUMN public.response_assets.tags IS 'Etiquetas libres. Se buscan desde el picker "/" igual que el nombre (indice GIN).';
COMMENT ON COLUMN public.response_assets.transcript_source IS 'auto: la escribio el job de transcripcion. manual: alguien la corrigio a mano, y un reintento automatico no la pisa.';
COMMENT ON COLUMN public.response_assets.transcript_started_at IS 'Cuando se reclamo la transcripcion. La usa el reaper de pendientes colgados (10 min).';
COMMENT ON COLUMN public.response_assets.agent_enabled IS 'El interruptor del agente, para los seis tipos. Un audio, o un video con voz, ademas necesita la transcripcion lista.';
COMMENT ON COLUMN public.response_assets.url IS 'Solo enlaces: la direccion, http o https.';
COMMENT ON COLUMN public.response_assets.link_kind IS 'Solo enlaces: video | imagen | testimonio | articulo | landing | formulario | agenda | pago | otro.';
COMMENT ON COLUMN public.response_assets.preview_path IS 'Solo videos: la miniatura del primer fotograma en chat-media/<ws>/library/. Opcional: si el navegador no la pudo sacar, la pantalla muestra el icono del tipo.';
COMMENT ON COLUMN public.response_assets.caption IS 'image | video | file: el texto que acompaña al archivo cuando se manda. Lo ve el contacto.';
COMMENT ON COLUMN public.response_assets.usage_count IS 'Cuantas veces se mando. Lo suma touch_response_asset.';
COMMENT ON COLUMN public.response_assets.last_used_at IS 'Cuando se mando por ultima vez. Ordena el widget del chat.';

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_response_asset(p_asset_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.response_assets
     SET usage_count = usage_count + 1,
         last_used_at = now()
   WHERE id = p_asset_id
     AND deleted_at IS NULL
     AND (
       auth.role() = 'service_role'
       OR public.is_workspace_member(workspace_id)
     );
END;
$function$;
COMMENT ON FUNCTION public.touch_response_asset(p_asset_id uuid) IS 'Suma 1 a usage_count y pone last_used_at = now() en un recurso del workspace de quien llama (o en cualquiera, si llama el servidor). Si no corresponde, no hace nada y no lo dice.';
REVOKE ALL ON FUNCTION public.touch_response_asset(p_asset_id uuid) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_response_assets_agent_enabled ON public.response_assets USING btree (workspace_id) WHERE ((deleted_at IS NULL) AND (agent_enabled = true) AND (is_active = true));

CREATE INDEX IF NOT EXISTS idx_response_assets_deleted_at ON public.response_assets USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_response_assets_kind ON public.response_assets USING btree (workspace_id, kind, name) WHERE (deleted_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_response_assets_last_used ON public.response_assets USING btree (workspace_id, last_used_at DESC NULLS LAST) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_response_assets_shortcut ON public.response_assets USING btree (workspace_id, shortcut) WHERE ((deleted_at IS NULL) AND (shortcut IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_response_assets_tags ON public.response_assets USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_response_assets_workspace ON public.response_assets USING btree (workspace_id, name) WHERE (deleted_at IS NULL);

-- ----------------------------------------------------------------------------
-- Disparadores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE TRIGGER set_updated_at BEFORE UPDATE ON public.response_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY response_assets_delete ON public.response_assets FOR DELETE TO public
    USING ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'templates.manage'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY response_assets_insert ON public.response_assets FOR INSERT TO public
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'templates.manage'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY response_assets_select ON public.response_assets FOR SELECT TO public
    USING (((deleted_at IS NULL) AND public.is_workspace_member(workspace_id)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY response_assets_update ON public.response_assets FOR UPDATE TO public
    USING ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'templates.manage'::text)))
    WITH CHECK ((public.is_workspace_admin(workspace_id) OR public.has_permission(workspace_id, 'templates.manage'::text)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
