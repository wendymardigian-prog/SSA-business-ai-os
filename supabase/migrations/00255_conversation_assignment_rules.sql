-- ============================================================
-- 00255_conversation_assignment_rules
-- ============================================================
-- Asignar CONVERSACIONES con reglas por cuenta conectada (octubre 2026).
--
-- `conversations.assigned_to` existe desde la 00001 y la RLS ya lo usa (que
-- te asignen un chat hace "tuyo" al contacto: `private.contact_is_mine`, 00249),
-- pero hasta aca solo lo escribia la herramienta del agente. Esta migracion
-- suma:
--
--   conversation_assignment_rules  Las reglas: "lo que entra por estas cuentas
--                                  va a esta persona" (fija) o "se reparte por
--                                  turnos entre estas personas". Gana la
--                                  PRIMERA activa que coincide (por
--                                  `position`). `channel_ids` vacio = todas las
--                                  cuentas. `setter_mode` dice que pasa con el
--                                  setter del contacto: nada, completarlo si
--                                  esta vacio, o reemplazarlo siempre.
--   conversation_rule_pick         La eleccion de la persona, pura (gemela de
--                                  `pickRuleMember` en lib/inbox/assignment-
--                                  rules.ts; comparten los casos de
--                                  lib/inbox/assignment-rules.cases.json).
--   assign_new_conversation        Aplica las reglas a UNA conversacion recien
--                                  creada, en una transaccion: bloquea la
--                                  conversacion y la regla (el turno no se
--                                  repite con dos mensajes a la vez), solo
--                                  escribe si sigue sin responsable y nunca
--                                  elige a alguien que ya no esta en el equipo.
--   conversation_people            Responsable + setter + vendedor, para que el
--                                  filtro "Asignación → persona" de la bandeja
--                                  incluya los chats asignados directo.
--
-- No se toca `assignment_rules` (00161, Ventas): esas asignan el CONTACTO por
-- su atribucion. El setter que pone esta regla no bloquea esas (no escribe
-- `assignment_locked_at`): si el setter ya esta, Ventas lo saltea por "lleno".
--
-- Escribe solo el servidor (las acciones chequean `assignment.manage` y usan el
-- cliente de servicio). La app lee con la RLS (miembros del workspace).
-- Nada se borra: una regla se archiva.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.conversation_people(public.conversations);
--   DROP FUNCTION IF EXISTS public.assign_new_conversation(uuid);
--   DROP FUNCTION IF EXISTS public.conversation_rule_pick(text, uuid[], uuid[], uuid);
--   DROP TABLE IF EXISTS public.conversation_assignment_rules;
--
-- Idempotente: IF NOT EXISTS, DO para los CHECK, CREATE OR REPLACE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La tabla
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversation_assignment_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                    text NOT NULL DEFAULT '',
  position                integer NOT NULL DEFAULT 0,
  enabled                 boolean NOT NULL DEFAULT true,
  channel_ids             uuid[] NOT NULL DEFAULT '{}',
  mode                    text NOT NULL DEFAULT 'fixed',
  member_ids              uuid[] NOT NULL DEFAULT '{}',
  last_assigned_member_id uuid,
  setter_mode             text NOT NULL DEFAULT 'none',
  archived_at             timestamptz,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversation_assignment_rules IS
  'Reglas de asignacion de conversaciones nuevas por cuenta conectada (00255). Gana la primera activa que coincide (position). Escribe solo el servidor.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignment_rules_mode_check') THEN
    ALTER TABLE public.conversation_assignment_rules ADD CONSTRAINT conversation_assignment_rules_mode_check
      CHECK (mode IN ('fixed', 'round_robin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignment_rules_setter_mode_check') THEN
    ALTER TABLE public.conversation_assignment_rules ADD CONSTRAINT conversation_assignment_rules_setter_mode_check
      CHECK (setter_mode IN ('none', 'if_empty', 'overwrite'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignment_rules_name_length') THEN
    ALTER TABLE public.conversation_assignment_rules ADD CONSTRAINT conversation_assignment_rules_name_length
      CHECK (char_length(name) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignment_rules_members_max') THEN
    ALTER TABLE public.conversation_assignment_rules ADD CONSTRAINT conversation_assignment_rules_members_max
      CHECK (cardinality(member_ids) <= 50 AND cardinality(channel_ids) <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_assignment_rules_workspace
  ON public.conversation_assignment_rules (workspace_id, position)
  WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.conversation_assignment_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.conversation_assignment_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.conversation_assignment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversation_assignment_rules_select" ON public.conversation_assignment_rules;
CREATE POLICY "conversation_assignment_rules_select" ON public.conversation_assignment_rules
  FOR SELECT USING ((select public.is_workspace_member(workspace_id)));

-- Sin policies de escritura: escribe el servidor despues de chequear la clave.

REVOKE ALL ON public.conversation_assignment_rules FROM anon, authenticated;
GRANT SELECT ON public.conversation_assignment_rules TO authenticated;
GRANT ALL ON public.conversation_assignment_rules TO service_role;

-- ------------------------------------------------------------
-- 2. La eleccion, pura
-- ------------------------------------------------------------
-- fixed:       la primera persona de la lista que sigue en el equipo.
-- round_robin: la siguiente despues de la ultima que recibio una (dando la
--              vuelta), salteando a quien ya no esta. Si la ultima ya no esta
--              en la lista, arranca de la primera.
-- Sin nadie disponible: NULL (la regla no aplica y se prueba la siguiente).

CREATE OR REPLACE FUNCTION public.conversation_rule_pick(
  p_mode       text,
  p_member_ids uuid[],
  p_active_ids uuid[],
  p_last       uuid
)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  n     integer := coalesce(cardinality(p_member_ids), 0);
  start integer := 0;
  i     integer;
  cand  uuid;
BEGIN
  IF n = 0 THEN
    RETURN NULL;
  END IF;

  IF p_mode = 'round_robin' AND p_last IS NOT NULL THEN
    start := coalesce(array_position(p_member_ids, p_last), 0);
  END IF;

  FOR k IN 1..n LOOP
    i := ((start + k - 1) % n) + 1;
    cand := p_member_ids[i];
    IF cand IS NOT NULL AND cand = ANY (coalesce(p_active_ids, '{}'::uuid[])) THEN
      RETURN cand;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.conversation_rule_pick(text, uuid[], uuid[], uuid) IS
  'Gemela de pickRuleMember (lib/inbox/assignment-rules.ts). Casos compartidos en lib/inbox/assignment-rules.cases.json.';

REVOKE ALL ON FUNCTION public.conversation_rule_pick(text, uuid[], uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_rule_pick(text, uuid[], uuid[], uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Aplicar las reglas a una conversacion nueva
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_new_conversation(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conv             public.conversations%ROWTYPE;
  r                public.conversation_assignment_rules%ROWTYPE;
  v_active         uuid[];
  v_pick           uuid;
  v_setter_old     uuid;
  v_setter_changed boolean := false;
BEGIN
  SELECT * INTO conv FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF conv.assigned_to IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_assigned', 'assigned_to', conv.assigned_to);
  END IF;

  SELECT coalesce(array_agg(wm.user_id), '{}'::uuid[]) INTO v_active
  FROM public.workspace_members wm
  WHERE wm.workspace_id = conv.workspace_id;

  FOR r IN
    SELECT *
    FROM public.conversation_assignment_rules car
    WHERE car.workspace_id = conv.workspace_id
      AND car.enabled
      AND car.archived_at IS NULL
      AND (cardinality(car.channel_ids) = 0 OR conv.channel_id = ANY (car.channel_ids))
    ORDER BY car.position, car.created_at, car.id
    FOR UPDATE
  LOOP
    v_pick := public.conversation_rule_pick(r.mode, r.member_ids, v_active, r.last_assigned_member_id);
    CONTINUE WHEN v_pick IS NULL;

    UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;

    IF r.mode = 'round_robin' THEN
      UPDATE public.conversation_assignment_rules SET last_assigned_member_id = v_pick WHERE id = r.id;
    END IF;

    IF r.setter_mode <> 'none' AND conv.contact_id IS NOT NULL THEN
      SELECT ct.setter_id INTO v_setter_old
      FROM public.contacts ct
      WHERE ct.id = conv.contact_id AND ct.deleted_at IS NULL
      FOR UPDATE;
      IF FOUND
         AND v_setter_old IS DISTINCT FROM v_pick
         AND (r.setter_mode = 'overwrite' OR v_setter_old IS NULL) THEN
        UPDATE public.contacts SET setter_id = v_pick WHERE id = conv.contact_id;
        v_setter_changed := true;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'status', 'assigned',
      'assigned_to', v_pick,
      'rule_id', r.id,
      'rule_name', r.name,
      'contact_id', conv.contact_id,
      'setter_changed', v_setter_changed,
      'setter_old', v_setter_old
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'no_rule');
END;
$$;

COMMENT ON FUNCTION public.assign_new_conversation(uuid) IS
  'Aplica conversation_assignment_rules a una conversacion recien creada (00255). Solo service_role. Nunca pisa un responsable que ya tiene.';

REVOKE ALL ON FUNCTION public.assign_new_conversation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_new_conversation(uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. Las personas de una conversacion (filtro "Asignación" de la bandeja)
-- ------------------------------------------------------------
-- Campo calculado de PostgREST: el responsable del chat, el setter y el
-- vendedor del contacto. Hasta aca el filtro por persona miraba solo setter y
-- vendedor, y una conversacion asignada directo a esa persona no aparecia.
-- PostgREST no puede combinar con OR una columna propia y una de la tabla
-- embebida; esto lo resuelve en una sola condicion (`cs`).
-- SECURITY INVOKER: lee el contacto con la RLS de quien mira.

CREATE OR REPLACE FUNCTION public.conversation_people(conv public.conversations)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT array_remove(ARRAY[
    conv.assigned_to,
    (SELECT c.setter_id FROM public.contacts c WHERE c.id = conv.contact_id),
    (SELECT c.vendedor_id FROM public.contacts c WHERE c.id = conv.contact_id)
  ], NULL)
$$;

COMMENT ON FUNCTION public.conversation_people(public.conversations) IS
  'Responsable del chat + setter + vendedor del contacto (00255). Lo usa el filtro de asignacion de la bandeja.';

REVOKE ALL ON FUNCTION public.conversation_people(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_people(public.conversations) TO authenticated, service_role;
