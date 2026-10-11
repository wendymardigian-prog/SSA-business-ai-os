-- ============================================================
-- 00161_sales_assignment.sql
--
-- Ventas, Fase 1 · B2 · F9: asignacion automatica de setter, vendedor y
-- referido, y las columnas que Ventas suma a `contacts` y `workspaces`.
--
-- Aditiva e idempotente. Lo unico que toca una tabla en uso es un trigger NUEVO
-- en `contacts` (`contacts_enqueue_sales_eval`): solo ENCOLA un job y atrapa
-- toda excepcion, asi que crear o editar un contacto nunca puede fallar por
-- esto. Los triggers que ya tiene `contacts` no se tocan.
--
--   assignment_rules   una fila por workspace y `kind` (setter, vendedor,
--                      referral). Todas arrancan en `manual`: no asignan nada
--                      hasta que alguien las configure.
--   contacts           referred_by_user_id, referred_by_contact_id,
--                      assignment_locked_at (lo manual bloquea lo automatico),
--                      payment_health (lo escribe el servidor, F31).
--   workspaces         max_discount_percent, overdue_grace_days,
--                      sales_auto_create_flows.
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contacts_enqueue_sales_eval ON public.contacts;
--   DROP FUNCTION IF EXISTS public.contacts_enqueue_sales_eval();
--   DROP TRIGGER IF EXISTS seed_sales_defaults ON public.workspaces;
--   DROP FUNCTION IF EXISTS public.seed_sales_defaults();
--   DROP TABLE IF EXISTS public.assignment_rules;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS referred_by_user_id,
--     DROP COLUMN IF EXISTS referred_by_contact_id, DROP COLUMN IF EXISTS assignment_locked_at,
--     DROP COLUMN IF EXISTS payment_health;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS max_discount_percent,
--     DROP COLUMN IF EXISTS overdue_grace_days, DROP COLUMN IF EXISTS sales_auto_create_flows;
-- ============================================================

-- ------------------------------------------------------------
-- 1. assignment_rules
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.assignment_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind                    text NOT NULL,
  entity_type             text NOT NULL DEFAULT 'contact',
  mode                    text NOT NULL DEFAULT 'manual',
  enabled_member_ids      uuid[] NOT NULL DEFAULT '{}',
  last_assigned_member_id uuid,
  condition_rules         jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.assignment_rules IS
  'Reglas de asignacion automatica de un contacto (Ventas, 00161): una fila por workspace y kind. Arrancan en manual. entity_type queda listo para booking y sale.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_kind_check') THEN
    ALTER TABLE public.assignment_rules ADD CONSTRAINT assignment_rules_kind_check
      CHECK (kind IN ('setter', 'vendedor', 'referral'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_entity_check') THEN
    ALTER TABLE public.assignment_rules ADD CONSTRAINT assignment_rules_entity_check
      CHECK (entity_type IN ('contact'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_mode_check') THEN
    ALTER TABLE public.assignment_rules ADD CONSTRAINT assignment_rules_mode_check
      CHECK (mode IN ('manual', 'round_robin', 'condition_based'));
  END IF;
  -- El referido no se reparte por turnos: es una persona o un contacto.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_referral_mode_check') THEN
    ALTER TABLE public.assignment_rules ADD CONSTRAINT assignment_rules_referral_mode_check
      CHECK (kind <> 'referral' OR mode <> 'round_robin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignment_rules_conditions_array_check') THEN
    ALTER TABLE public.assignment_rules ADD CONSTRAINT assignment_rules_conditions_array_check
      CHECK (jsonb_typeof(condition_rules) = 'array');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_assignment_rules_kind
  ON public.assignment_rules (workspace_id, kind, entity_type);

DROP TRIGGER IF EXISTS set_updated_at ON public.assignment_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.assignment_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.assignment_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_rules_select" ON public.assignment_rules;
CREATE POLICY "assignment_rules_select" ON public.assignment_rules
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "assignment_rules_insert" ON public.assignment_rules;
CREATE POLICY "assignment_rules_insert" ON public.assignment_rules
  FOR INSERT WITH CHECK (public.has_permission(workspace_id, 'settings.manage'));

DROP POLICY IF EXISTS "assignment_rules_update" ON public.assignment_rules;
CREATE POLICY "assignment_rules_update" ON public.assignment_rules
  FOR UPDATE USING (public.has_permission(workspace_id, 'settings.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'settings.manage'));

-- Sin policy de DELETE: la fila por kind es fija.
DROP POLICY IF EXISTS "assignment_rules_delete" ON public.assignment_rules;

-- ------------------------------------------------------------
-- 2. Columnas nuevas (todas nullable o con default)
-- ------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS referred_by_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referred_by_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_locked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS payment_health         jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.contacts.assignment_locked_at IS
  'Se escribe cuando alguien asigna a mano setter o vendedor: desde ahi la asignacion automatica no toca a este contacto (00161).';
COMMENT ON COLUMN public.contacts.payment_health IS
  'Salud de pago: {on_time, late, early, avg_delay_days, has_active_overdue, total_paid}. La recalcula el servidor al cobrar, revertir o pasar a moroso (F31).';

CREATE INDEX IF NOT EXISTS idx_contacts_referred_by_contact
  ON public.contacts (referred_by_contact_id) WHERE referred_by_contact_id IS NOT NULL;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS max_discount_percent    numeric(5,2),
  ADD COLUMN IF NOT EXISTS overdue_grace_days      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_auto_create_flows boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_max_discount_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_max_discount_check
      CHECK (max_discount_percent IS NULL OR (max_discount_percent >= 0 AND max_discount_percent <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_overdue_grace_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_overdue_grace_check
      CHECK (overdue_grace_days BETWEEN 0 AND 30);
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.max_discount_percent IS
  'Tope de descuento de una venta, en %. NULL = sin tope. Pasarlo exige alcance "todos" en Ventas (00161).';
COMMENT ON COLUMN public.workspaces.overdue_grace_days IS
  'Dias de gracia antes de marcar un pago moroso (0 a 30).';
COMMENT ON COLUMN public.workspaces.sales_auto_create_flows IS
  'Si Ventas crea apagados los flujos de cobranza precreados (F38).';

-- ------------------------------------------------------------
-- 3. Precarga por workspace: 3 reglas en modo manual
--    (mismo patron que seed_booking_categories, 00097)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_sales_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.assignment_rules (workspace_id, kind, entity_type, mode)
  VALUES (NEW.id, 'setter', 'contact', 'manual'),
         (NEW.id, 'vendedor', 'contact', 'manual'),
         (NEW.id, 'referral', 'contact', 'manual')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_sales_defaults ON public.workspaces;
CREATE TRIGGER seed_sales_defaults AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_sales_defaults();

-- Backfill para los workspaces que ya existen.
INSERT INTO public.assignment_rules (workspace_id, kind, entity_type, mode)
SELECT w.id, k.kind, 'contact', 'manual'
  FROM public.workspaces w
 CROSS JOIN (VALUES ('setter'), ('vendedor'), ('referral')) AS k(kind)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 4. El trigger de `contacts`: encola la evaluacion de asignacion
-- ------------------------------------------------------------
-- Si el workspace tiene alguna regla que no sea manual, un job `sales_contact_eval`
-- por contacto y atribucion (la clave incluye el md5 de la atribucion: dos
-- cambios iguales mientras el primero espera no hacen dos jobs). TODA excepcion se
-- atrapa: el alta de un contacto no puede fallar por esto.

CREATE OR REPLACE FUNCTION public.contacts_enqueue_sales_eval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM public.assignment_rules r
       WHERE r.workspace_id = NEW.workspace_id AND r.mode <> 'manual'
    ) THEN
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'sales_contact_eval',
        jsonb_build_object('contact_id', NEW.id, 'workspace_id', NEW.workspace_id),
        now(),
        'sales_eval:' || NEW.id::text || ':' || md5(coalesce(NEW.attribution::text, ''))
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contacts_enqueue_sales_eval: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_enqueue_sales_eval() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_enqueue_sales_eval ON public.contacts;
CREATE TRIGGER contacts_enqueue_sales_eval
  AFTER INSERT OR UPDATE OF attribution ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_enqueue_sales_eval();
