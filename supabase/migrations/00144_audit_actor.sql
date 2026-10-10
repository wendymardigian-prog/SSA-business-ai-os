-- ============================================================================
-- 00144 — Historial transversal: quien hizo cada cosa (persona, agente, sistema, webhook)
-- ============================================================================
-- Llamadas (F1) crea lo transversal del historial que despues usan Formularios,
-- Ventas, CX y Gastos:
--
--   - audit_log.actor_type   'user' | 'agent' | 'system' | 'webhook' (default 'user')
--   - audit_log.actor_label  nombre legible de un actor que no es una persona
--                            ("Analisis automatico", "Fathom")
--   - indice (workspace_id, entity_type, entity_id, performed_at DESC), que es
--     como se lee el historial de UNA entidad.
--
-- No hay backfill: las filas viejas toman 'user' por el default. Las de agente
-- (performed_by_agent_id no nulo) y las de sistema (performed_by nulo) se
-- muestran bien igual, porque <Historial/> decide el actor con
-- `effectiveActorType(row)` (lib/audit-history.ts) y no con esta columna sola.
--
-- NO se toca ninguna policy: `audit_log_select` queda exactamente como esta.
--
-- Aditiva e idempotente. Se puede aplicar antes de desplegar el codigo: el
-- codigo viejo no lee ni escribe estas columnas.
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_audit_log_entity;
--   ALTER TABLE public.audit_log DROP COLUMN IF EXISTS actor_label;
--   ALTER TABLE public.audit_log DROP COLUMN IF EXISTS actor_type;
-- ============================================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'user';

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS actor_label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_log_actor_type_check'
      AND conrelid = 'public.audit_log'::regclass
  ) THEN
    ALTER TABLE public.audit_log
      ADD CONSTRAINT audit_log_actor_type_check
      CHECK (actor_type IN ('user', 'agent', 'system', 'webhook'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (workspace_id, entity_type, entity_id, performed_at DESC);

COMMENT ON COLUMN public.audit_log.actor_type IS
  'Quien hizo la accion: user (una persona), agent (agente de IA), system (proceso interno) o webhook (un proveedor). Las filas anteriores a la 00144 tienen user por el default: usar effectiveActorType() para leerlas.';
COMMENT ON COLUMN public.audit_log.actor_label IS
  'Nombre legible del actor cuando no es una persona (ej: "Analisis automatico", "Fathom").';
