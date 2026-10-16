-- ============================================================
-- 00237 — Reacciones a mensajes (A3)
-- ============================================================
-- Una reaccion es un emoji que alguien le pone a UN mensaje. Se guarda aparte de
-- `messages` a proposito: una reaccion NO es un mensaje. Si entrara como una fila
-- de `messages` (que es lo que pasaba con WhatsApp: Evolution la manda como un
-- `messages.upsert`), contaria como un entrante vacio, sumaria un no leido,
-- dispararia las automatizaciones y le daria turno al agente.
--
--   direction 'in'  : la puso el contacto sobre un mensaje nuestro (o suyo).
--   direction 'out' : la pusimos nosotros (desde el sistema o desde el telefono).
--
-- Una reaccion por actor y por mensaje (WhatsApp e Instagram reemplazan la
-- anterior). Quitarla pone `removed_at`, no borra la fila (soft delete).
--
-- `message_id` es null cuando el mensaje no esta guardado en `messages` (el hilo
-- de Instagram se lee en vivo de Zernio): se identifica por `platform_message_id`,
-- el id con el que el proveedor lo conoce.
--
-- Escribe SOLO el servidor (service role). La app lee con la RLS de siempre: se
-- ve si se ve la conversacion.
--
-- Para volver atras: DROP TABLE public.message_reactions;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE CASCADE,
  platform_message_id text NOT NULL,
  emoji text NOT NULL,
  direction text NOT NULL,
  -- Quien reacciono: 'business' (nosotros) o 'contact' (el lead). Con una sola
  -- persona en cada chat alcanza; deja lugar a un grupo si algun dia hace falta.
  actor_key text NOT NULL,
  reacted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_direction_values') THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_direction_values
      CHECK (direction IN ('in', 'out'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_actor_values') THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_actor_values
      CHECK (actor_key IN ('business', 'contact'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_emoji_length') THEN
    ALTER TABLE public.message_reactions ADD CONSTRAINT message_reactions_emoji_length
      CHECK (char_length(emoji) BETWEEN 1 AND 32);
  END IF;
END $$;

-- Una reaccion por actor y mensaje: poner otra la reemplaza (upsert).
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_actor
  ON public.message_reactions (conversation_id, platform_message_id, actor_key);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation
  ON public.message_reactions (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON public.message_reactions (message_id) WHERE message_id IS NOT NULL;

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- Se ven las reacciones de las conversaciones que se ven (de ahi sale el scope de leads).
DROP POLICY IF EXISTS "message_reactions_select" ON public.message_reactions;
CREATE POLICY "message_reactions_select" ON public.message_reactions
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.id = message_reactions.conversation_id
    )
  );

-- Sin policies de INSERT, UPDATE ni DELETE: solo el service role escribe.
DROP POLICY IF EXISTS "message_reactions_insert" ON public.message_reactions;
DROP POLICY IF EXISTS "message_reactions_update" ON public.message_reactions;
DROP POLICY IF EXISTS "message_reactions_delete" ON public.message_reactions;

REVOKE ALL ON TABLE public.message_reactions FROM anon, authenticated;
GRANT SELECT ON TABLE public.message_reactions TO authenticated;
GRANT ALL ON TABLE public.message_reactions TO service_role;

COMMENT ON TABLE public.message_reactions IS
  'Reacciones (emoji) a mensajes. No son mensajes: no cuentan como entrantes, no suman no leidos, no disparan flows ni al agente. Una por actor (business/contact) y mensaje. Solo el servidor escribe.';

-- Realtime: la reaccion de un contacto aparece sola en la conversacion abierta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
  END IF;
END $$;
