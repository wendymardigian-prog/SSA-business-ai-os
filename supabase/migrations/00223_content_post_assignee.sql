-- ============================================================================
-- 00223 — Responsable de cada pieza de contenido
-- ============================================================================
-- Cada pieza tiene, ademas de quien la creo (`created_by`, que NO se toca), un
-- RESPONSABLE (`assigned_to`) que se puede cambiar. El tablero lo muestra como un
-- circulo con las iniciales y el drawer lo deja elegir.
--
-- 1. Columna `content_posts.assigned_to` (uuid -> auth.users, ON DELETE SET NULL),
--    con un indice parcial para filtrar por persona.
-- 2. Relleno: las piezas que ya existen quedan asignadas a quien las creo (solo si
--    esa persona sigue en el workspace).
-- 3. Trigger BEFORE INSERT/UPDATE:
--      - al crear una pieza sin responsable, se asigna a quien la crea (si es
--        miembro). Asi no hay que tocar `approve_content_idea_v2` ni `createPost`:
--        todos los caminos de alta quedan cubiertos;
--      - el responsable tiene que ser MIEMBRO del workspace de la pieza.
-- 4. Politica de UPDATE: un Member edita lo que creo O lo que tiene asignado, solo
--    mientras esta en borrador, produccion o revision (como hasta ahora). Owner y
--    Admin siguen editando todo. Quien solo es responsable edita la pieza pero no
--    puede reasignarla: el WITH CHECK pide que sea el autor para cambiar de manos.
--
-- Definicion vieja de `content_posts_update` (00083, vigente hasta esta migracion):
--   USING (
--     is_workspace_admin(workspace_id)
--     OR (is_workspace_member(workspace_id) AND created_by = auth.uid()
--         AND status = ANY (ARRAY['draft','in_production','in_review']))
--   )
--   WITH CHECK (
--     is_workspace_admin(workspace_id)
--     OR (created_by = auth.uid() AND status = ANY (ARRAY['draft','in_production','in_review']))
--   )
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS content_posts_assignee ON public.content_posts;
--   DROP FUNCTION IF EXISTS public.content_posts_assignee_guard();
--   (recrear la politica con la definicion de arriba)
--   DROP INDEX IF EXISTS public.idx_content_posts_assignee;
--   ALTER TABLE public.content_posts DROP COLUMN IF EXISTS assigned_to;
-- Riesgo: bajo. Aditiva; la politica solo AMPLIA lo que puede editar un Member.
-- ============================================================================

SET search_path = '';

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.content_posts.assigned_to IS
  'Responsable de la pieza (miembro del workspace). Distinto de created_by, que no cambia. Por defecto, quien la crea.';

CREATE INDEX IF NOT EXISTS idx_content_posts_assignee
  ON public.content_posts (workspace_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

-- Relleno: quien la creo, si sigue en el workspace. Solo donde esta vacio (idempotente).
UPDATE public.content_posts p
   SET assigned_to = p.created_by
 WHERE p.assigned_to IS NULL
   AND p.created_by IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = p.workspace_id AND m.user_id = p.created_by
   );

-- El responsable es miembro, y por defecto es quien crea.
CREATE OR REPLACE FUNCTION public.content_posts_assignee_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.assigned_to IS NULL AND NEW.created_by IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.created_by
    ) THEN
      NEW.assigned_to := NEW.created_by;
    END IF;
  END IF;

  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.assigned_to
    ) THEN
      RAISE EXCEPTION 'El responsable tiene que ser parte del equipo.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.content_posts_assignee_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS content_posts_assignee ON public.content_posts;
CREATE TRIGGER content_posts_assignee
  BEFORE INSERT OR UPDATE OF assigned_to ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.content_posts_assignee_guard();

-- Politica de UPDATE: el responsable tambien edita (solo hasta revision).
DROP POLICY IF EXISTS "content_posts_update" ON public.content_posts;
CREATE POLICY "content_posts_update" ON public.content_posts
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND (created_by = auth.uid() OR assigned_to = auth.uid())
      AND status IN ('draft', 'in_production', 'in_review')
    )
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (
      -- Quien solo es responsable edita, pero reasignar es del autor o de un admin:
      -- despues de reasignar, la fila ya no es suya y esto falla.
      (created_by = auth.uid() OR assigned_to = auth.uid())
      AND status IN ('draft', 'in_production', 'in_review')
    )
  );
