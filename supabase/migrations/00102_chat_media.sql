-- ============================================================================
-- 00102 — La media del chat vive en nuestro Storage
-- ============================================================================
-- El problema: hoy no guardamos ningun archivo que llega por el chat. De
-- Instagram se guarda la URL del CDN de Meta, que VENCE; de WhatsApp, el nodo
-- crudo de Baileys, cuya `url` es un `.enc` cifrado que no se puede abrir sin
-- la `mediaKey`. Resultado: una nota de voz que llego ayer no se puede
-- escuchar, y no hay nada que transcribir para que el agente la entienda.
--
-- Esta migracion no cambia comportamiento por si sola: abre el lugar donde
-- guardar. Todo lo que agrega es aditivo.
--
--   1. Bucket privado `chat-media`, con la misma regla que `email-attachments`
--      y `content-media`: el PRIMER SEGMENTO del path es el workspace, y es lo
--      que lee la policy. Sin policies de escritura: solo el service role
--      sube, porque quien copia los archivos es el receptor del webhook.
--
--   2. `messages.media_description` e `interpretability`. La segunda se guarda
--      aunque se pueda calcular: es lo que va a permitir responder "cuantos
--      mensajes no pudo entender el agente este mes" sin recorrer los adjuntos
--      de cada fila. Las filas viejas quedan en 'unknown' y no se reprocesan.
--
--   3. Dos interruptores por workspace: apagar la ingesta sin deploy, y la
--      retencion de los archivos.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. El bucket
-- ------------------------------------------------------------
--
-- 25 MB es el techo de lo que aceptan los proveedores de transcripcion, asi
-- que un archivo mas grande no serviria igual. Los MIME son los que mandan de
-- verdad Instagram y WhatsApp: los tres formatos de audio de WhatsApp
-- (ogg/opus nativo, mp4 y mpeg), los dos que graba un navegador (webm y mp4),
-- y los de imagen, video y documento habituales.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  false,
  26214400,  -- 25 MB
  ARRAY[
    -- Imagen
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    -- Video
    'video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp',
    -- Audio: los de WhatsApp, los del navegador y los que acepta el proveedor
    'audio/ogg', 'audio/opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
    'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/x-m4a', 'audio/m4a', 'audio/amr', 'audio/flac',
    -- Documento
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/zip', 'application/octet-stream'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Si el bucket ya existia (por ejemplo creado a mano), se le fuerzan los
-- valores: que sea privado es una condicion de seguridad, no una preferencia.
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = (
    SELECT allowed_mime_types FROM storage.buckets WHERE id = 'chat-media'
  )
WHERE id = 'chat-media';

-- Leer: cualquier miembro del workspace del primer segmento del path. NO es
-- `bucket_id = 'chat-media'` a secas: eso dejaria a cualquier usuario
-- autenticado escuchar los audios de otro negocio. El scope de leads lo
-- resuelve la ruta de descarga, que usa el cliente del usuario.
DROP POLICY IF EXISTS "chat_media_select" ON storage.objects;
CREATE POLICY "chat_media_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-media'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Escribir y borrar son del servidor: los archivos los copia el receptor del
-- webhook con el service role, y los borra el cron de retencion. Nadie sube a
-- mano a este bucket.
DROP POLICY IF EXISTS "chat_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_update" ON storage.objects;
DROP POLICY IF EXISTS "chat_media_delete" ON storage.objects;

-- ------------------------------------------------------------
-- 2. Columnas de media en messages
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_description text;

COMMENT ON COLUMN public.messages.media_description IS
  'Descripcion de la imagen generada por el modelo de vision (F8). Es lo que lee el agente cuando el lead manda una captura sin texto.';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS interpretability text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_interpretability_check;
  ALTER TABLE public.messages
    ADD CONSTRAINT messages_interpretability_check
    CHECK (interpretability IN (
      'text',         -- tiene texto propio
      'transcribed',  -- se entendio por su transcripcion
      'described',    -- se entendio por la descripcion de la imagen
      'label_only',   -- solo hay una etiqueta (una ubicacion, un contacto)
      'unreadable',   -- no se pudo interpretar: el agente escala
      'unknown'       -- todavia no se evaluo (y las filas anteriores a esta migracion)
    ));
END $$;

COMMENT ON COLUMN public.messages.interpretability IS
  'Si el agente pudo entender este mensaje. Se guarda aunque se pueda calcular: permite contar los no interpretables sin recorrer los adjuntos de cada fila.';

-- Los mensajes que el agente no pudo entender, por conversacion. Es el indice
-- que usa el escalado y el que va a usar el informe de "cuantos no entendio".
CREATE INDEX IF NOT EXISTS idx_messages_unreadable
  ON public.messages(conversation_id, created_at DESC)
  WHERE interpretability = 'unreadable';

-- ------------------------------------------------------------
-- 3. Los dos interruptores del workspace
-- ------------------------------------------------------------
--
-- Mismo patron que `persist_zernio_inbound` (00053): si el bucket se llena o
-- Evolution empieza a fallar, se apaga desde Ajustes sin esperar un deploy.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS persist_chat_media boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspaces.persist_chat_media IS
  'Copiar a nuestro Storage la media que llega por el chat. Apagarlo no borra lo ya guardado: los mensajes nuevos quedan solo con la URL del proveedor, que vence.';

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS chat_media_retention_days integer NOT NULL DEFAULT 180;

DO $$
BEGIN
  ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_chat_media_retention_check;
  ALTER TABLE public.workspaces
    ADD CONSTRAINT workspaces_chat_media_retention_check
    CHECK (chat_media_retention_days >= 0 AND chat_media_retention_days <= 3650);
END $$;

COMMENT ON COLUMN public.workspaces.chat_media_retention_days IS
  'Dias que se conserva el archivo de un adjunto del chat. 0 = no borrar nunca. La TRANSCRIPCION nunca se borra por retencion: es texto, pesa nada, y es el contexto del agente.';
