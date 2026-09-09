-- ============================================================================
-- 00043 — Secuencias: deteccion de colision (F13)
-- ============================================================================
-- Una colision es que un contacto quede en mas de una secuencia viva por el
-- mismo canal: dos seguimientos automaticos escribiendole en paralelo.
--
-- No lleva tabla nueva: la deteccion es una query sobre sequence_enrollments.
-- Lo unico que hace falta persistir es que la colision se detecto y que alguien
-- ya la resolvio, y eso es una propiedad de la inscripcion en el momento en que
-- se creo, no una entidad con vida propia.
--
-- collision_with guarda un snapshot ({enrollment_id, sequence_id,
-- sequence_name}) para que el aviso siga siendo legible despues de que la otra
-- inscripcion se cancelo o la otra secuencia se renombro.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS collision_detected_at timestamptz,
  ADD COLUMN IF NOT EXISTS collision_with jsonb,
  ADD COLUMN IF NOT EXISTS collision_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS collision_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collision_resolution text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_collision_resolution_check'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      ADD CONSTRAINT sequence_enrollments_collision_resolution_check
      CHECK (collision_resolution IS NULL OR collision_resolution IN (
        'kept_both', 'paused_other', 'removed_other', 'removed_this'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.sequence_enrollments.collision_with IS
  'Snapshot de las otras inscripciones vivas al momento de inscribir: [{enrollment_id, sequence_id, sequence_name}]. Snapshot y no join, para que el aviso siga siendo legible si despues se cancela o renombra.';

COMMENT ON COLUMN public.sequence_enrollments.collision_reviewed_at IS
  'Null = colision sin resolver; es lo que filtra el aviso en la pantalla de la secuencia.';

-- Alimenta el badge de la lista y del detalle sin escanear inscripciones viejas.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_open_collision
  ON public.sequence_enrollments(sequence_id)
  WHERE collision_detected_at IS NOT NULL AND collision_reviewed_at IS NULL;

-- La consulta de la deteccion: otras inscripciones vivas de este contacto en
-- este canal. El indice viejo (contact_id, status) no filtra canal e incluye
-- las completed/cancelled, que con el tiempo son la mayoria de la tabla.
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_live_channel
  ON public.sequence_enrollments(contact_id, channel_id)
  WHERE status IN ('active', 'paused');
