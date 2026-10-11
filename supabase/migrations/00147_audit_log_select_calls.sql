-- ============================================================================
-- 00147 — Historial de llamadas: una politica de lectura APARTE sobre audit_log
-- ============================================================================
-- Hoy un Member solo ve en el historial lo que hizo el mismo (mas lo de
-- agentes sobre contactos y conversaciones, y lo de agendas). Las entradas que
-- escribe el SISTEMA sobre una llamada (el analisis automatico, la
-- clasificacion) no las veria el closer de su propia llamada.
--
-- Se suma una politica de lectura NUEVA, que solo aplica a las filas
-- `entity_type = 'call'`: las ve quien ve la llamada (`can_see_call_id`).
-- Postgres combina las politicas permisivas con "o": lo que cada rol ve hoy NO
-- puede achicarse, y lo que no es una llamada no cambia.
--
-- `audit_log_select` NO se toca ni una coma. Convencion para los demas modulos
-- (Formularios, Ventas, CX, Gastos): cada modulo suma su propia politica
-- `audit_log_select_<modulo>`; nadie reescribe `audit_log_select`.
--
-- Se aplica DESPUES de `node scripts/verify-audit-visibility.mjs` en verde, y se
-- vuelve a correr despues (con --despues-de-00147).
--
-- Aditiva e idempotente.
--
-- Como volver atras:
--   DROP POLICY IF EXISTS audit_log_select_calls ON public.audit_log;
-- ============================================================================

DROP POLICY IF EXISTS audit_log_select_calls ON public.audit_log;
CREATE POLICY audit_log_select_calls ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id)
    AND entity_type = 'call'
    AND public.can_see_call_id(entity_id)
  );
