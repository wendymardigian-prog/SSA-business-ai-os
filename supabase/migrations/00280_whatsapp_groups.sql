-- ============================================================
-- 00280_whatsapp_groups
-- ============================================================
-- Grupos de WhatsApp (noviembre 2026).
--
-- Hasta aca todo lo que pasaba en un grupo se descartaba en el receptor de
-- Evolution. Ahora un numero puede ACTIVAR algunos de sus grupos para:
--   - verlos y escribir en ellos desde la bandeja (`in_inbox`);
--   - guardar como contacto a quien se une (`save_contacts`), con un toque de
--     atribucion «WhatsApp · grupo · <nombre>»;
--   - disparar automatizaciones cuando alguien se une, reacciona a un mensaje
--     o vota en una encuesta del grupo.
--
-- Un grupo NO es una conversacion: `conversations` exige un contacto y de ella
-- dependen la RLS por responsable, «Esperando respuesta», los no leidos y el
-- agente. Los grupos viven en sus propias tablas.
--
-- Sin `contact_id` a proposito: cada participante se guarda con su identidad
-- de WhatsApp (`participant_id`: el telefono "+549..." o el "...@lid", la misma
-- que `contact_channels.platform_sender_id`) y el contacto se encuentra por
-- `contact_channels`. Asi una fusion de contactos (que muda `contact_channels`)
-- no necesita tocar estas tablas (`merge_contacts` / CONTACT_MERGE_TABLES).
--
-- Quien ve un grupo: Owner/Admin, o un rol cuya bandeja tiene esa cuenta con
-- alcance «todas» o «asignadas + sin asignar» (un grupo no tiene responsable,
-- es como una conversacion sin asignar). Escribir pide ademas «responde».
-- Gemelas en TypeScript: `canSeeWhatsappGroup` / `canWriteWhatsappGroup`
-- (lib/auth/channel-permissions.ts), con los casos de
-- lib/auth/whatsapp-group-access.cases.json.
--
-- Escribe solo el servidor (el webhook y las acciones, con el service role,
-- despues de chequear el permiso). La app lee con la RLS.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.can_see_whatsapp_group(uuid), public.can_write_whatsapp_group(uuid);
--   DROP TABLE IF EXISTS public.whatsapp_poll_votes, public.whatsapp_group_reactions,
--     public.whatsapp_group_messages, public.whatsapp_group_members, public.whatsapp_groups;
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Los grupos activados de cada numero
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_groups (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_id           uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  group_jid            text NOT NULL,
  subject              text NOT NULL,
  picture_url          text,
  size                 integer,
  announce             boolean NOT NULL DEFAULT false,
  in_inbox             boolean NOT NULL DEFAULT false,
  save_contacts        boolean NOT NULL DEFAULT false,
  last_message_at      timestamptz,
  last_message_preview text,
  unread_count         integer NOT NULL DEFAULT 0,
  left_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_groups IS
  'Grupos de WhatsApp activados en un numero (00280): verlos en la bandeja (in_inbox) y/o guardar como contacto a quien se une (save_contacts). No son conversaciones.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_jid_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_jid_check
      CHECK (group_jid ~ '^[0-9]{6,}(-[0-9]+)?@g\.us$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_groups_unread_check') THEN
    ALTER TABLE public.whatsapp_groups ADD CONSTRAINT whatsapp_groups_unread_check CHECK (unread_count >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_groups_channel_jid
  ON public.whatsapp_groups (channel_id, group_jid);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_inbox
  ON public.whatsapp_groups (workspace_id, last_message_at DESC NULLS LAST)
  WHERE in_inbox;

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_groups;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. Quien ve y quien escribe en un grupo
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_whatsapp_group(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  g       public.whatsapp_groups;
  v_scope text;
BEGIN
  SELECT * INTO g FROM public.whatsapp_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.is_workspace_member(g.workspace_id) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(g.workspace_id) THEN
    RETURN true;
  END IF;
  v_scope := private.role_channel_grant(private.my_channels(g.workspace_id), g.channel_id::text) ->> 'scope';
  RETURN COALESCE(v_scope IN ('all', 'own_unassigned'), false);
END;
$$;

COMMENT ON FUNCTION public.can_see_whatsapp_group(uuid) IS
  'Ve el grupo: Owner/Admin, o un rol con esa cuenta en alcance all u own_unassigned (un grupo no tiene responsable). Nunca NULL. Gemela de canSeeWhatsappGroup.';

CREATE OR REPLACE FUNCTION public.can_write_whatsapp_group(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  g       public.whatsapp_groups;
  v_grant jsonb;
BEGIN
  SELECT * INTO g FROM public.whatsapp_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.is_workspace_member(g.workspace_id) THEN
    RETURN false;
  END IF;
  IF public.is_workspace_admin(g.workspace_id) THEN
    RETURN true;
  END IF;
  v_grant := private.role_channel_grant(private.my_channels(g.workspace_id), g.channel_id::text);
  RETURN COALESCE(
    (v_grant ->> 'scope') IN ('all', 'own_unassigned') AND (v_grant -> 'reply') = 'true'::jsonb,
    false
  );
END;
$$;

COMMENT ON FUNCTION public.can_write_whatsapp_group(uuid) IS
  'Escribe en el grupo: lo ve y su rol responde en esa cuenta (Owner/Admin siempre). Nunca NULL. Gemela de canWriteWhatsappGroup.';

REVOKE ALL ON FUNCTION public.can_see_whatsapp_group(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_whatsapp_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_whatsapp_group(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_whatsapp_group(uuid) TO authenticated, service_role;

ALTER TABLE public.whatsapp_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_groups_select" ON public.whatsapp_groups;
CREATE POLICY "whatsapp_groups_select" ON public.whatsapp_groups
  FOR SELECT USING (public.can_see_whatsapp_group(id));

REVOKE ALL ON public.whatsapp_groups FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_groups TO authenticated;
GRANT ALL ON public.whatsapp_groups TO service_role;

-- ------------------------------------------------------------
-- 3. Los miembros (los que entraron, los importados y los que hablaron)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_group_members (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_id       uuid NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  phone          text,
  lid            text,
  display_name   text,
  is_admin       boolean NOT NULL DEFAULT false,
  source         text NOT NULL DEFAULT 'join',
  joined_at      timestamptz NOT NULL DEFAULT now(),
  left_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_group_members IS
  'Miembros de un grupo activado (00280). participant_id es la identidad de WhatsApp (telefono o @lid), la misma de contact_channels.platform_sender_id: el contacto sale de ahi.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_members_source_check') THEN
    ALTER TABLE public.whatsapp_group_members ADD CONSTRAINT whatsapp_group_members_source_check
      CHECK (source IN ('join', 'import', 'activity'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_group_members_participant
  ON public.whatsapp_group_members (group_id, participant_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_group_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_group_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.whatsapp_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_group_members_select" ON public.whatsapp_group_members;
CREATE POLICY "whatsapp_group_members_select" ON public.whatsapp_group_members
  FOR SELECT USING (public.can_see_whatsapp_group(group_id));

REVOKE ALL ON public.whatsapp_group_members FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_group_members TO authenticated;
GRANT ALL ON public.whatsapp_group_members TO service_role;

-- ------------------------------------------------------------
-- 4. Los mensajes de un grupo
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_group_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_id              uuid NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  platform_message_id   text,
  direction             text NOT NULL,
  sender_participant_id text,
  sender_name           text,
  text                  text,
  attachments           jsonb,
  poll                  jsonb,
  origin                text NOT NULL DEFAULT 'external',
  status                text NOT NULL DEFAULT 'sent',
  send_error            text,
  sent_by_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by_flow_id       uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  sent_by_node_id       text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_group_messages IS
  'Mensajes de un grupo activado (00280). poll = {name, options[], selectableCount} cuando es una encuesta. No pasan por el agente ni por los flujos de mensajes.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_messages_direction_check') THEN
    ALTER TABLE public.whatsapp_group_messages ADD CONSTRAINT whatsapp_group_messages_direction_check
      CHECK (direction IN ('inbound', 'outbound'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_messages_origin_check') THEN
    ALTER TABLE public.whatsapp_group_messages ADD CONSTRAINT whatsapp_group_messages_origin_check
      CHECK (origin IN ('app', 'external', 'flow'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_messages_status_check') THEN
    ALTER TABLE public.whatsapp_group_messages ADD CONSTRAINT whatsapp_group_messages_status_check
      CHECK (status IN ('pending', 'sent', 'failed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_group_messages_platform
  ON public.whatsapp_group_messages (group_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_thread
  ON public.whatsapp_group_messages (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_messages_flow_node
  ON public.whatsapp_group_messages (sent_by_flow_id, sent_by_node_id)
  WHERE sent_by_flow_id IS NOT NULL;

ALTER TABLE public.whatsapp_group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_group_messages_select" ON public.whatsapp_group_messages;
CREATE POLICY "whatsapp_group_messages_select" ON public.whatsapp_group_messages
  FOR SELECT USING (public.can_see_whatsapp_group(group_id));

REVOKE ALL ON public.whatsapp_group_messages FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_group_messages TO authenticated;
GRANT ALL ON public.whatsapp_group_messages TO service_role;

-- ------------------------------------------------------------
-- 5. Reacciones y votos (uno por persona y mensaje: el ultimo gana)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_group_reactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_id       uuid NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  message_id     uuid NOT NULL REFERENCES public.whatsapp_group_messages(id) ON DELETE CASCADE,
  participant_id text NOT NULL,
  from_me        boolean NOT NULL DEFAULT false,
  emoji          text NOT NULL,
  removed_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_group_reactions_emoji_check') THEN
    ALTER TABLE public.whatsapp_group_reactions ADD CONSTRAINT whatsapp_group_reactions_emoji_check
      CHECK (char_length(emoji) BETWEEN 1 AND 32);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_group_reactions_participant
  ON public.whatsapp_group_reactions (message_id, participant_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_group_reactions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_group_reactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.whatsapp_group_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_group_reactions_select" ON public.whatsapp_group_reactions;
CREATE POLICY "whatsapp_group_reactions_select" ON public.whatsapp_group_reactions
  FOR SELECT USING (public.can_see_whatsapp_group(group_id));

REVOKE ALL ON public.whatsapp_group_reactions FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_group_reactions TO authenticated;
GRANT ALL ON public.whatsapp_group_reactions TO service_role;

CREATE TABLE IF NOT EXISTS public.whatsapp_poll_votes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_id         uuid NOT NULL REFERENCES public.whatsapp_groups(id) ON DELETE CASCADE,
  message_id       uuid NOT NULL REFERENCES public.whatsapp_group_messages(id) ON DELETE CASCADE,
  participant_id   text NOT NULL,
  selected_options text[] NOT NULL DEFAULT '{}',
  voted_at         timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_poll_votes IS
  'El voto vigente de cada persona en una encuesta de un grupo (00280). selected_options vacio = saco su voto.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_poll_votes_participant
  ON public.whatsapp_poll_votes (message_id, participant_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_poll_votes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_poll_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.whatsapp_poll_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "whatsapp_poll_votes_select" ON public.whatsapp_poll_votes;
CREATE POLICY "whatsapp_poll_votes_select" ON public.whatsapp_poll_votes
  FOR SELECT USING (public.can_see_whatsapp_group(group_id));

REVOKE ALL ON public.whatsapp_poll_votes FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_poll_votes TO authenticated;
GRANT ALL ON public.whatsapp_poll_votes TO service_role;

-- ------------------------------------------------------------
-- 6. Tiempo real: la bandeja escucha los mensajes, reacciones y votos
-- ------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['whatsapp_groups', 'whatsapp_group_messages', 'whatsapp_group_reactions', 'whatsapp_poll_votes'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
