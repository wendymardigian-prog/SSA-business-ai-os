-- ============================================================
-- 00355_reopen_unsent_broadcast.sql
-- ============================================================
-- «Editar» un broadcast programado o pausado que todavia no mando nada
-- (docs/broadcasts.md).
--
-- Solo un borrador se edita: al ponerlo en cola se congela la audiencia en
-- `broadcast_recipients`. Para editar TODO (nombre, canal, filtros, mensaje,
-- fecha) el broadcast vuelve a borrador: se vacia su cola y, al programarlo de
-- nuevo, la audiencia se arma otra vez con los filtros de ese momento.
--
-- La regla es la misma de «Eliminar» (00347): ningun destinatario `sending`,
-- `sent` ni `failed`. Ademas tiene que estar `scheduled` o `paused` (uno que se
-- esta enviando primero se pausa; uno terminado o cancelado ya no se edita).
-- Bloquea el broadcast (la cola no lo puede pasar de programado a enviando en
-- el medio) y las filas abiertas (espera a un reclamo a mitad de camino y lo ve
-- como `sending`).
--
-- Un broadcast pausado que YA mando algunos no vuelve a borrador: ahi se edita
-- solo el mensaje (el texto se arma al mandar cada uno), desde la app.
--
-- Aditiva: una funcion nueva, solo `service_role`. Puede ir antes o despues del
-- codigo (sin ella, «Editar» responde un error claro).
-- ============================================================

CREATE OR REPLACE FUNCTION public.reopen_unsent_broadcast(p_workspace_id uuid, p_broadcast_id uuid)
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

  IF v_status = 'draft' THEN
    RETURN 'already_draft';
  END IF;

  IF v_status = 'sending' THEN
    RETURN 'sending';
  END IF;

  IF v_status NOT IN ('scheduled', 'paused') THEN
    RETURN 'not_editable';
  END IF;

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

  DELETE FROM public.broadcast_recipients WHERE broadcast_id = p_broadcast_id;

  UPDATE public.broadcasts
  SET status = 'draft',
      total_recipients = 0,
      sent = 0,
      delivered = 0,
      failed = 0,
      skipped = 0,
      started_at = NULL,
      paused_at = NULL,
      cancelled_at = NULL,
      completed_at = NULL,
      updated_at = now()
  WHERE id = p_broadcast_id AND workspace_id = p_workspace_id;

  RETURN 'reopened';
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_unsent_broadcast(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_unsent_broadcast(uuid, uuid) TO service_role;
