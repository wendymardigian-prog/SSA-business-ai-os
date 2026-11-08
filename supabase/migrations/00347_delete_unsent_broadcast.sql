-- ============================================================
-- 00347_delete_unsent_broadcast.sql
-- ============================================================
-- Eliminar un broadcast que nunca mando nada (docs/broadcasts.md).
--
-- Hasta hoy solo se borraba un borrador. Uno que se puso en cola y despues se
-- pauso o se cancelo sin mandar ni un mensaje quedaba para siempre en la lista,
-- con todos sus destinatarios `cancelled` en la cola.
--
-- La regla: se borra si ningun destinatario esta `sending`, `sent` ni `failed`
-- y el broadcast no se esta enviando (si se esta enviando, primero se pausa).
-- Lo que mando algo queda como historia. Los destinatarios se van con el
-- broadcast (la FK es `on delete cascade` desde la 00001).
--
-- Por que en la base y no con dos consultas desde la app: entre "contar" y
-- "borrar" la cola podria reclamar un destinatario y mandarlo, y su registro se
-- perderia. La funcion bloquea el broadcast (asi la cola no lo puede pasar de
-- programado a enviando en el medio) y las filas abiertas (asi espera a un
-- reclamo que este a mitad de camino y lo ve como `sending`).
--
-- Aditiva: una funcion nueva, solo `service_role`. Puede ir antes o despues del
-- codigo (sin ella, eliminar responde un error claro).
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_unsent_broadcast(p_workspace_id uuid, p_broadcast_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT b.status INTO v_status
  FROM public.broadcasts b
  WHERE b.id = p_broadcast_id AND b.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF v_status = 'sending' THEN
    RETURN 'sending';
  END IF;

  -- Espera a un reclamo de la cola en curso: despues de esto, lo que salio se ve.
  PERFORM 1
  FROM public.broadcast_recipients r
  WHERE r.broadcast_id = p_broadcast_id AND r.status IN ('pending', 'sending')
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.broadcast_recipients r
    WHERE r.broadcast_id = p_broadcast_id AND r.status IN ('sending', 'sent', 'failed')
  ) THEN
    RETURN 'has_sends';
  END IF;

  DELETE FROM public.broadcasts WHERE id = p_broadcast_id AND workspace_id = p_workspace_id;
  RETURN 'deleted';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unsent_broadcast(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unsent_broadcast(uuid, uuid) TO service_role;
