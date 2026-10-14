-- ============================================================================
-- 00209 — Equipo y roles (B1/B2, F7-F10): la invitacion lleva su rol y su historia
-- ============================================================================
-- Hoy una invitacion solo guarda email, rol base (admin|member), quien invito, estado y
-- vencimiento. Para poder invitar con un rol personalizado, por email o por link, reenviar,
-- renovar, anular sin borrar y mostrar un historial, se suman diez columnas:
--
--   role_id        el rol con el que entra (NULL = el rol base `role`; si el rol se borra, cae ahi)
--   delivery       'email' (se mando un correo) o 'link' (solo se genero el link)
--   email_status   resultado del ULTIMO envio: sent | failed | not_configured
--   email_error    mensaje corto del proveedor (sin datos sensibles)
--   last_sent_at   cuando se mando por ultima vez
--   send_count     cuantas veces se mando (tope 5; lo hace cumplir la accion de reenviar)
--   accepted_at / accepted_by   cuando y con que cuenta se aceptó
--   revoked_at  / revoked_by    cuando y quien la anuló (anular es un UPDATE, ya no un DELETE)
--
-- `status` NO cambia de CHECK (pending | accepted | revoked): "vencida" se DERIVA
-- (`inviteState`, lib/team/invite-state.ts). El link sigue siendo /invite/<id>: los ya
-- enviados siguen andando. Las filas viejas quedan con `delivery = 'email'` y el resto nulo.
--
-- Aditiva e idempotente. No toca ninguna politica (eso es la 00212, despues del codigo).
--
-- Como volver atras:
--   ALTER TABLE public.workspace_invites
--     DROP COLUMN IF EXISTS role_id, DROP COLUMN IF EXISTS delivery, DROP COLUMN IF EXISTS email_status,
--     DROP COLUMN IF EXISTS email_error, DROP COLUMN IF EXISTS last_sent_at, DROP COLUMN IF EXISTS send_count,
--     DROP COLUMN IF EXISTS accepted_at, DROP COLUMN IF EXISTS accepted_by,
--     DROP COLUMN IF EXISTS revoked_at, DROP COLUMN IF EXISTS revoked_by;
--   DROP INDEX IF EXISTS public.idx_workspace_invites_workspace_status;
-- ============================================================================

ALTER TABLE public.workspace_invites
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.workspace_roles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS email_error text,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_delivery_check' AND conrelid = 'public.workspace_invites'::regclass) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_delivery_check CHECK (delivery IN ('email', 'link'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_email_status_check' AND conrelid = 'public.workspace_invites'::regclass) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_email_status_check CHECK (email_status IS NULL OR email_status IN ('sent', 'failed', 'not_configured'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_invites_send_count_check' AND conrelid = 'public.workspace_invites'::regclass) THEN
    ALTER TABLE public.workspace_invites
      ADD CONSTRAINT workspace_invites_send_count_check CHECK (send_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.workspace_invites.role_id IS
  'El rol con el que entra la persona. NULL = el rol base `role`. Si el rol se borra antes de aceptar, cae al Member de sistema.';
COMMENT ON COLUMN public.workspace_invites.delivery IS
  'email = se mando un correo; link = solo se genero el link para pasarlo a mano.';

-- La lista de pendientes y el historial se piden por workspace y estado.
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_status
  ON public.workspace_invites (workspace_id, status, created_at DESC);
