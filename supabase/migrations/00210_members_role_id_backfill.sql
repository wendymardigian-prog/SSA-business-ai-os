-- ============================================================================
-- 00210 — Equipo y roles (B1, F3): cada miembro queda con su rol de sistema
-- ============================================================================
-- Un miembro que entro por una invitacion (`finalizeAcceptInvite`) o por `create-owner.mjs` pudo
-- quedar con `role_id` nulo. El sistema lo trata como el rol de sistema que dice `role`, pero la
-- pantalla de Equipo y `has_permission` v2 (00208) lo entienden mejor con el `role_id` puesto.
--
-- Es el MISMO UPDATE de la 00088: a quien tiene `role_id` nulo se le pone el rol de sistema que
-- coincide con su `role` en ese workspace. No cambia ningun permiso (la funcion trata igual a un
-- Member sin `role_id` que a uno con la fila del rol de sistema Member).
--
-- Idempotente: una segunda corrida no encuentra nulos.
--
-- Control despues de aplicarla:
--   select count(*) from workspace_members where role_id is null;   -- 0
--
-- Como volver atras: poner `role_id = NULL` a los `user_id` que figuran abajo (los que tocó al
-- aplicarse; se anotan en docs/PROGRESS-equipo-roles.md). Volver atras no es necesario para nada.
-- ============================================================================

UPDATE public.workspace_members m
SET role_id = r.id
FROM public.workspace_roles r
WHERE r.workspace_id = m.workspace_id
  AND r.system_role = m.role
  AND m.role_id IS NULL;
