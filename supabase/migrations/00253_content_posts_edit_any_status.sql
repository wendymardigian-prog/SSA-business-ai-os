-- ============================================================================
-- 00253 — Una pieza de contenido se edita en cualquier estado
-- ============================================================================
-- Hasta ahora un Member (autor o responsable) solo podia escribir su pieza en
-- borrador, produccion o revision: una vez aprobada, programada o publicada no
-- se podia corregir ni un error de tipeo del caption. Desde esta migracion
-- (cambio aprobado M10, 22/10/2026) el contenido se edita en cualquier estado.
--
-- Lo que NO cambia: quien mueve el ESTADO. La condicion de estado de la
-- politica vieja hacia dos cosas a la vez:
--   a) no dejaba editar una pieza aprobada (lo que se quiere sacar), y
--   b) no dejaba que un Member la llevara el mismo a Aprobado, Programado o
--      Publicado (lo que hay que conservar: aprobar es de quien aprueba).
-- Una politica no ve la fila VIEJA, asi que (b) pasa a un trigger que compara
-- OLD y NEW: un Member solo cambia el estado entre borrador, produccion y
-- revision, exactamente como antes. Si el estado no cambia, edita.
-- Owner, Admin y el servidor (service_role, sin auth.uid()) no pasan por el
-- trigger: son los mismos que la politica ya dejaba pasar.
--
-- 1. Politica `content_posts_update` sin la condicion de estado.
-- 2. Trigger BEFORE UPDATE OF status `content_posts_status_guard`.
--
-- Definicion vieja de `content_posts_update` (00223, vigente hasta esta migracion):
--   CREATE POLICY "content_posts_update" ON public.content_posts
--     FOR UPDATE USING (
--       public.is_workspace_admin(workspace_id)
--       OR (
--         public.is_workspace_member(workspace_id)
--         AND (created_by = auth.uid() OR assigned_to = auth.uid())
--         AND status IN ('draft', 'in_production', 'in_review')
--       )
--     )
--     WITH CHECK (
--       public.is_workspace_admin(workspace_id)
--       OR (
--         -- Quien solo es responsable edita, pero reasignar es del autor o de un admin:
--         -- despues de reasignar, la fila ya no es suya y esto falla.
--         (created_by = auth.uid() OR assigned_to = auth.uid())
--         AND status IN ('draft', 'in_production', 'in_review')
--       )
--     );
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS content_posts_status_guard ON public.content_posts;
--   DROP FUNCTION IF EXISTS public.content_posts_status_guard();
--   (recrear la politica con la definicion de arriba)
-- Riesgo: bajo. La politica solo AMPLIA lo que edita un Member, y el trigger
-- conserva la regla de quien cambia el estado.
-- ============================================================================

SET search_path = '';

DROP POLICY IF EXISTS "content_posts_update" ON public.content_posts;
CREATE POLICY "content_posts_update" ON public.content_posts
  FOR UPDATE USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND (created_by = auth.uid() OR assigned_to = auth.uid())
    )
  )
  WITH CHECK (
    public.is_workspace_admin(workspace_id)
    OR (
      -- Quien solo es responsable edita, pero reasignar es del autor o de un admin:
      -- despues de reasignar, la fila ya no es suya y esto falla.
      created_by = auth.uid() OR assigned_to = auth.uid()
    )
  );

-- Un Member cambia el estado solo entre los tres de autor (lo que antes hacia
-- la condicion de estado de la politica).
CREATE OR REPLACE FUNCTION public.content_posts_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- El servidor (service_role, cron, funciones del sistema) no tiene usuario.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.is_workspace_admin(NEW.workspace_id) THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('draft', 'in_production', 'in_review')
     AND NEW.status IN ('draft', 'in_production', 'in_review') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ese cambio de estado lo hace quien aprueba o publica.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.content_posts_status_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS content_posts_status_guard ON public.content_posts;
CREATE TRIGGER content_posts_status_guard
  BEFORE UPDATE OF status ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.content_posts_status_guard();
