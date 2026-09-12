-- ============================================================================
-- 00054 — RLS de messages con workspace_id, sin perder el scope de leads
-- ============================================================================
-- Las dos policies de messages vienen intactas desde la 00002 y dicen, las dos,
-- lo mismo: "existe una conversacion con este id de la que sos miembro".
--
-- Ese EXISTS es mas importante de lo que parece, y hay que entender por que
-- antes de tocarlo. Una subconsulta dentro de una POLICY pasa por la RLS de la
-- tabla que consulta (esta documentado en la 00018, lineas 203-206). Asi que
-- ese `select 1 from conversations` no devuelve cualquier conversacion:
-- devuelve las que la policy conversations_select deja ver, que llama a
-- can_see_conversation -> can_see_contact. De ahi sale, gratis y sin nombrarlo,
-- TODO el scope de leads de los mensajes: un Member no ve los mensajes de un
-- lead ajeno porque no ve la conversacion.
--
-- Por eso esta migracion NO reemplaza el EXISTS por un filtro sobre la columna
-- workspace_id recien agregada. Cambiar
--
--     EXISTS (select 1 from conversations ...)     -- scope de leads incluido
--   por
--     public.is_workspace_member(workspace_id)     -- solo aislamiento
--
-- se leeria como una simplificacion equivalente y seria un agujero: cualquier
-- Member pasaria a ver los mensajes de todos los leads del workspace. El
-- aislamiento por workspace y el scope de leads no son la misma regla.
--
-- Lo que se hace es SUMAR la condicion, no cambiarla. Queda igual de estricta
-- que antes mas una barrera extra, y el planner puede arrancar por el indice
-- de workspace_id en vez de por el join.
--
-- UPDATE y DELETE siguen sin policy, y eso es deliberado: con RLS activa y sin
-- policy, nadie que no sea service role puede tocar un mensaje. Es lo correcto
-- —ninguna pantalla edita ni borra mensajes; el status lo escribe el servidor y
-- el borrado es por cascade o por la purga de retencion— y es el mismo criterio
-- que la 00046 dejo escrito para scheduled_jobs. Se documenta en un COMMENT
-- para que se lea como una decision y no como un olvido.
--
-- Idempotente.
-- ============================================================================

-- Los nombres viejos, de la 00002. Se borran por nombre exacto para no dejar
-- dos policies permisivas conviviendo (en RLS se suman con OR: la vieja, mas
-- laxa, ganaria y esta migracion no haria nada).
DROP POLICY IF EXISTS "Users can view messages via conversation" ON public.messages;
DROP POLICY IF EXISTS "Users can insert messages via conversation" ON public.messages;

DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.id = messages.conversation_id
    )
  );

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.conversations conv
      WHERE conv.id = messages.conversation_id
    )
  );

COMMENT ON TABLE public.messages IS
  'Mensajes de todos los canales. Desde la Fase 3 guarda tambien los entrantes de Zernio (Instagram), sujeto al interruptor workspaces.persist_zernio_inbound. SELECT e INSERT exigen ver la conversacion (de ahi sale el scope de leads) ademas de ser miembro del workspace. UPDATE y DELETE no tienen policy a proposito: solo el service role escribe estados y solo la purga borra.';
