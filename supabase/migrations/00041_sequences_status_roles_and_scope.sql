-- ============================================================================
-- 00041 — Secuencias: estados validos, roles y scope de leads (F9)
-- ============================================================================
-- Que hace:
--   1. CHECK en sequences.status y sequence_enrollments.status. Venian de la
--      00005 como texto libre: cualquier valor entra, y uno inesperado hace
--      crashear la lista de inscriptos (busca el estado en un diccionario y
--      lee .classes de undefined).
--   2. RLS por rol en sequences: hoy una sola policy FOR ALL deja que un Member
--      active, edite o borre una secuencia que le manda DMs a leads ajenos.
--   3. RLS con scope de leads en sequence_enrollments. La 00018/00024 ato el
--      scope a contacts y conversations, pero las inscripciones cuelgan de
--      sequences, asi que quedaron fuera: un Member ve y cancela inscripciones
--      de leads que la RLS le esconde en todos los demas lados.
--   4. Re-inscripcion: el UNIQUE(sequence_id, contact_id) de la 00005 impedia
--      volver a inscribir a un contacto para siempre, incluso despues de que
--      terminara la secuencia. Pasa a ser un unique parcial sobre las
--      inscripciones vivas.
--
-- Idempotente. No crea tablas ni funciones nuevas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Estados validos
-- ----------------------------------------------------------------------------

-- Se normaliza antes de restringir: si quedo algun valor viejo fuera de la
-- lista, agregar el CHECK fallaria y la migracion no seria idempotente.
UPDATE public.sequences
SET status = 'draft'
WHERE status IS NULL OR status NOT IN ('draft', 'active', 'paused');

UPDATE public.sequence_enrollments
SET status = 'active'
WHERE status IS NULL OR status NOT IN ('active', 'paused', 'completed', 'cancelled');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequences_status_check'
  ) THEN
    ALTER TABLE public.sequences
      ADD CONSTRAINT sequences_status_check
      CHECK (status IN ('draft', 'active', 'paused'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_status_check'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      ADD CONSTRAINT sequence_enrollments_status_check
      CHECK (status IN ('active', 'paused', 'completed', 'cancelled'));
  END IF;
END $$;

COMMENT ON COLUMN public.sequences.status IS
  'draft = todavia no corre | active = inscribe y manda | paused = frenada; sus inscripciones se pausan, no se cancelan (00041).';

-- ----------------------------------------------------------------------------
-- 2. Re-inscripcion: unique solo sobre lo vivo
-- ----------------------------------------------------------------------------
-- Un contacto no puede estar dos veces a la vez en la misma secuencia, pero si
-- ya la termino (o se lo saco), se lo puede volver a inscribir. El indice
-- parcial es ademas el que necesita la deteccion de colision (00043).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sequence_enrollments_sequence_id_contact_id_key'
  ) THEN
    ALTER TABLE public.sequence_enrollments
      DROP CONSTRAINT sequence_enrollments_sequence_id_contact_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sequence_enrollments_one_live
  ON public.sequence_enrollments(sequence_id, contact_id)
  WHERE status IN ('active', 'paused');

-- ----------------------------------------------------------------------------
-- 3. RLS de sequences: leer todo el workspace, escribir solo Owner/Admin
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "sequences_workspace" ON public.sequences;
DROP POLICY IF EXISTS "sequences_select" ON public.sequences;
DROP POLICY IF EXISTS "sequences_insert" ON public.sequences;
DROP POLICY IF EXISTS "sequences_update" ON public.sequences;
DROP POLICY IF EXISTS "sequences_delete" ON public.sequences;

CREATE POLICY "sequences_select" ON public.sequences
  FOR SELECT USING (public.is_workspace_member(workspace_id));

CREATE POLICY "sequences_insert" ON public.sequences
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "sequences_update" ON public.sequences
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

CREATE POLICY "sequences_delete" ON public.sequences
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- ----------------------------------------------------------------------------
-- 4. RLS de sequence_enrollments: workspace + scope de leads
-- ----------------------------------------------------------------------------
-- can_see_contact recibe la fila entera de contacts, no un uuid, por eso va
-- como subconsulta y no como llamada directa. Adentro de una POLICY la
-- subconsulta a contacts hereda la RLS de contacts; en una funcion
-- SECURITY DEFINER no lo haria (leccion escrita en la 00028).

DROP POLICY IF EXISTS "enrollments_via_sequence" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_select" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_insert" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_update" ON public.sequence_enrollments;
DROP POLICY IF EXISTS "enrollments_delete" ON public.sequence_enrollments;

CREATE POLICY "enrollments_select" ON public.sequence_enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

CREATE POLICY "enrollments_insert" ON public.sequence_enrollments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

CREATE POLICY "enrollments_update" ON public.sequence_enrollments
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_member(s.workspace_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.id = sequence_enrollments.contact_id
        AND public.can_see_contact(c)
    )
  );

-- Borrar una inscripcion es perder la evidencia de que el contacto estuvo ahi.
-- El camino normal es cancelarla (UPDATE); el DELETE queda para Owner/Admin.
CREATE POLICY "enrollments_delete" ON public.sequence_enrollments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.sequences s
      WHERE s.id = sequence_enrollments.sequence_id
        AND public.is_workspace_admin(s.workspace_id)
    )
  );
