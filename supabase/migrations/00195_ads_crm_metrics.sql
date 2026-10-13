-- ============================================================================
-- 00195 — Tabla Meta vs CRM: `ads_crm_metrics`  (M9 del Extra L, AT4)
-- ============================================================================
-- Por cada campaña, conjunto o anuncio de Meta, lo que pasó DEL LADO DEL CRM: leads, agendas, ventas,
-- revenue y cash (ver el alcance v9, sección 4.3). Se cruza con el gasto de `meta_ads_insights_daily` en
-- el dashboard de Ads para sacar el costo por lead real, el ROAS, el CAC, etc.
--
--   public.ads_crm_metrics(p_level, p_since, p_until, p_ad_account_id, p_workspace_id)
--
-- - **SECURITY INVOKER**: la RLS de quien mira decide qué contactos, toques, agendas, ventas y pagos cuenta
--   (un Member con alcance `own` solo cuenta lo suyo). STABLE. `anon` no puede llamarla.
-- - Las fechas `p_since`/`p_until` son fechas civiles y se interpretan en la ZONA HORARIA DEL WORKSPACE
--   (`workspaces.timezone`); adentro se pasan a un rango UTC [desde, hasta). `p_workspace_id` es un parámetro
--   más que el plano no tenía (la función no puede adivinar el workspace del que mira): sin él devuelve vacío.
-- - Definiciones (por objeto = el id de Meta del nivel pedido, resuelto en `contact_touches.meta_<nivel>_id`):
--     leads_first         contactos (no borrados) cuyo PRIMER toque es del objeto y que se crearon en el rango.
--     leads_total         contactos distintos con algún toque del objeto cuyo `occurred_at` cae en el rango.
--                         (No es aditivo entre anuncios: un contacto que tocó dos anuncios cuenta en los dos.)
--     bookings            agendas creadas en el rango, sin las que se liberaron ("liberar espacio"); las canceladas
--                         normales SÍ cuentan (la agenda existió y costó). El objeto sale del toque `booking:<id>`;
--                         si no existe o no tiene objeto, del último toque del contacto con objeto anterior a la agenda.
--     bookings_attended   de esas, las de `status_group = 'outcome'` (seguimiento tibio o frío, venta, no calificado).
--     leads_with_booking  contactos distintos de esas agendas.
--     sales               ventas con `sale_date` en el rango, sin las `cancelled` ni `refunded`, cuyo
--                         `attribution_touch_id` es un toque del objeto.
--     revenue_cents       suma de `final_amount` de esas ventas, en centavos.
--     cash_cents          pagos `paid` con `paid_on` en el rango de ventas cuyo toque es del objeto; un reembolso es
--                         una fila negativa y resta.
--   Un objeto sin ningún dato en el rango no aparece. Con `p_ad_account_id` solo salen objetos de esa cuenta.
--
-- Índices nuevos: los de los filtros por fecha de agendas, ventas, pagos y contactos. (Los de `contact_touches`
-- por objeto ya los creó la 00192; `contact_touches (workspace_id, dedupe_key)` ya es único.)
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.ads_crm_metrics(text, date, date, text, uuid);
--   DROP INDEX IF EXISTS public.idx_bookings_ws_created, public.idx_sales_ws_sale_date,
--     public.idx_payments_ws_paid_on, public.idx_contacts_ws_created_alive;
-- Riesgo: bajo (aditiva; una funcion nueva y cuatro indices).
-- ============================================================================

SET search_path = '';

CREATE INDEX IF NOT EXISTS idx_bookings_ws_created
  ON public.bookings (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_ws_sale_date
  ON public.sales (workspace_id, sale_date);
CREATE INDEX IF NOT EXISTS idx_payments_ws_paid_on
  ON public.payments (workspace_id, paid_on) WHERE status = 'paid';
CREATE INDEX IF NOT EXISTS idx_contacts_ws_created_alive
  ON public.contacts (workspace_id, created_at) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ads_crm_metrics(
  p_level text,
  p_since date,
  p_until date,
  p_ad_account_id text DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS TABLE (
  object_id text,
  leads_first integer,
  leads_total integer,
  leads_with_booking integer,
  bookings integer,
  bookings_attended integer,
  sales integer,
  revenue_cents bigint,
  cash_cents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_col       text;
  v_cat_table text;
  v_cat_col   text;
  v_tz        text;
  v_lo        timestamptz;
  v_hi        timestamptz;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_metrics: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_metrics: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  -- El workspace tiene que ser visible para quien llama (RLS); si no, no hay nada que mostrar.
  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');

  -- Las fechas civiles del workspace, a un rango UTC [desde, hasta).
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- La columna del nivel sale de una lista fija (nunca del pedido): %I la cita como identificador.
  v_sql := format($q$
    WITH
    first_leads AS (
      SELECT c.attribution -> 'first_touch' ->> %1$L AS obj, count(*)::int AS n
        FROM public.contacts c
       WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
         AND c.created_at >= $2 AND c.created_at < $3
         AND c.attribution -> 'first_touch' ->> %1$L IS NOT NULL
       GROUP BY 1
    ),
    total_leads AS (
      SELECT t.%2$I AS obj, count(DISTINCT t.contact_id)::int AS n
        FROM public.contact_touches t
        JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
       WHERE t.workspace_id = $1 AND t.%2$I IS NOT NULL
         AND t.occurred_at >= $2 AND t.occurred_at < $3
       GROUP BY 1
    ),
    bk AS (
      SELECT b.id, b.contact_id, b.status_group,
             coalesce(
               (SELECT t.%2$I FROM public.contact_touches t
                 WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%2$I IS NOT NULL
                 LIMIT 1),
               (SELECT t.%2$I FROM public.contact_touches t
                 WHERE t.contact_id = b.contact_id AND t.%2$I IS NOT NULL AND t.occurred_at <= b.created_at
                 ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
                 LIMIT 1)
             ) AS obj
        FROM public.bookings b
       WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
         AND b.slot_released_at IS NULL
    ),
    booking_agg AS (
      SELECT obj,
             count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk WHERE obj IS NOT NULL GROUP BY obj
    ),
    sale_agg AS (
      SELECT t.%2$I AS obj,
             count(*)::int AS sales,
             coalesce(sum(round(s.final_amount * 100)), 0)::bigint AS revenue
        FROM public.sales s
        JOIN public.contact_touches t ON t.id = s.attribution_touch_id
       WHERE s.workspace_id = $1 AND s.sale_date >= $4 AND s.sale_date <= $5
         AND s.status NOT IN ('cancelled', 'refunded')
         AND t.%2$I IS NOT NULL
       GROUP BY 1
    ),
    cash_agg AS (
      SELECT t.%2$I AS obj, coalesce(sum(round(p.amount * 100)), 0)::bigint AS cash
        FROM public.payments p
        JOIN public.sales s ON s.id = p.sale_id
        JOIN public.contact_touches t ON t.id = s.attribution_touch_id
       WHERE p.workspace_id = $1 AND p.status = 'paid'
         AND p.paid_on >= $4 AND p.paid_on <= $5
         AND t.%2$I IS NOT NULL
       GROUP BY 1
    ),
    objs AS (
      SELECT obj FROM first_leads UNION SELECT obj FROM total_leads UNION SELECT obj FROM booking_agg
      UNION SELECT obj FROM sale_agg UNION SELECT obj FROM cash_agg
    )
    SELECT o.obj,
           coalesce(f.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           coalesce(sa.sales, 0), coalesce(sa.revenue, 0)::bigint, coalesce(ca.cash, 0)::bigint
      FROM objs o
      LEFT JOIN first_leads f ON f.obj = o.obj
      LEFT JOIN total_leads tl ON tl.obj = o.obj
      LEFT JOIN booking_agg ba ON ba.obj = o.obj
      LEFT JOIN sale_agg sa ON sa.obj = o.obj
      LEFT JOIN cash_agg ca ON ca.obj = o.obj
     WHERE $6::text IS NULL OR o.obj IN (
             SELECT x.%3$I FROM public.%4$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
           )
     ORDER BY o.obj
  $q$, v_col, v_col, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_metrics(text, date, date, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_metrics(text, date, date, text, uuid) TO authenticated, service_role;
