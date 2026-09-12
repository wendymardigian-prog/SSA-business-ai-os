-- ============================================================================
-- 00057 — Borrar todo lo persistido de los entrantes de Zernio
-- ============================================================================
-- El interruptor `workspaces.persist_zernio_inbound` existe por una duda que
-- todavia no esta resuelta: si persistir el contenido de los DMs de Instagram
-- entra dentro de los terminos de Zernio y de Meta para este tipo de cuenta.
--
-- Apagarlo frena el guardado hacia adelante, pero deja intacto todo lo que ya
-- se guardo, y la purga por antiguedad (00055) recien lo alcanzaria a los 12
-- meses. Si la respuesta llega y es que no, doce meses no es una respuesta.
--
-- Esta funcion es la otra mitad del interruptor: deja la base como si el
-- guardado nunca se hubiera prendido.
--
-- Que borra, exactamente:
--   - Mensajes ENTRANTES (direction = 'inbound')
--   - de conversaciones cuyo canal es de Zernio (provider = 'zernio')
--
-- Que NO borra, y es a proposito:
--   - Los SALIENTES de Zernio. Esos son nuestros, no del lead: los escribio el
--     sistema o una persona del equipo, y son los que dejan ver en la bandeja
--     que el bot contesto. Nunca estuvieron en discusion.
--   - Nada de WhatsApp. Evolution no pasa por los terminos de Zernio, y para
--     ese canal esta tabla es la unica fuente del hilo: borrarlo vaciaria la
--     bandeja de WhatsApp.
--
-- No la agenda ningun cron, y no deberia: es una decision que se toma una vez,
-- a mano, cuando hay una respuesta. Se corre con scripts/purge-zernio-inbound.mjs,
-- que primero muestra cuanto va a borrar y solo escribe con --apply.
--
-- Con p_apply en false (el default) no borra: cuenta. El default es el lado
-- seguro a proposito, para que una llamada sin argumentos nunca sea destructiva.
--
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purge_zernio_inbound_messages(
  p_workspace_id uuid,
  p_apply        boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'purge_zernio_inbound_messages necesita un workspace: sin el, borraria de todos';
  END IF;

  IF NOT p_apply THEN
    SELECT count(*) INTO v_count
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      JOIN public.channels ch     ON ch.id = c.channel_id
     WHERE m.workspace_id = p_workspace_id
       AND m.direction = 'inbound'
       AND ch.provider = 'zernio';
    RETURN v_count;
  END IF;

  DELETE FROM public.messages m
   USING public.conversations c, public.channels ch
   WHERE c.id = m.conversation_id
     AND ch.id = c.channel_id
     AND m.workspace_id = p_workspace_id
     AND m.direction = 'inbound'
     AND ch.provider = 'zernio';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) IS
  'La otra mitad del interruptor persist_zernio_inbound: borra TODOS los mensajes entrantes ya guardados de los canales de Zernio, para cuando haya que deshacer la persistencia. No toca los salientes ni WhatsApp. Con p_apply en false solo cuenta. No la llama ningun cron: se corre a mano con scripts/purge-zernio-inbound.mjs.';

REVOKE ALL ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_zernio_inbound_messages(uuid, boolean) TO service_role;
