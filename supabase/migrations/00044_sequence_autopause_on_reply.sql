-- ============================================================================
-- 00044 — Secuencias: auto-pausa cuando el contacto responde (F11)
-- ============================================================================
-- Hasta ahora una secuencia solo se frenaba si el lead escribia una frase de
-- baja ("stop", "no me contactes") o si estaba marcado "no contactar". Si
-- contestaba "gracias, lo veo manana", el drip le seguia mandando pasos.
--
-- Va en SQL y no en TypeScript por lo mismo que find_or_link_contact (00025) y
-- apply_opt_out_check (00027): hay dos receptores de webhook, y la pausa mas su
-- entrada en el audit log tienen que pasar juntas en una transaccion.
--
-- Se limita al canal del mensaje a proposito: un lead que contesta por
-- Instagram no tiene por que frenar el seguimiento que corre por WhatsApp. Eso
-- es exactamente F12.
--
-- Idempotente: sobre un contacto sin nada activo no escribe nada, asi que no
-- llena el audit log con una entrada por cada mensaje entrante.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pause_sequences_on_reply(
  p_contact_id uuid,
  p_channel_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_workspace_id uuid;
BEGIN
  IF p_contact_id IS NULL OR p_channel_id IS NULL THEN
    RETURN 0;
  END IF;

  -- El UPDATE va adentro de un CTE para poder juntar los ids de TODAS las
  -- filas tocadas: un RETURNING ... INTO suelto sobre varias filas se queda
  -- solo con una.
  WITH paused AS (
    UPDATE public.sequence_enrollments
    SET status = 'paused',
        paused_reason = 'contact_replied',
        paused_at = now(),
        locked_at = NULL
    WHERE contact_id = p_contact_id
      AND channel_id = p_channel_id
      AND status = 'active'
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM paused;

  v_count := COALESCE(array_length(v_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.contacts WHERE id = p_contact_id;

  -- Una sola entrada por respuesta, no una por inscripcion: lo que paso es un
  -- hecho del contacto, y las inscripciones afectadas son su detalle.
  INSERT INTO public.audit_log (
    workspace_id, entity_type, entity_id, action, metadata, performed_by
  ) VALUES (
    v_workspace_id,
    'contact',
    p_contact_id,
    'sequence_paused',
    jsonb_build_object(
      'source', 'auto',
      'reason', 'contact_replied',
      'channel_id', p_channel_id,
      'enrollment_ids', to_jsonb(v_ids),
      'count', v_count
    ),
    NULL
  );

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.pause_sequences_on_reply(uuid, uuid) IS
  'Pausa las secuencias activas del contacto en ESE canal cuando responde (F11). La llaman los dos receptores de webhook con service role.';
