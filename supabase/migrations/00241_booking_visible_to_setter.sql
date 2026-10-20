-- ============================================================
-- 00241_booking_visible_to_setter
-- ============================================================
-- Quien ve una reunion suma un caso: el SETTER del contacto (decision del
-- 20/10/2026). Un setter agenda la llamada en el evento del closer y despues
-- la perdia de vista, porque `can_see_booking` solo dejaba ver al anfitrion.
-- Ahora un Member ve las reuniones donde es el anfitrion Y las de los
-- contactos donde esta asignado como setter. Como las acciones sobre una
-- reunion (`visibleBooking`, lib/actions/scheduling/bookings.ts) leen con la
-- RLS, ese setter tambien puede reagendarla o cancelarla si tiene
-- `bookings.manage`.
--
-- Igual que antes, la rama "lo mio" NO depende de `has_permission` (que es
-- false para el Member de sistema). Un contacto borrado (soft delete) no
-- cuenta.
--
-- Definicion anterior (00099), para volver atras:
--
--   CREATE OR REPLACE FUNCTION public.can_see_booking(b public.bookings)
--   RETURNS boolean
--   LANGUAGE sql
--   STABLE
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--     SELECT public.is_workspace_member(b.workspace_id)
--        AND (
--          public.is_workspace_admin(b.workspace_id)
--          OR b.host_user_id = auth.uid()
--          OR (
--            public.has_permission(b.workspace_id, 'bookings.view')
--            AND public.permission_scope(b.workspace_id, 'bookings') = 'all'
--          )
--        );
--   $$;
--
-- Idempotente: CREATE OR REPLACE. No cambia la firma ni los permisos.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_see_booking(b public.bookings)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_workspace_member(b.workspace_id)
     AND (
       public.is_workspace_admin(b.workspace_id)
       OR b.host_user_id = auth.uid()
       OR EXISTS (
         SELECT 1
           FROM public.contacts c
          WHERE c.id = b.contact_id
            AND c.workspace_id = b.workspace_id
            AND c.setter_id = auth.uid()
            AND c.deleted_at IS NULL
       )
       OR (
         public.has_permission(b.workspace_id, 'bookings.view')
         AND public.permission_scope(b.workspace_id, 'bookings') = 'all'
       )
     );
$$;

REVOKE ALL ON FUNCTION public.can_see_booking(public.bookings) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_booking(public.bookings) TO authenticated, service_role;
