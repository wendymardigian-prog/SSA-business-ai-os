-- ============================================================
-- MIGRACION 00028 — QUE VER LA CONVERSACION Y VER AL LEAD SEAN LO MISMO (F16)
-- ============================================================
-- can_see_contact y can_see_conversation (00024) no dicen lo mismo, y eso deja
-- un hueco. El caso concreto:
--
--   Un lead sin setter ni vendedor tiene dos conversaciones: una asignada a
--   Alicia y otra sin nadie. Con unassigned_leads_visible_to_members prendido,
--   Bruno ve la conversacion sin asignar — pero NO ve al contacto, porque
--   can_see_contact considera que el lead "ya tiene dueño" apenas alguna de
--   sus conversaciones tiene agente.
--
-- Hoy eso se nota como conversaciones que aparecen en la bandeja con el nombre
-- vacio, porque el contacto que las acompaña no vuelve de la consulta. Y en
-- cuanto los filtros de F16 unan conversations con contacts para poder filtrar
-- por tag, por setter o por vendedor, esas conversaciones directamente
-- desaparecen sin explicacion.
--
-- La regla queda dicha una sola vez: se ve la conversacion de un lead que se
-- puede ver. Es lo que ya asume la ficha del contacto de F14, que muestra
-- todas sus conversaciones agrupadas por canal.
--
-- Lo que esto NO cambia: quien es agente asignado de una conversacion la sigue
-- viendo aunque no sea setter ni vendedor del contacto. can_see_contact
-- comprueba exactamente eso (00024, punto 6: existe una conversacion del
-- contacto con assigned_to = auth.uid()) antes de evaluar el caso "sin
-- asignar", asi que ser agente ya alcanza para ver al lead, y ver al lead
-- alcanza para ver la conversacion. Los casos de regresion de
-- scripts/verify-rls.mjs lo fijan.
--
-- Lo que si cambia, y conviene tenerlo presente: quien es agente de UNA
-- conversacion de un lead pasa a ver TODAS las conversaciones de ese lead (si
-- le asignaron el chat de WhatsApp, tambien ve el de Instagram). Es la lectura
-- que evita el absurdo de una ficha visible con huecos adentro.
--
-- Una trampa que hay que esquivar al leer esto: adentro de una funcion
-- SECURITY DEFINER, una subconsulta a contacts NO pasa por la RLS de contacts
-- (corre como la dueña de la tabla). El truco de "la subconsulta hereda el
-- scope sola" que documenta la 00023 para contact_notes vale en una POLICY,
-- que corre como quien invoca. Por eso aca hay que llamar a can_see_contact
-- explicitamente: sin esa llamada, esto le abriria todas las conversaciones a
-- todo el mundo.
-- ============================================================

-- ------------------------------------------------------------
-- 1. can_see_conversation delega en can_see_contact
-- ------------------------------------------------------------
-- No hay recursion: can_see_contact consulta la TABLA conversations (sin RLS,
-- por ser SECURITY DEFINER) y no llama a esta funcion.

CREATE OR REPLACE FUNCTION public.can_see_conversation(conv public.conversations)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_workspace_member(conv.workspace_id) THEN
    RETURN false;
  END IF;

  IF public.is_workspace_admin(conv.workspace_id) THEN
    RETURN true;
  END IF;

  -- El contacto borrado tambien esconde sus conversaciones: mientras el cron
  -- de F15 no lo purgue, no tiene por que seguir apareciendo en la bandeja.
  RETURN EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = conv.contact_id
      AND c.deleted_at IS NULL
      AND public.can_see_contact(c)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_see_conversation(public.conversations) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(public.conversations) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_see_conversation(public.conversations) IS
  'Se ve la conversacion de un lead que se puede ver. Delega en can_see_contact para que las dos reglas no puedan separarse (migracion 00028).';

-- ------------------------------------------------------------
-- 2. El indice que esta consulta usa en cada fila
-- ------------------------------------------------------------
-- can_see_contact pregunta "tiene este contacto alguna conversacion con agente
-- asignado". Sin indice es un scan de conversations por cada fila evaluada, y
-- ahora se evalua tambien para llegar a la conversacion.

CREATE INDEX IF NOT EXISTS idx_conversations_contact_assigned
  ON public.conversations(contact_id, assigned_to);
