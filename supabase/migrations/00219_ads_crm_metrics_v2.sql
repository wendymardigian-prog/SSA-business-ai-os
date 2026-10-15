-- ============================================================================
-- 00219 — Tabla Meta vs CRM v2: sin contar dos veces y con el detalle de cada número  (Tirón 2, B2–B3)
-- ============================================================================
-- `ads_crm_metrics` (00195) sigue ahí, sin tocar, para volver atrás. Esta migración suma tres funciones:
--
--   public.ads_crm_items(nivel, métrica, período, cuenta, objeto…)   las FILAS que forman cada número
--   public.ads_crm_metrics_v2(nivel, período, cuenta, workspace)     los números, calculados SOBRE esas filas
--   public.ads_crm_cell_detail(nivel, métrica, …, límite, desplazamiento)   la lista de una celda, paginada
--
-- Una sola definición de «qué cuenta como un lead nuevo, un lead total, una agenda o una venta» (`ads_crm_items`):
-- el número de la tabla y la lista que abre al hacer clic salen de la MISMA consulta, así que no pueden diferir
-- (y `verify-ads-attribution.mjs` lo comprueba contra la base: cantidad de la lista = número de la celda).
--
-- Qué cambia respecto de `ads_crm_metrics`:
--   - Una fila extra con `is_total = true` (y `object_id` NULL): `leads_total` = personas DISTINTAS con algún toque de
--     cualquier objeto del filtro, y `leads_with_booking` = personas distintas con agenda. La tabla suma las filas, y
--     una persona que tocó dos anuncios cuenta dos veces en esa suma; esta fila la cuenta una. Se calcula dentro de la
--     misma consulta (sin una llamada extra). Lo demás del total (leads nuevos, agendas, ventas, revenue, cash) se SUMA:
--     cada persona tiene un solo primer toque, y cada agenda y cada venta caen en un solo objeto por nivel.
--   - `uf_cash_cents`: el primer pago cobrado (positivo) de cada venta atribuida al objeto, con fecha de cobro en el rango.
--   - Los objetos de la cuenta salen del catálogo Y de los insights de esa cuenta. Con el catálogo vacío (todavía no
--     sincronizó) la versión vieja descartaba TODAS las filas del CRM; esta no.
--   - `p_object_ids`: restringe a una lista de objetos (la tabla con un filtro de estado pide el distinto de los que se ven).
--
-- Definiciones (por objeto = el id de Meta del nivel pedido, `contact_touches.meta_<nivel>_id`), las mismas de 00195:
--   leads_new    contactos (no borrados) cuyo PRIMER toque es del objeto y que se crearon en el rango.
--   leads_total  contactos distintos con algún toque del objeto cuyo `occurred_at` cae en el rango.
--   bookings     agendas creadas en el rango, sin las liberadas; el objeto sale del toque `booking:<id>`, o del último
--                toque del contacto con objeto anterior a la agenda.
--   sales        ventas con `sale_date` en el rango, sin canceladas ni reembolsadas, cuyo `attribution_touch_id` es del objeto.
--   uf_cash      el primer pago cobrado (`status = 'paid'`, monto > 0, por fecha de cobro) de cada venta del objeto, si su
--                `paid_on` cae en el rango.
--
-- - SECURITY INVOKER todas: la RLS de quien mira decide qué contactos, toques, agendas, ventas y pagos cuenta (un Member
--   con alcance `own` solo cuenta lo suyo). STABLE. `anon` no puede llamarlas. `SET search_path = ''`.
-- - Las fechas son civiles y se interpretan en la zona horaria del workspace (`workspaces.timezone`).
-- - Sin `p_workspace_id`, o con un workspace que quien llama no ve, devuelven vacío.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.ads_crm_cell_detail(text, text, date, date, text, uuid, text, text[], integer, integer);
--   DROP FUNCTION IF EXISTS public.ads_crm_metrics_v2(text, date, date, text, uuid, text[]);
--   DROP FUNCTION IF EXISTS public.ads_crm_items(text, text, date, date, uuid, text, text, text[]);
--   (y volver el código a `ads_crm_metrics`, que no se tocó)
-- Riesgo: bajo (aditiva: tres funciones nuevas; ninguna tabla cambia).
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Las filas que forman cada número
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ads_crm_items(
  p_level text,
  p_metric text,
  p_since date,
  p_until date,
  p_workspace_id uuid,
  p_ad_account_id text DEFAULT NULL,
  p_object_id text DEFAULT NULL,
  p_object_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  obj text,
  contact_id uuid,
  item_id uuid,
  occurred_at timestamptz,
  origin text,
  detail_at timestamptz,
  amount_cents bigint
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
  v_acct      text;
  v_filter    text;
  v_sql       text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales', 'uf_cash') THEN
    RAISE EXCEPTION 'ads_crm_items: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_items: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  -- Los objetos de la cuenta: el catálogo Y los insights (con el catálogo vacío, solo el catálogo los dejaba a todos afuera).
  v_acct := format($q$
    WITH acct AS (
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    )
  $q$, v_cat_col, v_cat_table);

  -- Los mismos tres filtros en cada métrica: cuenta, un objeto, o una lista de objetos.
  v_filter := $q$
    ($6::text IS NULL OR x.obj IN (SELECT a.obj FROM acct a))
    AND ($8::text IS NULL OR x.obj = $8)
    AND ($9::text[] IS NULL OR x.obj = ANY($9))
  $q$;

  -- La columna del nivel sale de una lista fija (nunca del pedido): %1$I la cita como identificador, %2$L como texto.
  IF p_metric = 'leads_new' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT c.attribution -> 'first_touch' ->> %2$L AS obj,
                 c.id AS contact_id,
                 nullif(c.attribution -> 'first_touch' ->> 'occurred_at', '')::timestamptz AS occurred_at,
                 c.attribution -> 'first_touch' ->> 'origin' AS origin
            FROM public.contacts c
           WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
             AND c.created_at >= $2 AND c.created_at < $3
             AND c.attribution -> 'first_touch' ->> %2$L IS NOT NULL
        ) x
       WHERE %3$s
    $q$, v_col, v_col, v_filter);

  ELSIF p_metric = 'leads_total' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
        FROM (
          SELECT DISTINCT ON (t.%1$I, t.contact_id)
                 t.%1$I AS obj, t.contact_id, t.occurred_at, t.origin
            FROM public.contact_touches t
            JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
           WHERE t.workspace_id = $1 AND t.%1$I IS NOT NULL
             AND t.occurred_at >= $2 AND t.occurred_at < $3
           ORDER BY t.%1$I, t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
        ) x
       WHERE %2$s
    $q$, v_col, v_filter);

  ELSIF p_metric = 'bookings' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, x.start_at, NULL::bigint
        FROM (
          SELECT b.id, b.contact_id, b.start_at,
                 coalesce(bt.obj, lt.obj) AS obj,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.occurred_at ELSE lt.occurred_at END AS touch_at,
                 CASE WHEN bt.obj IS NOT NULL THEN bt.origin ELSE lt.origin END AS origin
            FROM public.bookings b
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%1$I IS NOT NULL
               LIMIT 1
            ) bt ON true
            LEFT JOIN LATERAL (
              SELECT t.%1$I AS obj, t.occurred_at, t.origin
                FROM public.contact_touches t
               WHERE bt.obj IS NULL
                 AND t.contact_id = b.contact_id AND t.%1$I IS NOT NULL AND t.occurred_at <= b.created_at
               ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
               LIMIT 1
            ) lt ON true
           WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
             AND b.slot_released_at IS NULL
        ) x
       WHERE x.obj IS NOT NULL AND %2$s
    $q$, v_col, v_filter);

  ELSIF p_metric = 'sales' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, (x.sale_date::timestamp AT TIME ZONE 'UTC'), x.amount_cents
        FROM (
          SELECT s.id, s.contact_id, s.sale_date, round(s.final_amount * 100)::bigint AS amount_cents,
                 t.%1$I AS obj, t.occurred_at AS touch_at, t.origin
            FROM public.sales s
            JOIN public.contact_touches t ON t.id = s.attribution_touch_id
           WHERE s.workspace_id = $1 AND s.sale_date >= $4 AND s.sale_date <= $5
             AND s.status NOT IN ('cancelled', 'refunded')
             AND t.%1$I IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_col, v_filter);

  ELSE -- uf_cash
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
        FROM (
          SELECT fp.id AS payment_id, s.contact_id,
                 t.%1$I AS obj, t.occurred_at AS touch_at, t.origin,
                 coalesce(fp.paid_at, (fp.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
                 round(fp.amount * 100)::bigint AS amount_cents
            FROM (
              SELECT DISTINCT ON (p.sale_id) p.id, p.sale_id, p.amount, p.paid_on, p.paid_at
                FROM public.payments p
               WHERE p.workspace_id = $1 AND p.status = 'paid' AND p.amount > 0
               ORDER BY p.sale_id, coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) ASC, p.id ASC
            ) fp
            JOIN public.sales s ON s.id = fp.sale_id
            JOIN public.contact_touches t ON t.id = s.attribution_touch_id
           WHERE fp.paid_on >= $4 AND fp.paid_on <= $5 AND t.%1$I IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_col, v_filter);
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_items(text, text, date, date, uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_items(text, text, date, date, uuid, text, text, text[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Los números de la tabla, calculados sobre esas filas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ads_crm_metrics_v2(
  p_level text,
  p_since date,
  p_until date,
  p_ad_account_id text DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_object_ids text[] DEFAULT NULL
)
RETURNS TABLE (
  object_id text,
  is_total boolean,
  leads_first integer,
  leads_total integer,
  leads_with_booking integer,
  bookings integer,
  bookings_attended integer,
  sales integer,
  revenue_cents bigint,
  cash_cents bigint,
  uf_cash_cents bigint
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
    RAISE EXCEPTION 'ads_crm_metrics_v2: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
    RAISE EXCEPTION 'ads_crm_metrics_v2: rango de fechas invalido' USING ERRCODE = '22023';
  END IF;
  IF p_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
  v_lo := p_since::timestamp AT TIME ZONE v_tz;
  v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;

  v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
  v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;

  v_sql := format($q$
    WITH
    acct AS (
      SELECT x.%3$I AS obj FROM public.%4$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
      UNION
      SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
    ),
    new_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_new',   $4, $5, $1, $6, NULL, $8)),
    tot_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_total', $4, $5, $1, $6, NULL, $8)),
    bk_items  AS (
      SELECT i.obj, i.contact_id, b.status_group
        FROM public.ads_crm_items($7, 'bookings', $4, $5, $1, $6, NULL, $8) i
        JOIN public.bookings b ON b.id = i.item_id
    ),
    sale_items AS (SELECT * FROM public.ads_crm_items($7, 'sales',    $4, $5, $1, $6, NULL, $8)),
    uf_items   AS (SELECT * FROM public.ads_crm_items($7, 'uf_cash',  $4, $5, $1, $6, NULL, $8)),
    new_agg  AS (SELECT obj, count(*)::int AS n FROM new_items GROUP BY obj),
    tot_agg  AS (SELECT obj, count(*)::int AS n FROM tot_items GROUP BY obj),
    bk_agg   AS (
      SELECT obj, count(*)::int AS bookings,
             (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
             count(DISTINCT contact_id)::int AS leads
        FROM bk_items GROUP BY obj
    ),
    sale_agg AS (SELECT obj, count(*)::int AS sales, coalesce(sum(amount_cents), 0)::bigint AS revenue FROM sale_items GROUP BY obj),
    uf_agg   AS (SELECT obj, coalesce(sum(amount_cents), 0)::bigint AS uf FROM uf_items GROUP BY obj),
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
      SELECT obj FROM new_agg UNION SELECT obj FROM tot_agg UNION SELECT obj FROM bk_agg
      UNION SELECT obj FROM sale_agg UNION SELECT obj FROM uf_agg UNION SELECT obj FROM cash_agg
    )
    SELECT o.obj, false,
           coalesce(n.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
           coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
           coalesce(sa.sales, 0), coalesce(sa.revenue, 0)::bigint, coalesce(ca.cash, 0)::bigint, coalesce(ua.uf, 0)::bigint
      FROM objs o
      LEFT JOIN new_agg n ON n.obj = o.obj
      LEFT JOIN tot_agg tl ON tl.obj = o.obj
      LEFT JOIN bk_agg ba ON ba.obj = o.obj
      LEFT JOIN sale_agg sa ON sa.obj = o.obj
      LEFT JOIN uf_agg ua ON ua.obj = o.obj
      LEFT JOIN cash_agg ca ON ca.obj = o.obj
     WHERE ($6::text IS NULL OR o.obj IN (SELECT a.obj FROM acct a))
       AND ($8::text[] IS NULL OR o.obj = ANY($8))
    UNION ALL
    -- La fila de total: personas DISTINTAS. Lo demas del total lo suma quien llama (es exacto).
    SELECT NULL::text, true,
           NULL::int,
           (SELECT count(DISTINCT contact_id)::int FROM tot_items),
           (SELECT count(DISTINCT contact_id)::int FROM bk_items),
           NULL::int, NULL::int, NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
    ORDER BY 2, 1
  $q$, v_col, v_col, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_ids;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_metrics_v2(text, date, date, text, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_metrics_v2(text, date, date, text, uuid, text[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. El detalle de una celda: las personas o registros que forman el número, de a 50
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ads_crm_cell_detail(
  p_level text,
  p_metric text,
  p_since date,
  p_until date,
  p_ad_account_id text DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_object_id text DEFAULT NULL,
  p_object_ids text[] DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  item_id uuid,
  contact_id uuid,
  contact_name text,
  occurred_at timestamptz,
  origin text,
  detail_at timestamptz,
  amount_cents bigint,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales') THEN
    RAISE EXCEPTION 'ads_crm_cell_detail: metrica invalida (%)', p_metric USING ERRCODE = '22023';
  END IF;

  -- La lista del TOTAL de «Leads totales» (sin un objeto): una persona que tocó dos anuncios es UNA fila, igual que en el número
  -- (la fila `is_total` de ads_crm_metrics_v2 cuenta personas distintas). En cualquier otra celda, una fila por registro.
  RETURN QUERY
  WITH src AS (
    SELECT i.item_id AS s_item, i.contact_id AS s_contact, i.occurred_at AS s_occurred, i.origin AS s_origin,
           i.detail_at AS s_detail, i.amount_cents AS s_amount,
           CASE WHEN p_metric = 'leads_total' AND p_object_id IS NULL
                THEN row_number() OVER (PARTITION BY i.contact_id ORDER BY i.occurred_at DESC NULLS LAST, i.obj)
                ELSE 1
           END AS rn
      FROM public.ads_crm_items(p_level, p_metric, p_since, p_until, p_workspace_id, p_ad_account_id, p_object_id, p_object_ids) i
  )
  SELECT s.s_item, s.s_contact, c.display_name, s.s_occurred, s.s_origin, s.s_detail, s.s_amount,
         count(*) OVER ()
    FROM src s
    LEFT JOIN public.contacts c ON c.id = s.s_contact
   WHERE s.rn = 1
   ORDER BY s.s_occurred DESC NULLS LAST, s.s_item
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_cell_detail(text, text, date, date, text, uuid, text, text[], integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_cell_detail(text, text, date, date, text, uuid, text, text[], integer, integer) TO authenticated, service_role;
