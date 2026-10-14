-- ============================================================================
-- 00213 — Equipo y roles (B4, F17-F18): Ajustes, integraciones y canales por permiso
-- ============================================================================
-- Estas tablas pedian `is_workspace_admin` (el cargo). Pasan a pedir el permiso de lo que son, asi un rol
-- personalizado puede administrar solo lo suyo y la base lo repite aunque alguien se saltee la pantalla.
--
--   custom_field_definitions   INSERT / UPDATE   custom_fields.manage
--   integration_configs        SELECT            integrations.view | integrations.manage (y, para las filas de canales, channels.manage)
--                              INSERT/UPDATE/DELETE  integrations.manage (y, para las filas de canales, channels.manage)
--   social_accounts            INSERT/UPDATE/DELETE  integrations.manage
--   channels                   INSERT/UPDATE/DELETE  channels.manage
--   csv_imports                SELECT: la rama de Admin pasa a contacts.import (quien importo sigue viendo lo suyo)
--   audit_log                  `audit_log_select` NO SE TOCA. Se SUMA `audit_log_select_audit` (como Llamadas, Ventas y Tareas):
--                              quien tiene `audit.view` ve todo el historial del workspace.
--
-- Owner y Admin (que tienen todas las claves) dan exactamente lo mismo que antes. Un Member de sistema no tiene
-- ninguna de estas claves: tampoco cambia. `workspaces` NO se toca (sigue solo Admin: las acciones de Ajustes
-- escriben con el cliente de servicio DESPUES del guard).
--
-- Las filas de canales de `integration_configs` son las de `type = 'channel'` y el email entrante
-- (`provider = 'resend_inbound'`): `channels.manage` llega a esas y a ninguna otra.
--
-- Se aplica DESPUES de desplegar el codigo del bloque B4. Idempotente: DROP POLICY IF EXISTS + CREATE.
--
-- ----------------------------------------------------------------------------
-- COMO VOLVER ATRAS: ejecutar, sin el prefijo "--   ", lo siguiente (definiciones vigentes ANTES de esta migracion,
-- leidas de la base viva), y `DROP POLICY IF EXISTS audit_log_select_audit ON public.audit_log;`
-- ----------------------------------------------------------------------------
--   DROP POLICY IF EXISTS custom_field_definitions_insert ON public.custom_field_definitions;
--   CREATE POLICY custom_field_definitions_insert ON public.custom_field_definitions AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS custom_field_definitions_update ON public.custom_field_definitions;
--   CREATE POLICY custom_field_definitions_update ON public.custom_field_definitions AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS integration_configs_select ON public.integration_configs;
--   CREATE POLICY integration_configs_select ON public.integration_configs AS PERMISSIVE FOR SELECT TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS integration_configs_insert ON public.integration_configs;
--   CREATE POLICY integration_configs_insert ON public.integration_configs AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS integration_configs_update ON public.integration_configs;

--
--   DROP POLICY IF EXISTS integration_configs_delete ON public.integration_configs;
--   CREATE POLICY integration_configs_delete ON public.integration_configs AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS social_accounts_insert ON public.social_accounts;
--   CREATE POLICY social_accounts_insert ON public.social_accounts AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS social_accounts_update ON public.social_accounts;
--   CREATE POLICY social_accounts_update ON public.social_accounts AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS social_accounts_delete ON public.social_accounts;
--   CREATE POLICY social_accounts_delete ON public.social_accounts AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS channels_insert ON public.channels;
--   CREATE POLICY channels_insert ON public.channels AS PERMISSIVE FOR INSERT TO public
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS channels_update ON public.channels;
--   CREATE POLICY channels_update ON public.channels AS PERMISSIVE FOR UPDATE TO public
--     USING (is_workspace_admin(workspace_id))
--     WITH CHECK (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS channels_delete ON public.channels;
--   CREATE POLICY channels_delete ON public.channels AS PERMISSIVE FOR DELETE TO public
--     USING (is_workspace_admin(workspace_id));
--
--   DROP POLICY IF EXISTS csv_imports_select ON public.csv_imports;
--   CREATE POLICY csv_imports_select ON public.csv_imports AS PERMISSIVE FOR SELECT TO public
--     USING ((is_workspace_admin(workspace_id) OR (is_workspace_member(workspace_id) AND (imported_by = auth.uid()))));
--
-- ============================================================================

-- Campos personalizados
DROP POLICY IF EXISTS custom_field_definitions_insert ON public.custom_field_definitions;
CREATE POLICY custom_field_definitions_insert ON public.custom_field_definitions FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'custom_fields.manage')));
DROP POLICY IF EXISTS custom_field_definitions_update ON public.custom_field_definitions;
CREATE POLICY custom_field_definitions_update ON public.custom_field_definitions FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'custom_fields.manage')))
  WITH CHECK ((select public.has_permission(workspace_id, 'custom_fields.manage')));

-- Integraciones: ver el estado / administrar. Los canales tambien con channels.manage.
DROP POLICY IF EXISTS integration_configs_select ON public.integration_configs;
CREATE POLICY integration_configs_select ON public.integration_configs FOR SELECT
  USING (
    (select public.has_permission(workspace_id, 'integrations.view'))
    OR (select public.has_permission(workspace_id, 'integrations.manage'))
    OR (
      (type = 'channel' OR provider = 'resend_inbound')
      AND (select public.has_permission(workspace_id, 'channels.manage'))
    )
  );
DROP POLICY IF EXISTS integration_configs_insert ON public.integration_configs;
CREATE POLICY integration_configs_insert ON public.integration_configs FOR INSERT
  WITH CHECK (
    (select public.has_permission(workspace_id, 'integrations.manage'))
    OR (
      (type = 'channel' OR provider = 'resend_inbound')
      AND (select public.has_permission(workspace_id, 'channels.manage'))
    )
  );
DROP POLICY IF EXISTS integration_configs_update ON public.integration_configs;
CREATE POLICY integration_configs_update ON public.integration_configs FOR UPDATE
  USING (
    (select public.has_permission(workspace_id, 'integrations.manage'))
    OR (
      (type = 'channel' OR provider = 'resend_inbound')
      AND (select public.has_permission(workspace_id, 'channels.manage'))
    )
  )
  WITH CHECK (
    (select public.has_permission(workspace_id, 'integrations.manage'))
    OR (
      (type = 'channel' OR provider = 'resend_inbound')
      AND (select public.has_permission(workspace_id, 'channels.manage'))
    )
  );
DROP POLICY IF EXISTS integration_configs_delete ON public.integration_configs;
CREATE POLICY integration_configs_delete ON public.integration_configs FOR DELETE
  USING (
    (select public.has_permission(workspace_id, 'integrations.manage'))
    OR (
      (type = 'channel' OR provider = 'resend_inbound')
      AND (select public.has_permission(workspace_id, 'channels.manage'))
    )
  );

-- Cuentas sociales
DROP POLICY IF EXISTS social_accounts_insert ON public.social_accounts;
CREATE POLICY social_accounts_insert ON public.social_accounts FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'integrations.manage')));
DROP POLICY IF EXISTS social_accounts_update ON public.social_accounts;
CREATE POLICY social_accounts_update ON public.social_accounts FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'integrations.manage')))
  WITH CHECK ((select public.has_permission(workspace_id, 'integrations.manage')));
DROP POLICY IF EXISTS social_accounts_delete ON public.social_accounts;
CREATE POLICY social_accounts_delete ON public.social_accounts FOR DELETE
  USING ((select public.has_permission(workspace_id, 'integrations.manage')));

-- Canales
DROP POLICY IF EXISTS channels_insert ON public.channels;
CREATE POLICY channels_insert ON public.channels FOR INSERT
  WITH CHECK ((select public.has_permission(workspace_id, 'channels.manage')));
DROP POLICY IF EXISTS channels_update ON public.channels;
CREATE POLICY channels_update ON public.channels FOR UPDATE
  USING ((select public.has_permission(workspace_id, 'channels.manage')))
  WITH CHECK ((select public.has_permission(workspace_id, 'channels.manage')));
DROP POLICY IF EXISTS channels_delete ON public.channels;
CREATE POLICY channels_delete ON public.channels FOR DELETE
  USING ((select public.has_permission(workspace_id, 'channels.manage')));

-- Importaciones: solo la rama de Admin pasa a permiso; quien importo sigue viendo lo suyo.
DROP POLICY IF EXISTS csv_imports_select ON public.csv_imports;
CREATE POLICY csv_imports_select ON public.csv_imports FOR SELECT
  USING (
    (select public.has_permission(workspace_id, 'contacts.import'))
    OR (public.is_workspace_member(workspace_id) AND imported_by = auth.uid())
  );

-- Historial: una politica ADICIONAL (audit_log_select no se toca). Las permisivas se combinan con "o".
DROP POLICY IF EXISTS audit_log_select_audit ON public.audit_log;
CREATE POLICY audit_log_select_audit ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND (select public.has_permission(workspace_id, 'audit.view'))
  );
