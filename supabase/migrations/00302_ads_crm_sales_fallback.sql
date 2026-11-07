-- ============================================================================
-- 00302 — Tabla Meta vs CRM: la venta sin anuncio en su toque hereda el último toque con anuncio
-- ============================================================================
-- Por qué: una venta guarda por defecto el toque más reciente del contacto. Si ese toque no tiene anuncio, la venta no le
-- contaba a ninguno, aunque un anuncio hubiera traído a la persona. Al medirlo (6/11/2026, con 0 ventas cargadas, simulando
-- una venta por contacto): de 89 contactos con un toque de Meta, 41 tenían como último toque otra cosa, 39 de ellos «Grupo
-- de WhatsApp». Las agendas ya resolvían esto (00219) buscando el último toque con objeto; Ventas, Revenue, Cash y UF cash no.
--
-- La regla (por nivel: campaña, conjunto o anuncio, igual que las agendas):
--   1. Si el toque guardado en la venta (`attribution_touch_id`) tiene un objeto en ese nivel, cuenta ese.
--   2. Si no, y la venta NO es `manual` (es decir, `last_touch` o `none`), el último toque del contacto con un objeto en ese nivel,
--      anterior a la venta: hasta que se guardó (`created_at`) y antes de que termine el día de la venta (`sale_date`, en la
--      zona del workspace). Una venta cargada con fecha vieja no toma toques posteriores a esa fecha. Sin límite de antigüedad.
--   3. Una venta `manual` es la decisión de una persona (elegida del historial, cargada a mano o la sugerencia aplicada): cuenta
--      SOLO su toque. Si no tiene anuncio (un referido, un evento), no le cuenta a ninguno.
--
-- Lo guardado en la venta NO cambia: `sales.attribution`, `attribution_touch_id`, la ficha, la lista de Ventas y las comisiones
-- siguen igual. `create_sale` y las demás funciones protegidas no se tocan. `ads_crm_metrics` (v1) tampoco.
--
-- Qué cambia en las funciones (misma firma, ninguna tabla):
--   - `ads_crm_items`: una sola búsqueda del toque de la venta (`v_sale_touch`) para `sales` y `uf_cash`, y una métrica nueva, `cash`.
--   - `ads_crm_metrics_v2`: el Cash sale de `ads_crm_items` en vez de tener su propio cruce: no puede quedar distinto de Ventas.
--   - `ads_crm_cell_detail` no cambia: lee de `ads_crm_items` (la lista abre lo mismo que cuenta la celda) y sigue sin aceptar `cash`.
--
-- Se puede aplicar antes o después del código: el código solo cambia textos.
-- Riesgo: bajo. Como volver atrás: ejecutar las dos definiciones viejas de abajo, que son las de la 00219 (leídas también de la base).
--
-- Definición vieja de ads_crm_items:
--
--   CREATE OR REPLACE FUNCTION public.ads_crm_items(
--     p_level text,
--     p_metric text,
--     p_since date,
--     p_until date,
--     p_workspace_id uuid,
--     p_ad_account_id text DEFAULT NULL,
--     p_object_id text DEFAULT NULL,
--     p_object_ids text[] DEFAULT NULL
--   )
--   RETURNS TABLE (
--     obj text,
--     contact_id uuid,
--     item_id uuid,
--     occurred_at timestamptz,
--     origin text,
--     detail_at timestamptz,
--     amount_cents bigint
--   )
--   LANGUAGE plpgsql
--   STABLE
--   SECURITY INVOKER
--   SET search_path = ''
--   AS $fn$
--   DECLARE
--     v_col       text;
--     v_cat_table text;
--     v_cat_col   text;
--     v_tz        text;
--     v_lo        timestamptz;
--     v_hi        timestamptz;
--     v_acct      text;
--     v_filter    text;
--     v_sql       text;
--   BEGIN
--     v_col := CASE p_level
--       WHEN 'campaign' THEN 'meta_campaign_id'
--       WHEN 'adset'    THEN 'meta_adset_id'
--       WHEN 'ad'       THEN 'meta_ad_id'
--     END;
--     IF v_col IS NULL THEN
--       RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
--     END IF;
--     IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales', 'uf_cash') THEN
--       RAISE EXCEPTION 'ads_crm_items: metrica invalida (%)', p_metric USING ERRCODE = '22023';
--     END IF;
--     IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
--       RAISE EXCEPTION 'ads_crm_items: rango de fechas invalido' USING ERRCODE = '22023';
--     END IF;
--     IF p_workspace_id IS NULL THEN
--       RETURN;
--     END IF;
--
--     SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
--     IF NOT FOUND THEN
--       RETURN;
--     END IF;
--     v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
--     v_lo := p_since::timestamp AT TIME ZONE v_tz;
--     v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;
--
--     v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
--     v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;
--
--     -- Los objetos de la cuenta: el catálogo Y los insights (con el catálogo vacío, solo el catálogo los dejaba a todos afuera).
--     v_acct := format($q$
--       WITH acct AS (
--         SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
--         UNION
--         SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
--       )
--     $q$, v_cat_col, v_cat_table);
--
--     -- Los mismos tres filtros en cada métrica: cuenta, un objeto, o una lista de objetos.
--     v_filter := $q$
--       ($6::text IS NULL OR x.obj IN (SELECT a.obj FROM acct a))
--       AND ($8::text IS NULL OR x.obj = $8)
--       AND ($9::text[] IS NULL OR x.obj = ANY($9))
--     $q$;
--
--     -- La columna del nivel sale de una lista fija (nunca del pedido): %1$I la cita como identificador, %2$L como texto.
--     IF p_metric = 'leads_new' THEN
--       v_sql := v_acct || format($q$
--         SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
--           FROM (
--             SELECT c.attribution -> 'first_touch' ->> %2$L AS obj,
--                    c.id AS contact_id,
--                    nullif(c.attribution -> 'first_touch' ->> 'occurred_at', '')::timestamptz AS occurred_at,
--                    c.attribution -> 'first_touch' ->> 'origin' AS origin
--               FROM public.contacts c
--              WHERE c.workspace_id = $1 AND c.deleted_at IS NULL
--                AND c.created_at >= $2 AND c.created_at < $3
--                AND c.attribution -> 'first_touch' ->> %2$L IS NOT NULL
--           ) x
--          WHERE %3$s
--       $q$, v_col, v_col, v_filter);
--
--     ELSIF p_metric = 'leads_total' THEN
--       v_sql := v_acct || format($q$
--         SELECT x.obj, x.contact_id, x.contact_id, x.occurred_at, x.origin, NULL::timestamptz, NULL::bigint
--           FROM (
--             SELECT DISTINCT ON (t.%1$I, t.contact_id)
--                    t.%1$I AS obj, t.contact_id, t.occurred_at, t.origin
--               FROM public.contact_touches t
--               JOIN public.contacts c ON c.id = t.contact_id AND c.deleted_at IS NULL
--              WHERE t.workspace_id = $1 AND t.%1$I IS NOT NULL
--                AND t.occurred_at >= $2 AND t.occurred_at < $3
--              ORDER BY t.%1$I, t.contact_id, t.occurred_at DESC, t.created_at DESC, t.id DESC
--           ) x
--          WHERE %2$s
--       $q$, v_col, v_filter);
--
--     ELSIF p_metric = 'bookings' THEN
--       v_sql := v_acct || format($q$
--         SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, x.start_at, NULL::bigint
--           FROM (
--             SELECT b.id, b.contact_id, b.start_at,
--                    coalesce(bt.obj, lt.obj) AS obj,
--                    CASE WHEN bt.obj IS NOT NULL THEN bt.occurred_at ELSE lt.occurred_at END AS touch_at,
--                    CASE WHEN bt.obj IS NOT NULL THEN bt.origin ELSE lt.origin END AS origin
--               FROM public.bookings b
--               LEFT JOIN LATERAL (
--                 SELECT t.%1$I AS obj, t.occurred_at, t.origin
--                   FROM public.contact_touches t
--                  WHERE t.workspace_id = $1 AND t.dedupe_key = 'booking:' || b.id::text AND t.%1$I IS NOT NULL
--                  LIMIT 1
--               ) bt ON true
--               LEFT JOIN LATERAL (
--                 SELECT t.%1$I AS obj, t.occurred_at, t.origin
--                   FROM public.contact_touches t
--                  WHERE bt.obj IS NULL
--                    AND t.contact_id = b.contact_id AND t.%1$I IS NOT NULL AND t.occurred_at <= b.created_at
--                  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
--                  LIMIT 1
--               ) lt ON true
--              WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
--                AND b.slot_released_at IS NULL
--           ) x
--          WHERE x.obj IS NOT NULL AND %2$s
--       $q$, v_col, v_filter);
--
--     ELSIF p_metric = 'sales' THEN
--       v_sql := v_acct || format($q$
--         SELECT x.obj, x.contact_id, x.id, x.touch_at, x.origin, (x.sale_date::timestamp AT TIME ZONE 'UTC'), x.amount_cents
--           FROM (
--             SELECT s.id, s.contact_id, s.sale_date, round(s.final_amount * 100)::bigint AS amount_cents,
--                    t.%1$I AS obj, t.occurred_at AS touch_at, t.origin
--               FROM public.sales s
--               JOIN public.contact_touches t ON t.id = s.attribution_touch_id
--              WHERE s.workspace_id = $1 AND s.sale_date >= $4 AND s.sale_date <= $5
--                AND s.status NOT IN ('cancelled', 'refunded')
--                AND t.%1$I IS NOT NULL
--           ) x
--          WHERE %2$s
--       $q$, v_col, v_filter);
--
--     ELSE -- uf_cash
--       v_sql := v_acct || format($q$
--         SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
--           FROM (
--             SELECT fp.id AS payment_id, s.contact_id,
--                    t.%1$I AS obj, t.occurred_at AS touch_at, t.origin,
--                    coalesce(fp.paid_at, (fp.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
--                    round(fp.amount * 100)::bigint AS amount_cents
--               FROM (
--                 SELECT DISTINCT ON (p.sale_id) p.id, p.sale_id, p.amount, p.paid_on, p.paid_at
--                   FROM public.payments p
--                  WHERE p.workspace_id = $1 AND p.status = 'paid' AND p.amount > 0
--                  ORDER BY p.sale_id, coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) ASC, p.id ASC
--               ) fp
--               JOIN public.sales s ON s.id = fp.sale_id
--               JOIN public.contact_touches t ON t.id = s.attribution_touch_id
--              WHERE fp.paid_on >= $4 AND fp.paid_on <= $5 AND t.%1$I IS NOT NULL
--           ) x
--          WHERE %2$s
--       $q$, v_col, v_filter);
--     END IF;
--
--     RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids;
--   END;
--   $fn$;
--
-- Definición vieja de ads_crm_metrics_v2:
--
--   CREATE OR REPLACE FUNCTION public.ads_crm_metrics_v2(
--     p_level text,
--     p_since date,
--     p_until date,
--     p_ad_account_id text DEFAULT NULL,
--     p_workspace_id uuid DEFAULT NULL,
--     p_object_ids text[] DEFAULT NULL
--   )
--   RETURNS TABLE (
--     object_id text,
--     is_total boolean,
--     leads_first integer,
--     leads_total integer,
--     leads_with_booking integer,
--     bookings integer,
--     bookings_attended integer,
--     sales integer,
--     revenue_cents bigint,
--     cash_cents bigint,
--     uf_cash_cents bigint
--   )
--   LANGUAGE plpgsql
--   STABLE
--   SECURITY INVOKER
--   SET search_path = ''
--   AS $fn$
--   DECLARE
--     v_col       text;
--     v_cat_table text;
--     v_cat_col   text;
--     v_tz        text;
--     v_lo        timestamptz;
--     v_hi        timestamptz;
--     v_sql       text;
--   BEGIN
--     v_col := CASE p_level
--       WHEN 'campaign' THEN 'meta_campaign_id'
--       WHEN 'adset'    THEN 'meta_adset_id'
--       WHEN 'ad'       THEN 'meta_ad_id'
--     END;
--     IF v_col IS NULL THEN
--       RAISE EXCEPTION 'ads_crm_metrics_v2: nivel invalido (%)', p_level USING ERRCODE = '22023';
--     END IF;
--     IF p_since IS NULL OR p_until IS NULL OR p_until < p_since THEN
--       RAISE EXCEPTION 'ads_crm_metrics_v2: rango de fechas invalido' USING ERRCODE = '22023';
--     END IF;
--     IF p_workspace_id IS NULL THEN
--       RETURN;
--     END IF;
--
--     SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
--     IF NOT FOUND THEN
--       RETURN;
--     END IF;
--     v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');
--     v_lo := p_since::timestamp AT TIME ZONE v_tz;
--     v_hi := (p_until + 1)::timestamp AT TIME ZONE v_tz;
--
--     v_cat_table := CASE p_level WHEN 'campaign' THEN 'meta_campaigns' WHEN 'adset' THEN 'meta_adsets' ELSE 'meta_ads' END;
--     v_cat_col   := CASE p_level WHEN 'campaign' THEN 'campaign_id'    WHEN 'adset' THEN 'adset_id'    ELSE 'ad_id' END;
--
--     v_sql := format($q$
--       WITH
--       acct AS (
--         SELECT x.%3$I AS obj FROM public.%4$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
--         UNION
--         SELECT i.object_id FROM public.meta_ads_insights_daily i WHERE i.workspace_id = $1 AND i.ad_account_id = $6 AND i.level = $7
--       ),
--       new_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_new',   $4, $5, $1, $6, NULL, $8)),
--       tot_items AS (SELECT * FROM public.ads_crm_items($7, 'leads_total', $4, $5, $1, $6, NULL, $8)),
--       bk_items  AS (
--         SELECT i.obj, i.contact_id, b.status_group
--           FROM public.ads_crm_items($7, 'bookings', $4, $5, $1, $6, NULL, $8) i
--           JOIN public.bookings b ON b.id = i.item_id
--       ),
--       sale_items AS (SELECT * FROM public.ads_crm_items($7, 'sales',    $4, $5, $1, $6, NULL, $8)),
--       uf_items   AS (SELECT * FROM public.ads_crm_items($7, 'uf_cash',  $4, $5, $1, $6, NULL, $8)),
--       new_agg  AS (SELECT obj, count(*)::int AS n FROM new_items GROUP BY obj),
--       tot_agg  AS (SELECT obj, count(*)::int AS n FROM tot_items GROUP BY obj),
--       bk_agg   AS (
--         SELECT obj, count(*)::int AS bookings,
--                (count(*) FILTER (WHERE status_group = 'outcome'))::int AS attended,
--                count(DISTINCT contact_id)::int AS leads
--           FROM bk_items GROUP BY obj
--       ),
--       sale_agg AS (SELECT obj, count(*)::int AS sales, coalesce(sum(amount_cents), 0)::bigint AS revenue FROM sale_items GROUP BY obj),
--       uf_agg   AS (SELECT obj, coalesce(sum(amount_cents), 0)::bigint AS uf FROM uf_items GROUP BY obj),
--       cash_agg AS (
--         SELECT t.%2$I AS obj, coalesce(sum(round(p.amount * 100)), 0)::bigint AS cash
--           FROM public.payments p
--           JOIN public.sales s ON s.id = p.sale_id
--           JOIN public.contact_touches t ON t.id = s.attribution_touch_id
--          WHERE p.workspace_id = $1 AND p.status = 'paid'
--            AND p.paid_on >= $4 AND p.paid_on <= $5
--            AND t.%2$I IS NOT NULL
--          GROUP BY 1
--       ),
--       objs AS (
--         SELECT obj FROM new_agg UNION SELECT obj FROM tot_agg UNION SELECT obj FROM bk_agg
--         UNION SELECT obj FROM sale_agg UNION SELECT obj FROM uf_agg UNION SELECT obj FROM cash_agg
--       )
--       SELECT o.obj, false,
--              coalesce(n.n, 0), coalesce(tl.n, 0), coalesce(ba.leads, 0),
--              coalesce(ba.bookings, 0), coalesce(ba.attended, 0),
--              coalesce(sa.sales, 0), coalesce(sa.revenue, 0)::bigint, coalesce(ca.cash, 0)::bigint, coalesce(ua.uf, 0)::bigint
--         FROM objs o
--         LEFT JOIN new_agg n ON n.obj = o.obj
--         LEFT JOIN tot_agg tl ON tl.obj = o.obj
--         LEFT JOIN bk_agg ba ON ba.obj = o.obj
--         LEFT JOIN sale_agg sa ON sa.obj = o.obj
--         LEFT JOIN uf_agg ua ON ua.obj = o.obj
--         LEFT JOIN cash_agg ca ON ca.obj = o.obj
--        WHERE ($6::text IS NULL OR o.obj IN (SELECT a.obj FROM acct a))
--          AND ($8::text[] IS NULL OR o.obj = ANY($8))
--       UNION ALL
--       -- La fila de total: personas DISTINTAS. Lo demas del total lo suma quien llama (es exacto).
--       SELECT NULL::text, true,
--              NULL::int,
--              (SELECT count(DISTINCT contact_id)::int FROM tot_items),
--              (SELECT count(DISTINCT contact_id)::int FROM bk_items),
--              NULL::int, NULL::int, NULL::int, NULL::bigint, NULL::bigint, NULL::bigint
--       ORDER BY 2, 1
--     $q$, v_col, v_col, v_cat_col, v_cat_table);
--
--     RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_ids;
--   END;
--   $fn$;
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
  v_col        text;
  v_cat_table  text;
  v_cat_col    text;
  v_tz         text;
  v_lo         timestamptz;
  v_hi         timestamptz;
  v_acct       text;
  v_filter     text;
  v_sale_touch text;
  v_sql        text;
BEGIN
  v_col := CASE p_level
    WHEN 'campaign' THEN 'meta_campaign_id'
    WHEN 'adset'    THEN 'meta_adset_id'
    WHEN 'ad'       THEN 'meta_ad_id'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'ads_crm_items: nivel invalido (%)', p_level USING ERRCODE = '22023';
  END IF;
  IF p_metric NOT IN ('leads_new', 'leads_total', 'bookings', 'sales', 'uf_cash', 'cash') THEN
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

  -- A qué objeto cuenta cada venta. Una sola definición para ventas, UF cash y cash:
  -- su toque guardado si tiene objeto; si no, y la venta no es manual, el último toque con objeto anterior a la venta.
  v_sale_touch := format($q$
    SELECT s.id, s.contact_id, s.sale_date, s.status, s.final_amount,
           coalesce(own.obj, prev.obj) AS obj,
           CASE WHEN own.obj IS NOT NULL THEN own.occurred_at ELSE prev.occurred_at END AS touch_at,
           CASE WHEN own.obj IS NOT NULL THEN own.origin ELSE prev.origin END AS origin
      FROM public.sales s
      LEFT JOIN LATERAL (
        SELECT t.%1$I AS obj, t.occurred_at, t.origin
          FROM public.contact_touches t
         WHERE t.id = s.attribution_touch_id AND t.%1$I IS NOT NULL
      ) own ON true
      LEFT JOIN LATERAL (
        SELECT t.%1$I AS obj, t.occurred_at, t.origin
          FROM public.contact_touches t
         WHERE own.obj IS NULL
           AND s.attribution_type <> 'manual'
           AND t.workspace_id = $1 AND t.contact_id = s.contact_id AND t.%1$I IS NOT NULL
           AND t.occurred_at <= s.created_at
           AND t.occurred_at < ((s.sale_date + 1)::timestamp AT TIME ZONE $10)
         ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
         LIMIT 1
      ) prev ON true
     WHERE s.workspace_id = $1
  $q$, v_col);

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
          SELECT st.id, st.contact_id, st.sale_date, round(st.final_amount * 100)::bigint AS amount_cents,
                 st.obj, st.touch_at, st.origin
            FROM (%1$s) st
           WHERE st.sale_date >= $4 AND st.sale_date <= $5
             AND st.status NOT IN ('cancelled', 'refunded')
             AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);

  ELSIF p_metric = 'uf_cash' THEN
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
        FROM (
          SELECT fp.id AS payment_id, st.contact_id,
                 st.obj, st.touch_at, st.origin,
                 coalesce(fp.paid_at, (fp.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
                 round(fp.amount * 100)::bigint AS amount_cents
            FROM (
              SELECT DISTINCT ON (p.sale_id) p.id, p.sale_id, p.amount, p.paid_on, p.paid_at
                FROM public.payments p
               WHERE p.workspace_id = $1 AND p.status = 'paid' AND p.amount > 0
               ORDER BY p.sale_id, coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) ASC, p.id ASC
            ) fp
            JOIN (%1$s) st ON st.id = fp.sale_id
           WHERE fp.paid_on >= $4 AND fp.paid_on <= $5 AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);

  ELSE -- cash: todo lo cobrado en el rango, menos los reembolsos (filas negativas), de cualquier venta del objeto
    v_sql := v_acct || format($q$
      SELECT x.obj, x.contact_id, x.payment_id, x.touch_at, x.origin, x.paid_at, x.amount_cents
        FROM (
          SELECT p.id AS payment_id, st.contact_id,
                 st.obj, st.touch_at, st.origin,
                 coalesce(p.paid_at, (p.paid_on::timestamp AT TIME ZONE 'UTC')) AS paid_at,
                 round(p.amount * 100)::bigint AS amount_cents
            FROM public.payments p
            JOIN (%1$s) st ON st.id = p.sale_id
           WHERE p.workspace_id = $1 AND p.status = 'paid'
             AND p.paid_on >= $4 AND p.paid_on <= $5
             AND st.obj IS NOT NULL
        ) x
       WHERE %2$s
    $q$, v_sale_touch, v_filter);
  END IF;

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_id, p_object_ids, v_tz;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_items(text, text, date, date, uuid, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_items(text, text, date, date, uuid, text, text, text[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. Los números de la tabla, calculados sobre esas filas (el Cash, ahora también)
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
      SELECT x.%1$I AS obj FROM public.%2$I x WHERE x.workspace_id = $1 AND x.ad_account_id = $6
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
    cash_items AS (SELECT * FROM public.ads_crm_items($7, 'cash',     $4, $5, $1, $6, NULL, $8)),
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
    cash_agg AS (SELECT obj, coalesce(sum(amount_cents), 0)::bigint AS cash FROM cash_items GROUP BY obj),
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
  $q$, v_cat_col, v_cat_table);

  RETURN QUERY EXECUTE v_sql USING p_workspace_id, v_lo, v_hi, p_since, p_until, p_ad_account_id, p_level, p_object_ids;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ads_crm_metrics_v2(text, date, date, text, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ads_crm_metrics_v2(text, date, date, text, uuid, text[]) TO authenticated, service_role;
