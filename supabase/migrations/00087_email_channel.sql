-- ============================================================
-- 00087: el email como un canal mas (F62, bloque 8)
-- ============================================================
--
-- La decision de fondo: el email NO es un modulo aparte. Es un canal, como
-- Instagram o WhatsApp, y entra por las mismas tablas: `channels`,
-- `conversations`, `messages`. Una bandeja aparte para el email seria una
-- segunda bandeja que revisar, y el punto del sistema es que haya una sola.
--
-- Lo que el email SI necesita y los otros canales no son las cabeceras del
-- hilo: sin `In-Reply-To` y `References`, una respuesta llega como un mail
-- suelto y el cliente de la otra persona la muestra fuera de conversacion.
--
-- `late_account_id` sigue siendo NOT NULL, como en toda la tabla: el canal
-- de email guarda ahi `email:<direccion>`. Aflojar ese NOT NULL para un
-- canal obligaria a revisar los 40+ lugares que lo leen asumiendo un texto.

-- ------------------------------------------------------------
-- 1. El canal
-- ------------------------------------------------------------

ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_platform_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_platform_check
  CHECK (platform IN (
    'facebook', 'instagram', 'twitter', 'telegram', 'bluesky', 'reddit',
    'whatsapp', 'email'
  ));

ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_provider_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_provider_check
  CHECK (provider IN ('zernio', 'evolution', 'resend'));

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS email_address text;

COMMENT ON COLUMN public.channels.email_address IS
  'La direccion que recibe y desde la que se responde. Solo en canales de email.';

-- Uno solo por workspace: dos canales de email serian dos bandejas para la
-- misma direccion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_channels_email_per_workspace
  ON public.channels (workspace_id)
  WHERE platform = 'email';

-- ------------------------------------------------------------
-- 2. Las cabeceras del hilo
-- ------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_message_id text,
  ADD COLUMN IF NOT EXISTS email_in_reply_to text,
  ADD COLUMN IF NOT EXISTS email_references text,
  ADD COLUMN IF NOT EXISTS email_from text,
  ADD COLUMN IF NOT EXISTS email_to jsonb,
  ADD COLUMN IF NOT EXISTS email_cc jsonb;

COMMENT ON COLUMN public.messages.email_message_id IS
  'El Message-ID del correo. Es con lo que el cliente de la otra persona arma el hilo.';
COMMENT ON COLUMN public.messages.email_references IS
  'La cadena References acumulada: todos los Message-ID del hilo, en orden.';

-- Para encontrar el ultimo entrante del hilo al responder.
CREATE INDEX IF NOT EXISTS idx_messages_email_message_id
  ON public.messages (email_message_id)
  WHERE email_message_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Los adjuntos
-- ------------------------------------------------------------
--
-- Se copian a nuestro Storage apenas llegan: los links que da Resend
-- vencen, y un adjunto que no se puede abrir tres dias despues es un
-- adjunto perdido.
--
-- Misma regla que el bucket de contenido: el primer segmento del path es el
-- workspace, y la base decide quien lee.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('email-attachments', 'email-attachments', false, 26214400)  -- 25 MB
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET public = false, file_size_limit = 26214400
WHERE id = 'email-attachments';

DROP POLICY IF EXISTS "email_attachments_select" ON storage.objects;
CREATE POLICY "email_attachments_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'email-attachments'
    AND public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- Escribir y borrar son del servidor: los adjuntos los copia el receptor
-- del webhook, y nadie los sube a mano.
DROP POLICY IF EXISTS "email_attachments_insert" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_update" ON storage.objects;
DROP POLICY IF EXISTS "email_attachments_delete" ON storage.objects;

-- ------------------------------------------------------------
-- 4. El trigger de flows (F67)
-- ------------------------------------------------------------

-- La lista completa de la 00038 mas `email_received`. Se tira y se rehace,
-- porque Postgres no deja extender un CHECK.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity',
    -- Etapa 2
    'email_received'
  )
);
