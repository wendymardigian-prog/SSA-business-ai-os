-- ============================================================
-- MIGRACION 00131 — LA BANCA DE RECURSOS PASA DE DOS TIPOS A SEIS
-- ============================================================
-- Plano: requerimientos-banca-recursos-v2.md (v2.1), §2 y F1. El plano la
-- numeraba 00125; esa numeracion ya estaba ocupada (00125-00130 aplicadas
-- antes de esta corrida), asi que es la 00131 con el contenido aprobado.
--
-- Que hace:
--   1. `kind` acepta text | audio | video | image | file | link.
--   2. Seis columnas nuevas, todas opcionales: url, link_kind, preview_path,
--      caption, usage_count (default 0) y last_used_at.
--   3. Reemplaza las reglas de forma de 00105 por unas que cubren los seis
--      tipos. Conserva TODAS las exigencias que ya habia (contenido no en
--      blanco, un texto sin mime/duracion/peso/source, un archivo con source)
--      y suma las nuevas.
--   4. Las tres policies de escritura pasan a aceptar, ademas de Owner/Admin,
--      a un rol personalizado con `templates.manage` (mismo patron que 00097).
--   5. Un indice para el orden por defecto del widget (los mas usados).
--
-- Riesgo: la tabla tenia 0 filas al escribir esta migracion (7 y 8/10/2026).
-- Cambiar reglas de una tabla vacia no invalida ningun dato. Y el codigo viejo
-- sigue funcionando contra la base nueva: los dos tipos que conocia siguen
-- siendo validos con la misma forma, y todo lo nuevo es opcional.
--
-- ------------------------------------------------------------
-- COMO VOLVER ATRAS (copia letra por letra de lo que esta migracion reemplaza,
-- tomado de 00105_response_assets.sql)
-- ------------------------------------------------------------
-- Los cuatro CHECK de tipo y forma originales:
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
--     CHECK (kind IN ('text', 'audio'));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
--     CHECK (kind <> 'text' OR (
--       content IS NOT NULL AND length(btrim(content)) > 0
--       AND storage_path IS NULL
--       AND mime_type IS NULL
--       AND duration_seconds IS NULL
--       AND size_bytes IS NULL
--       AND source IS NULL
--     ));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_no_transcript
--     CHECK (kind <> 'text' OR (
--       transcript IS NULL
--       AND transcript_status = 'none'
--       AND transcript_error IS NULL
--       AND transcript_started_at IS NULL
--     ));
--
--   ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_audio_shape
--     CHECK (kind <> 'audio' OR (
--       storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
--       AND mime_type IS NOT NULL
--       AND content IS NULL
--       AND description IS NOT NULL
--       AND source IS NOT NULL
--     ));
--
-- Las tres policies de escritura originales:
--
--   CREATE POLICY "response_assets_insert" ON public.response_assets
--     FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));
--
--   CREATE POLICY "response_assets_update" ON public.response_assets
--     FOR UPDATE USING (public.is_workspace_admin(workspace_id))
--     WITH CHECK (public.is_workspace_admin(workspace_id));
--
--   CREATE POLICY "response_assets_delete" ON public.response_assets
--     FOR DELETE USING (public.is_workspace_admin(workspace_id));
--
-- Para revertir: borrar las filas de los tipos nuevos (si las hubiera),
-- DROP de los CHECK nuevos (response_assets_kind_check, _text_shape,
-- _no_transcript, _file_shape, _link_shape, _link_kind_check, _caption_kinds,
-- _preview_path_video_only, _url_http, _duration_kinds, _recorded_audio_only,
-- _usage_count_positive), restaurar los cuatro de arriba y las tres policies,
-- DROP INDEX idx_response_assets_last_used, y DROP COLUMN de url, link_kind,
-- preview_path, caption, usage_count y last_used_at.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas nuevas
-- ------------------------------------------------------------

-- Solo kind='link': la direccion. No va en storage_path porque esa columna es
-- la que usa el bucket para buscar archivos, y la limpieza intentaria borrarla.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS url text;

-- Solo kind='link': que clase de enlace es. Lista cerrada (ver el CHECK) para
-- que el filtro pueda agrupar sin terminar con "testimonio" y "Testimonios".
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS link_kind text;

-- Solo kind='video': la miniatura (un jpg en chat-media/<ws>/library/), para
-- que una lista de diez videos no baje diez videos.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS preview_path text;

-- image | video | file: el texto que ve el CONTACTO al recibirlo. No es la
-- descripcion: la descripcion es para encontrarlo (y para el agente).
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS caption text;

-- Cuantas veces se mando y cuando fue la ultima. Las escribe solo
-- touch_response_asset (00132): un Member no tiene escritura sobre la tabla.
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.response_assets ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- ------------------------------------------------------------
-- 2. Reglas de forma
-- ------------------------------------------------------------
-- Mismo estilo que 00105: una regla por constraint, con nombre propio, escrita
-- `kind <> 'x' OR (...)` para que el error de Postgres nombre el tipo que
-- fallo. DROP + ADD es idempotente: correrla dos veces deja lo mismo.

DO $$
BEGIN
  -- Los cuatro que se reemplazan (ver la cabecera).
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_kind_check;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_text_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_text_no_transcript;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_audio_shape;

  -- Los nuevos, por si se corre dos veces.
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_no_transcript;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_file_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_link_shape;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_link_kind_check;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_caption_kinds;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_preview_path_video_only;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_url_http;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_duration_kinds;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_recorded_audio_only;
  ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_usage_count_positive;

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_kind_check
    CHECK (kind IN ('text', 'audio', 'video', 'image', 'file', 'link'));

  -- Un texto: contenido si; ni archivo, ni enlace, ni caption, ni miniatura.
  -- Las seis primeras condiciones son las de 00105 tal cual.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_text_shape
    CHECK (kind <> 'text' OR (
      content IS NOT NULL AND length(btrim(content)) > 0
      AND storage_path IS NULL
      AND mime_type IS NULL
      AND duration_seconds IS NULL
      AND size_bytes IS NULL
      AND source IS NULL
      AND url IS NULL
      AND link_kind IS NULL
      AND caption IS NULL
      AND preview_path IS NULL
    ));

  -- Lo que no se transcribe nunca no puede parecer a medio transcribir. Era
  -- solo para el texto; ahora vale para los cuatro tipos sin voz. Un video SI
  -- puede quedar en 'none': es un video sin voz, que no se encola.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_no_transcript
    CHECK (kind NOT IN ('text', 'image', 'file', 'link') OR (
      transcript IS NULL
      AND transcript_status = 'none'
      AND transcript_error IS NULL
      AND transcript_started_at IS NULL
    ));

  -- Los cuatro tipos con archivo: archivo, mime, descripcion y source; nada de
  -- contenido ni de enlace. Es la regla del audio de 00105 extendida.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_file_shape
    CHECK (kind NOT IN ('audio', 'video', 'image', 'file') OR (
      storage_path IS NOT NULL AND length(btrim(storage_path)) > 0
      AND mime_type IS NOT NULL
      AND content IS NULL
      AND description IS NOT NULL
      AND source IS NOT NULL
      AND url IS NULL
      AND link_kind IS NULL
    ));

  -- Un enlace: URL, clase y descripcion; nada de archivo.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_link_shape
    CHECK (kind <> 'link' OR (
      url IS NOT NULL
      AND link_kind IS NOT NULL
      AND description IS NOT NULL
      AND content IS NULL
      AND storage_path IS NULL
      AND mime_type IS NULL
      AND duration_seconds IS NULL
      AND size_bytes IS NULL
      AND source IS NULL
      AND caption IS NULL
      AND preview_path IS NULL
    ));

  -- La clase de enlace: lista cerrada, y solo en un enlace.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_link_kind_check
    CHECK (link_kind IS NULL OR (
      kind = 'link'
      AND link_kind IN ('video', 'imagen', 'testimonio', 'articulo', 'landing',
                        'formulario', 'agenda', 'pago', 'otro')
    ));

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_caption_kinds
    CHECK (caption IS NULL OR (
      kind IN ('image', 'video', 'file') AND length(btrim(caption)) > 0
    ));

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_preview_path_video_only
    CHECK (preview_path IS NULL OR (
      kind = 'video' AND length(btrim(preview_path)) > 0
    ));

  -- Solo http/https: un `javascript:` o un `file:` no tiene nada que hacer en
  -- un mensaje a un contacto. La normalizacion fina la hace TypeScript.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_url_http
    CHECK (url IS NULL OR url ~* '^https?://[^[:space:]]+$');

  -- La duracion es de lo que se reproduce.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_duration_kinds
    CHECK (duration_seconds IS NULL OR kind IN ('audio', 'video'));

  -- Grabar en el navegador existe solo para el audio; los demas se suben.
  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_recorded_audio_only
    CHECK (source IS NULL OR kind = 'audio' OR source = 'uploaded');

  ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_usage_count_positive
    CHECK (usage_count >= 0);
END;
$$;

-- ------------------------------------------------------------
-- 3. Indice
-- ------------------------------------------------------------
-- El orden por defecto del widget y de la lista: los mas usados primero. El
-- GIN de tags y el (workspace_id, kind, name) ya existen desde 00105.
CREATE INDEX IF NOT EXISTS idx_response_assets_last_used
  ON public.response_assets(workspace_id, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- 4. Policies de escritura
-- ------------------------------------------------------------
-- Owner/Admin como antes, y ademas un rol personalizado con `templates.manage`.
-- has_permission (00088) devuelve false para el Member de sistema (sus
-- permisos viven solo en lib/auth/permissions.ts y no incluyen esta clave),
-- asi que un Member sigue sin poder escribir. Leer no cambia: cualquier
-- miembro.

DROP POLICY IF EXISTS "response_assets_insert" ON public.response_assets;
CREATE POLICY "response_assets_insert" ON public.response_assets
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

DROP POLICY IF EXISTS "response_assets_update" ON public.response_assets;
CREATE POLICY "response_assets_update" ON public.response_assets
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

DROP POLICY IF EXISTS "response_assets_delete" ON public.response_assets;
CREATE POLICY "response_assets_delete" ON public.response_assets
  FOR DELETE USING (
    public.is_workspace_admin(workspace_id)
    OR public.has_permission(workspace_id, 'templates.manage')
  );

-- ------------------------------------------------------------
-- 5. Comentarios
-- ------------------------------------------------------------

COMMENT ON TABLE public.response_assets IS
  'La banca de recursos: textos, audios, videos, imagenes, archivos y enlaces en una sola tabla, distinguidos por `kind`. El atajo es unico entre todos los tipos.';
COMMENT ON COLUMN public.response_assets.kind IS
  'text | audio | video | image | file | link. Decide que columnas aplican (ver los CHECK _text_shape, _file_shape y _link_shape). No se cambia despues de crear.';
COMMENT ON COLUMN public.response_assets.description IS
  'Obligatoria para todo menos un texto. Es lo que lee el agente para decidir CUANDO usar este recurso, y lo que lee una persona para saber que es sin abrirlo. Nunca se manda.';
COMMENT ON COLUMN public.response_assets.url IS
  'Solo enlaces: la direccion, http o https.';
COMMENT ON COLUMN public.response_assets.link_kind IS
  'Solo enlaces: video | imagen | testimonio | articulo | landing | formulario | agenda | pago | otro.';
COMMENT ON COLUMN public.response_assets.preview_path IS
  'Solo videos: la miniatura del primer fotograma en chat-media/<ws>/library/. Opcional: si el navegador no la pudo sacar, la pantalla muestra el icono del tipo.';
COMMENT ON COLUMN public.response_assets.caption IS
  'image | video | file: el texto que acompaña al archivo cuando se manda. Lo ve el contacto.';
COMMENT ON COLUMN public.response_assets.usage_count IS
  'Cuantas veces se mando. Lo suma touch_response_asset (00132).';
COMMENT ON COLUMN public.response_assets.last_used_at IS
  'Cuando se mando por ultima vez. Ordena el widget del chat.';
COMMENT ON COLUMN public.response_assets.agent_enabled IS
  'El interruptor del agente, para los seis tipos. Un audio, o un video con voz, ademas necesita la transcripcion lista.';
