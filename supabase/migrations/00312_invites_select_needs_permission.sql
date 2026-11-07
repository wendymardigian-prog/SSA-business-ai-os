-- ============================================================
-- 00312_invites_select_needs_permission (7/11/2026)
--
-- Auditoria de seguridad. `workspace_invites_select` (00006) dejaba leer las
-- invitaciones a CUALQUIER miembro, y el `id` de una invitacion es el link
-- `/invite/<id>`: la credencial. Un Member podia leer el link de una
-- invitacion de Admin pendiente para un email sin cuenta, crear esa cuenta
-- con su propia contrasena (registerFromInvite) y entrar como Admin.
--
-- Ahora las ve solo quien puede invitar (`team.invite`), que es quien las
-- muestra en Ajustes -> Equipo (el resto de la app las lee con el cliente de
-- servicio). Mismo patron que `workspace_invites_insert/update/delete`.
--
-- Politica vieja (00006), copiada de la base el 7/11/2026:
--   CREATE POLICY "workspace_invites_select" ON workspace_invites
--     FOR SELECT USING (workspace_id IN (
--       SELECT workspace_members.workspace_id FROM workspace_members
--       WHERE workspace_members.user_id = auth.uid()));
--
-- Idempotente. Puede ir antes o despues del deploy.
-- ============================================================

DROP POLICY IF EXISTS "workspace_invites_select" ON public.workspace_invites;
CREATE POLICY "workspace_invites_select" ON public.workspace_invites
  FOR SELECT USING ((SELECT public.has_permission(workspace_invites.workspace_id, 'team.invite')));
