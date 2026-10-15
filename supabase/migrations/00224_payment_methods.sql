-- ============================================================================
-- 00224 — Métodos de pago del negocio (Extra I, bloque MP, F1)
-- ============================================================================
-- Hasta hoy los metodos de pago eran 5 claves escritas a fuego en un CHECK. Ahora el negocio crea los
-- suyos, con su porcentaje y su fijo, y cada pago cobrado congela lo que se quedo el procesador.
--
-- 1. `workspaces.payment_methods` (jsonb, array): [{ key, name, fee_percent, fee_fixed, active, created_at }].
--    Relleno SOLO al crear la columna: los 5 de siempre, con comision 0, y `active` = estaba en
--    `enabled_payment_methods`. Esa columna vieja QUEDA (nadie la lee, no se borra).
-- 2. `payments.provider_fee_percent` y `payments.provider_fee_fixed`: el porcentaje y el fijo con los que se
--    calculo la comision al cobrar, congelados junto con `provider_fee_amount` (el total). Solo en un pago
--    cobrado y que no sea reembolso.
-- 3. El CHECK fijo `payments_method_check` se reemplaza por el trigger `payments_validate_method`: el metodo
--    tiene que existir en `workspaces.payment_methods` del mismo workspace (ACTIVO O NO: un pago viejo con un
--    metodo desactivado se sigue pudiendo editar; "solo activos en pagos nuevos" lo decide la app).
--    Error: ERRCODE 'PM001'.
-- 4. Trigger `payments_fee_spec_from_snapshot`: `create_sale` (protegida, no se toca) inserta los pagos con
--    una lista fija de columnas que no incluye las dos nuevas; este trigger las copia del
--    `payment_option_snapshot` (que la app ya manda) cuando el pago nace o pasa a cobrado. Y las deja en null
--    si el pago NO esta cobrado (asi el codigo viejo, que al revertir no las conoce, no choca con el CHECK).
--    Envuelto en EXCEPTION: nunca tumba un cobro.
-- 5. `public.workspace_payment_method(ws, key)`: el elemento de la lista o null.
--
-- Definicion VIGENTE del CHECK que se reemplaza (leida de la base con pg_get_constraintdef el 15/10/2026):
--   payments_method_check:
--   CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['whop'::text, 'transferencia_cr'::text,
--           'transferencia_usa'::text, 'wise'::text, 'binance'::text]))))
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS payments_validate_method ON public.payments;
--   DROP TRIGGER IF EXISTS payments_fee_spec_from_snapshot ON public.payments;
--   DROP FUNCTION IF EXISTS private.payments_validate_method();
--   DROP FUNCTION IF EXISTS private.payments_fee_spec_from_snapshot();
--   DROP FUNCTION IF EXISTS public.workspace_payment_method(uuid, text);
--   ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
--     CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['whop'::text, 'transferencia_cr'::text,
--     'transferencia_usa'::text, 'wise'::text, 'binance'::text]))));
--   (antes, comprobar que ningun pago use un metodo fuera de esos 5)
--   Las columnas nuevas pueden quedar. El codigo viejo vuelve a leer `enabled_payment_methods`, que nunca se tocó.
-- Riesgo: ALTO (cambia la regla que valida el metodo del cobro). Hay 0 pagos, no hay datos en juego; el codigo
-- viejo sigue funcionando contra la base nueva (los 5 metodos siguen siendo validos).
-- ============================================================================

SET search_path = '';

-- 1. Metodos del negocio ---------------------------------------------------------------------------------
DO $$
DECLARE
  v_is_new boolean := NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'payment_methods'
  );
BEGIN
  IF v_is_new THEN
    ALTER TABLE public.workspaces
      ADD COLUMN payment_methods jsonb NOT NULL DEFAULT '[
        {"key":"whop","name":"Whop (registrado a mano)","fee_percent":0,"fee_fixed":0,"active":true,"created_at":"2026-10-15T00:00:00.000Z"},
        {"key":"transferencia_cr","name":"Transferencia CR","fee_percent":0,"fee_fixed":0,"active":true,"created_at":"2026-10-15T00:00:00.000Z"},
        {"key":"transferencia_usa","name":"Transferencia USA","fee_percent":0,"fee_fixed":0,"active":true,"created_at":"2026-10-15T00:00:00.000Z"},
        {"key":"wise","name":"Wise","fee_percent":0,"fee_fixed":0,"active":true,"created_at":"2026-10-15T00:00:00.000Z"},
        {"key":"binance","name":"Binance","fee_percent":0,"fee_fixed":0,"active":true,"created_at":"2026-10-15T00:00:00.000Z"}
      ]'::jsonb;

    -- Relleno: `active` = estaba habilitado en la lista vieja de cada workspace.
    UPDATE public.workspaces w
       SET payment_methods = (
         SELECT jsonb_agg(
                  jsonb_build_object(
                    'key', m.key, 'name', m.name, 'fee_percent', 0, 'fee_fixed', 0,
                    'active', m.key = ANY (w.enabled_payment_methods),
                    'created_at', '2026-10-15T00:00:00.000Z')
                  ORDER BY m.ord)
           FROM (VALUES
             (1, 'whop', 'Whop (registrado a mano)'),
             (2, 'transferencia_cr', 'Transferencia CR'),
             (3, 'transferencia_usa', 'Transferencia USA'),
             (4, 'wise', 'Wise'),
             (5, 'binance', 'Binance')
           ) AS m(ord, key, name)
       );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_payment_methods_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_payment_methods_check
      CHECK (jsonb_typeof(payment_methods) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.payment_methods IS
  'Metodos de pago del negocio: [{key,name,fee_percent,fee_fixed,active,created_at}]. La key no cambia nunca; no se borran, se desactivan. Los escribe `updatePaymentMethods` (sales.settings). `enabled_payment_methods` quedo sin leerse.';

-- 2. Lo que se quedo el procesador, congelado en el pago ------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS provider_fee_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS provider_fee_fixed numeric(12,2);

COMMENT ON COLUMN public.payments.provider_fee_percent IS 'Porcentaje del procesador con el que se calculo la comision al cobrar (congelado).';
COMMENT ON COLUMN public.payments.provider_fee_fixed IS 'Fijo en USD del procesador con el que se calculo la comision al cobrar (congelado).';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_fee_spec_only_paid_check' AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_fee_spec_only_paid_check
      CHECK (status = 'paid' OR (provider_fee_percent IS NULL AND provider_fee_fixed IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refund_fee_spec_check' AND conrelid = 'public.payments'::regclass) THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_refund_fee_spec_check
      CHECK (type <> 'refund' OR (provider_fee_percent IS NULL AND provider_fee_fixed IS NULL));
  END IF;
END $$;

-- 3. El metodo tiene que existir en la lista del negocio (activo o no) -----------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;

CREATE OR REPLACE FUNCTION private.payments_validate_method()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.payment_method IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.workspaces w, jsonb_array_elements(w.payment_methods) AS m
     WHERE w.id = NEW.workspace_id
       AND m ->> 'key' = NEW.payment_method
  ) THEN
    RAISE EXCEPTION 'El metodo de pago % no existe en este negocio', NEW.payment_method
      USING ERRCODE = 'PM001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.payments_validate_method() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_validate_method ON public.payments;
CREATE TRIGGER payments_validate_method
  BEFORE INSERT OR UPDATE OF payment_method ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.payments_validate_method();

-- 4. %, fijo y total viajan juntos -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.payments_fee_spec_from_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Fuera de un cobro (o en un reembolso) el porcentaje y el fijo no existen.
  IF NEW.status <> 'paid' OR NEW.type = 'refund' THEN
    NEW.provider_fee_percent := NULL;
    NEW.provider_fee_fixed := NULL;
    RETURN NEW;
  END IF;

  -- Cobrado y sin los dos valores: salen de la foto del metodo al cobrar.
  IF NEW.provider_fee_percent IS NULL AND NEW.provider_fee_fixed IS NULL AND NEW.payment_option_snapshot IS NOT NULL THEN
    NEW.provider_fee_percent := NULLIF(NEW.payment_option_snapshot ->> 'provider_fee_percent', '')::numeric;
    NEW.provider_fee_fixed := NULLIF(NEW.payment_option_snapshot ->> 'provider_fee_fixed', '')::numeric;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Esto nunca tumba un cobro: sin los dos valores, el pago sigue valido (solo falta el desglose).
  RAISE WARNING 'payments_fee_spec_from_snapshot: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.payments_fee_spec_from_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_fee_spec_from_snapshot ON public.payments;
CREATE TRIGGER payments_fee_spec_from_snapshot
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.payments_fee_spec_from_snapshot();

-- 5. Un metodo por clave ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.workspace_payment_method(p_workspace uuid, p_key text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m
    FROM public.workspaces w, jsonb_array_elements(w.payment_methods) AS m
   WHERE w.id = p_workspace
     AND m ->> 'key' = p_key
     AND (COALESCE(auth.role(), '') = 'service_role' OR public.is_workspace_member(p_workspace))
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.workspace_payment_method(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_payment_method(uuid, text) TO authenticated, service_role;
