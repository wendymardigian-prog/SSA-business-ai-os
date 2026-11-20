-- 00507: los eventos de ventas y pagos llevan la variante y el estado de pago de la venta.
--
-- Para que los disparadores de Automatizaciones filtren por «estado de pago de la venta» (Reservada, Pagada…) y por
-- variante en todos los de Ventas. Aditiva: solo suma claves al payload (los filtros viejos no las miran). No toca
-- `create_sale` (protegida): la venta ya nace con su estado calculado de los pagos del plan, así que `sale_created`
-- lo lleva tal cual.
--
-- - `sales_event_payload` suma `sale_status` (el estado de la venta en ese momento).
-- - `payments_event_payload` suma `variant_id` y `sale_status`. El trigger de eventos de pagos corre ANTES de que
--   se recalcule la venta (`payments_emit_status_change` < `payments_refresh_sale_status`, por nombre), así que el
--   estado se DERIVA con los pagos de ahora (el de esta fila incluido): es el mismo que va a quedar guardado. Dentro de
--   create_sale (que no recalcula fila por fila) se usa el estado con el que nació la venta.
--   `derive_sale_status` respeta los estados escritos (cancelada, reembolsada…), igual que `refresh_sale_status`.
--
-- Definiciones anteriores (leídas de la base el 20/11/2026), para volver atrás:
--
-- CREATE OR REPLACE FUNCTION public.sales_event_payload(s sales)
--  RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
-- AS $function$
--   SELECT jsonb_strip_nulls(jsonb_build_object(
--     'sale_id', s.id,
--     'contact_id', s.contact_id,
--     'product_id', s.product_snapshot ->> 'product_id',
--     'variant_id', s.product_snapshot ->> 'variant_id',
--     'vendedor_id', s.vendedor_id,
--     'setter_id', s.setter_id,
--     'financing_type', s.financing_type,
--     'final_amount', s.final_amount,
--     'attribution_type', s.attribution_type,
--     'utm_source', s.attribution ->> 'source',
--     'utm_medium', s.attribution ->> 'medium',
--     'utm_campaign', s.attribution ->> 'campaign'
--   ));
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.payments_event_payload(p payments)
--  RETURNS jsonb LANGUAGE sql STABLE SET search_path TO ''
-- AS $function$
--   SELECT jsonb_strip_nulls(jsonb_build_object(
--     'payment_id', p.id,
--     'sale_id', p.sale_id,
--     'contact_id', (SELECT s.contact_id FROM public.sales s WHERE s.id = p.sale_id),
--     'product_id', (SELECT s.product_snapshot ->> 'product_id' FROM public.sales s WHERE s.id = p.sale_id),
--     'payment_type', p.type,
--     'payment_method', p.payment_method,
--     'amount', p.amount,
--     'status', p.status
--   ));
-- $function$;

CREATE OR REPLACE FUNCTION public.sales_event_payload(s public.sales)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'sale_id', s.id,
    'contact_id', s.contact_id,
    'product_id', s.product_snapshot ->> 'product_id',
    'variant_id', s.product_snapshot ->> 'variant_id',
    'vendedor_id', s.vendedor_id,
    'setter_id', s.setter_id,
    'financing_type', s.financing_type,
    'final_amount', s.final_amount,
    'attribution_type', s.attribution_type,
    'utm_source', s.attribution ->> 'source',
    'utm_medium', s.attribution ->> 'medium',
    'utm_campaign', s.attribution ->> 'campaign',
    'sale_status', s.status
  ));
$$;

CREATE OR REPLACE FUNCTION public.payments_event_payload(p public.payments)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'payment_id', p.id,
    'sale_id', p.sale_id,
    'contact_id', s.contact_id,
    'product_id', s.product_snapshot ->> 'product_id',
    'variant_id', s.product_snapshot ->> 'variant_id',
    'payment_type', p.type,
    'payment_method', p.payment_method,
    'amount', p.amount,
    'status', p.status,
    'sale_status', CASE
      -- Dentro de create_sale la venta ya nace con su estado final (calculado con TODOS los pagos del plan); derivar
      -- con los pagos insertados hasta ahora daría un estado intermedio.
      WHEN current_setting('ssa.suppress_sale_refresh', true) = 'on' THEN s.status
      ELSE public.derive_sale_status(
        s.status, s.financing_type, s.final_amount,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('type', x.type, 'status', x.status, 'amount', x.amount)), '[]'::jsonb)
           FROM public.payments x WHERE x.sale_id = p.sale_id))
    END
  ))
  FROM (SELECT 1) AS one
  LEFT JOIN public.sales s ON s.id = p.sale_id;
$$;
