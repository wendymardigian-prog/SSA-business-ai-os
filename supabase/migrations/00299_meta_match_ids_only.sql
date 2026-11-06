-- ============================================================================
-- 00299 — Vinculo con Meta: siempre por id; un nombre solo adentro de lo que ya se conoce por id
-- ============================================================================
-- Dos campañas o dos anuncios pueden llamarse igual, asi que un nombre solo no identifica a ninguno.
-- La regla (la misma en TypeScript: lib/attribution/meta-match.ts, con meta-match.cases.json):
--   Campaña:  campaign_id -> utm_campaign igual a un id -> la del anuncio o del conjunto. Nunca por nombre.
--   Conjunto: adset_id -> utm_term igual a un id -> el del anuncio. Nunca por nombre.
--   Anuncio:  ad_id -> utm_content igual a un id -> utm_content como nombre, solo si es unico dentro del conjunto
--             (o, sin conjunto, de la campaña) conocido por id -> el unico anuncio del conjunto (`adset_single_ad`).
--   Solo nombres, sin ningun id: `unmatched` con motivo `name_without_id`, para revisarlo a mano.
--
-- Ademas:
--   - `utm_id` numerico cuenta como id de la campaña (se ignoraba). Vive en raw.utm_id o raw.utm.utm_id.
--   - Un toque sin ids cuya fuente no es de Meta y cuyos UTM son solo texto (utm_source=whatsapp) no tiene datos de
--     Meta: queda `none` y no ensucia «Sin vincular». Un UTM numerico cuenta igual (puede ser el id de un importado).
--   - `rematch_meta_touches` tambien revisa un `matched` con conjunto y sin anuncio, y nunca empeora un `matched`:
--     un vinculo hecho por nombre con la regla vieja se conserva.
--
-- Cambia a proposito la huella de `resolve_meta_match` (scripts/protected-functions.mjs). Misma firma en todas.
-- NO cambian: `record_contact_touch`, `create_booking`, `submit_form_response`, `find_or_link_contact`.
-- Aditiva en datos: solo pasa a `none` los toques `unmatched` que dejan de tener datos de Meta.
-- Se puede aplicar antes o despues del codigo. El vinculo de lo existente lo hace el proximo sync, o
-- `select public.rematch_meta_touches(<workspace>, '-infinity')`.
--
-- Como volver atras: aplicar las definiciones de abajo y DROP FUNCTION private.meta_source_counts(text);
-- DROP FUNCTION private.meta_is_numeric(text); DROP FUNCTION private.meta_touch_utm_id(public.contact_touches).
-- Riesgo: medio (el trigger corre en cada toque nuevo; sigue envuelto en EXCEPTION y nunca hace fallar un insert).
--
-- Definiciones VIGENTES antes de esta migracion:
--
-- resolve_meta_match (00192):
--   CREATE OR REPLACE FUNCTION public.resolve_meta_match(
--     p_workspace_id uuid,
--     p_ad_id text,
--     p_adset_id text,
--     p_campaign_id text,
--     p_utm_campaign text,
--     p_utm_content text,
--     p_utm_term text,
--     p_fbclid text
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   STABLE
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_ad_id        text := nullif(btrim(p_ad_id), '');
--     v_adset_id     text := nullif(btrim(p_adset_id), '');
--     v_campaign_id  text := nullif(btrim(p_campaign_id), '');
--     v_utm_campaign text := nullif(btrim(private.meta_url_decode(p_utm_campaign)), '');
--     v_utm_content  text := nullif(btrim(private.meta_url_decode(p_utm_content)), '');
--     v_utm_term     text := nullif(btrim(private.meta_url_decode(p_utm_term)), '');
--     v_fbclid       text := nullif(btrim(p_fbclid), '');
--
--     -- Lo resuelto
--     r_ad           text;
--     r_ad_adset     text;
--     r_ad_campaign  text;
--     r_adset        text;
--     r_adset_camp   text;
--     r_campaign     text;
--     m_ad           text;
--     m_adset        text;
--     m_campaign     text;
--
--     -- Pistas de campaña (pasos 1, 2 y 4) para desempatar anuncios homonimos
--     h_campaign     text;
--     h_campaign_n   int;
--     h_direct       text;
--     v_name_key     text;
--     v_n            int;
--
--     ambiguous_ad       boolean := false;
--     ambiguous_campaign boolean := false;
--     v_notes        text[] := ARRAY[]::text[];
--     v_status       text;
--     v_method       text;
--     v_reason       text;
--   BEGIN
--     -- Sin ningun dato de Meta (ni ids, ni UTMs con valor, ni fbclid): no hay nada que resolver.
--     IF v_ad_id IS NULL AND v_adset_id IS NULL AND v_campaign_id IS NULL
--        AND v_utm_campaign IS NULL AND v_utm_content IS NULL AND v_utm_term IS NULL AND v_fbclid IS NULL THEN
--       RETURN jsonb_build_object('status', 'none', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', NULL, 'reason', NULL);
--     END IF;
--
--     -- ---- La campaña que se puede deducir SIN pasar por el anuncio (pistas 1, 2 y 4) ----
--     IF v_campaign_id IS NOT NULL THEN
--       SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
--        WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
--       IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
--     END IF;
--     IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
--       SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
--        WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
--       IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
--     END IF;
--     IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
--       v_name_key := public.meta_name_key(v_utm_campaign);
--       SELECT count(DISTINCT c.campaign_id), min(c.campaign_id) INTO h_campaign_n, h_campaign
--         FROM public.meta_campaigns c
--        WHERE c.workspace_id = p_workspace_id AND c.name_key = v_name_key AND v_name_key <> '';
--       IF h_campaign_n > 1 THEN
--         h_campaign := NULL;
--         ambiguous_campaign := true;
--       END IF;
--     END IF;
--
--     -- ---- Anuncio ----
--     IF v_ad_id IS NOT NULL THEN
--       SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--        WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad_id LIMIT 1;
--       IF r_ad IS NOT NULL THEN m_ad := 'ad_id'; END IF;
--     END IF;
--     IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
--       SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--        WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_utm_content LIMIT 1;
--       IF r_ad IS NOT NULL THEN m_ad := 'utm_content_id'; END IF;
--     END IF;
--     IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
--       v_name_key := public.meta_name_key(v_utm_content);
--       IF v_name_key <> '' THEN
--         SELECT count(*) INTO v_n FROM public.meta_ads a
--          WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key;
--         IF v_n = 1 THEN
--           SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--            WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key LIMIT 1;
--           m_ad := 'utm_content_name';
--         ELSIF v_n > 1 THEN
--           -- Varios anuncios con ese nombre: se desempata con la campaña (pistas 1, 2 y 4).
--           IF h_campaign IS NOT NULL THEN
--             SELECT count(*) INTO v_n FROM public.meta_ads a
--              WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign;
--             IF v_n = 1 THEN
--               SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--                WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign LIMIT 1;
--               m_ad := 'utm_content_name_campaign';
--             END IF;
--           END IF;
--           IF r_ad IS NULL THEN ambiguous_ad := true; END IF;
--         END IF;
--       END IF;
--     END IF;
--
--     -- ---- Conjunto ----
--     IF v_adset_id IS NOT NULL THEN
--       SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
--        WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_adset_id LIMIT 1;
--       IF r_adset IS NOT NULL THEN m_adset := 'adset_id'; END IF;
--     END IF;
--     IF r_adset IS NULL AND v_utm_term IS NOT NULL THEN
--       SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
--        WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_utm_term LIMIT 1;
--       IF r_adset IS NOT NULL THEN m_adset := 'utm_term_id'; END IF;
--     END IF;
--     IF r_adset IS NULL AND r_ad IS NOT NULL AND r_ad_adset IS NOT NULL THEN
--       r_adset := r_ad_adset;
--       m_adset := m_ad;
--       SELECT s.campaign_id INTO r_adset_camp FROM public.meta_adsets s
--        WHERE s.workspace_id = p_workspace_id AND s.adset_id = r_adset LIMIT 1;
--     END IF;
--
--     -- ---- Campaña ----
--     IF h_direct IS NOT NULL THEN
--       r_campaign := h_direct;
--       m_campaign := CASE WHEN v_campaign_id IS NOT NULL AND h_direct = v_campaign_id THEN 'campaign_id' ELSE 'utm_campaign_id' END;
--       -- Coherencia: si el anuncio es de OTRA campaña, gana el anuncio (es mas especifico).
--       IF r_ad IS NOT NULL AND r_ad_campaign IS NOT NULL AND r_ad_campaign <> r_campaign THEN
--         r_campaign := r_ad_campaign;
--         m_campaign := m_ad;
--         v_notes := array_append(v_notes, 'inconsistent_campaign');
--       END IF;
--     ELSIF r_ad_campaign IS NOT NULL OR r_adset_camp IS NOT NULL THEN
--       r_campaign := coalesce(r_ad_campaign, r_adset_camp);
--       m_campaign := CASE WHEN r_ad_campaign IS NOT NULL THEN m_ad ELSE m_adset END;
--     ELSIF h_campaign IS NOT NULL THEN
--       -- El nombre de la campaña de una sola coincidencia (paso 4).
--       r_campaign := h_campaign;
--       m_campaign := 'utm_campaign_name';
--     END IF;
--
--     -- ---- Resultado ----
--     IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
--       v_status := 'matched';
--       v_method := coalesce(m_ad, m_adset, m_campaign);
--       IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
--       IF ambiguous_campaign AND r_campaign IS NULL THEN v_notes := array_append(v_notes, 'ambiguous_campaign_name'); END IF;
--       -- Un id que vino y no esta en el catalogo, aunque otra pista haya resuelto algo.
--       IF (v_ad_id IS NOT NULL AND r_ad IS NULL) OR (v_adset_id IS NOT NULL AND m_adset IS DISTINCT FROM 'adset_id')
--          OR (v_campaign_id IS NOT NULL AND h_direct IS DISTINCT FROM v_campaign_id AND r_campaign IS DISTINCT FROM v_campaign_id) THEN
--         v_notes := array_append(v_notes, 'id_not_in_catalog');
--       END IF;
--       v_reason := nullif(array_to_string(v_notes, ','), '');
--     ELSE
--       v_status := 'unmatched';
--       IF v_ad_id IS NOT NULL OR v_adset_id IS NOT NULL OR v_campaign_id IS NOT NULL THEN
--         v_reason := 'id_not_in_catalog';
--       ELSIF ambiguous_ad THEN
--         v_reason := 'ambiguous_ad_name';
--       ELSIF ambiguous_campaign THEN
--         v_reason := 'ambiguous_campaign_name';
--       ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
--         v_reason := 'name_not_found';
--       ELSE
--         v_reason := 'fbclid_only';
--       END IF;
--     END IF;
--
--     RETURN jsonb_build_object(
--       'status', v_status,
--       'ad_id', r_ad,
--       'adset_id', r_adset,
--       'campaign_id', r_campaign,
--       'method', v_method,
--       'reason', v_reason
--     );
--   END;
--   $$;
--
-- private.meta_touch_utm_counts (00194):
--   CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
--   RETURNS boolean
--   LANGUAGE sql
--   IMMUTABLE
--   SET search_path = ''
--   AS $$
--     SELECT t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
--         OR nullif(btrim(t.ad_id), '') IS NOT NULL
--         OR nullif(btrim(t.adset_id), '') IS NOT NULL
--         OR nullif(btrim(t.campaign_id), '') IS NOT NULL
--   $$;
--
--   -- ¿El toque trae algun dato de Meta (ids, fbclid o UTMs que cuentan)?
--   CREATE OR REPLACE FUNCTION private.meta_touch_has_data(t public.contact_touches)
--   RETURNS boolean
--   LANGUAGE sql
--   IMMUTABLE
--   SET search_path = ''
--   AS $$
--     SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
--         OR nullif(btrim(t.adset_id), '') IS NOT NULL
--         OR nullif(btrim(t.campaign_id), '') IS NOT NULL
--         OR nullif(btrim(t.fbclid), '') IS NOT NULL
--         OR (
--           private.meta_touch_utm_counts(t)
--           AND (nullif(btrim(t.campaign), '') IS NOT NULL
--                OR nullif(btrim(t.content_label), '') IS NOT NULL
--                OR nullif(btrim(t.term), '') IS NOT NULL)
--         )
--   $$;
--
--   -- La resolucion de UN toque: aplica la regla de arriba y llama a la funcion pura.
--   CREATE OR REPLACE FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches)
--   RETURNS jsonb
--   LANGUAGE sql
--   STABLE
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--     SELECT public.resolve_meta_match(
--       t.workspace_id, t.ad_id, t.adset_id, t.campaign_id,
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
--       t.fbclid
--     )
--   $$;
--
-- rematch_meta_touches (00194):
--   CREATE OR REPLACE FUNCTION public.rematch_meta_touches(p_workspace_id uuid, p_since timestamptz)
--   RETURNS integer
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_changed int := 0;
--     v_batch   int;
--     v_last_at timestamptz := '-infinity';
--     v_last_id uuid := '00000000-0000-0000-0000-000000000000';
--     t         public.contact_touches%ROWTYPE;
--     r         jsonb;
--     v_contacts uuid[];
--   BEGIN
--     LOOP
--       v_batch := 0;
--       v_contacts := ARRAY[]::uuid[];
--
--       FOR t IN
--         SELECT ct.*
--           FROM public.contact_touches ct
--          WHERE ct.workspace_id = p_workspace_id
--            AND ct.occurred_at >= p_since
--            AND (ct.occurred_at, ct.id) > (v_last_at, v_last_id)
--            AND (
--              ct.meta_match_status IN ('unmatched', 'none')
--              OR (ct.meta_match_status = 'matched' AND ct.meta_ad_id IS NULL
--                  AND (nullif(btrim(ct.ad_id), '') IS NOT NULL OR nullif(btrim(ct.content_label), '') IS NOT NULL))
--            )
--            AND private.meta_touch_has_data(ct)
--          ORDER BY ct.occurred_at, ct.id
--          LIMIT 500
--       LOOP
--         v_batch := v_batch + 1;
--         v_last_at := t.occurred_at;
--         v_last_id := t.id;
--
--         r := public.resolve_meta_match_for_touch(t);
--
--         -- Si no cambia nada, no se escribe (y no se cuenta).
--         IF (r->>'status') IS DISTINCT FROM t.meta_match_status
--            OR (r->>'ad_id') IS DISTINCT FROM t.meta_ad_id
--            OR (r->>'adset_id') IS DISTINCT FROM t.meta_adset_id
--            OR (r->>'campaign_id') IS DISTINCT FROM t.meta_campaign_id
--            OR (r->>'method') IS DISTINCT FROM t.meta_match_method
--            OR (r->>'reason') IS DISTINCT FROM t.meta_match_reason THEN
--           UPDATE public.contact_touches
--              SET meta_campaign_id = r->>'campaign_id',
--                  meta_adset_id = r->>'adset_id',
--                  meta_ad_id = r->>'ad_id',
--                  meta_match_status = coalesce(r->>'status', 'none'),
--                  meta_match_method = r->>'method',
--                  meta_match_reason = r->>'reason',
--                  meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END
--            WHERE id = t.id;
--           v_changed := v_changed + 1;
--           v_contacts := array_append(v_contacts, t.contact_id);
--         END IF;
--       END LOOP;
--
--       EXIT WHEN v_batch = 0;
--
--       -- El contacto se refresca una vez por lote, no una vez por toque.
--       PERFORM private.refresh_contact_attribution(c) FROM (SELECT DISTINCT unnest(v_contacts) AS c) x;
--     END LOOP;
--
--     RETURN v_changed;
--   END;
--   $$;
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Lo que cuenta como dato de Meta
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.meta_is_numeric(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(btrim(p_value) ~ '^[0-9]+$', false)
$$;

-- La fuente puede traer un anuncio de Meta, o es la generica de un toque sin utm_source.
CREATE OR REPLACE FUNCTION private.meta_source_counts(p_source text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(nullif(btrim(lower(p_source)), ''), 'web') IN ('meta', 'facebook', 'fb', 'instagram', 'ig', 'msg', 'an', 'web')
$$;

-- El utm_id de un toque: un formulario lo guarda en raw.utm_id; una reunion, en raw.utm.utm_id.
CREATE OR REPLACE FUNCTION private.meta_touch_utm_id(t public.contact_touches)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(coalesce(t.raw->>'utm_id', t.raw->'utm'->>'utm_id')), '')
$$;

CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR (
        t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
        AND (
          private.meta_source_counts(t.source)
          OR private.meta_is_numeric(t.campaign)
          OR private.meta_is_numeric(t.content_label)
          OR private.meta_is_numeric(t.term)
        )
      )
$$;

CREATE OR REPLACE FUNCTION private.meta_touch_has_data(t public.contact_touches)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR nullif(btrim(t.fbclid), '') IS NOT NULL
      OR (
        private.meta_touch_utm_counts(t)
        AND (nullif(btrim(t.campaign), '') IS NOT NULL
             OR nullif(btrim(t.content_label), '') IS NOT NULL
             OR nullif(btrim(t.term), '') IS NOT NULL
             OR (private.meta_source_counts(t.source) AND private.meta_is_numeric(private.meta_touch_utm_id(t))))
      )
$$;

CREATE OR REPLACE FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.resolve_meta_match(
    t.workspace_id, t.ad_id, t.adset_id,
    coalesce(
      nullif(btrim(t.campaign_id), ''),
      CASE WHEN private.meta_touch_utm_counts(t) AND private.meta_source_counts(t.source)
                AND private.meta_is_numeric(private.meta_touch_utm_id(t))
           THEN private.meta_touch_utm_id(t) END
    ),
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
    t.fbclid
  )
$$;

REVOKE ALL ON FUNCTION private.meta_is_numeric(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_source_counts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_touch_utm_id(public.contact_touches) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. resolve_meta_match
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_meta_match(
  p_workspace_id uuid,
  p_ad_id text,
  p_adset_id text,
  p_campaign_id text,
  p_utm_campaign text,
  p_utm_content text,
  p_utm_term text,
  p_fbclid text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ad_id        text := nullif(btrim(p_ad_id), '');
  v_adset_id     text := nullif(btrim(p_adset_id), '');
  v_campaign_id  text := nullif(btrim(p_campaign_id), '');
  v_utm_campaign text := nullif(btrim(private.meta_url_decode(p_utm_campaign)), '');
  v_utm_content  text := nullif(btrim(private.meta_url_decode(p_utm_content)), '');
  v_utm_term     text := nullif(btrim(private.meta_url_decode(p_utm_term)), '');
  v_fbclid       text := nullif(btrim(p_fbclid), '');

  -- Lo resuelto
  r_ad           text;
  r_ad_adset     text;
  r_ad_campaign  text;
  r_adset        text;
  r_adset_camp   text;
  r_campaign     text;
  m_ad           text;
  m_adset        text;
  m_campaign     text;

  h_direct       text;
  v_name_key     text;
  v_n            int;

  ambiguous_ad   boolean := false;
  v_notes        text[] := ARRAY[]::text[];
  v_status       text;
  v_method       text;
  v_reason       text;
BEGIN
  -- Sin ningun dato de Meta (ni ids, ni UTMs con valor, ni fbclid): no hay nada que resolver.
  IF v_ad_id IS NULL AND v_adset_id IS NULL AND v_campaign_id IS NULL
     AND v_utm_campaign IS NULL AND v_utm_content IS NULL AND v_utm_term IS NULL AND v_fbclid IS NULL THEN
    RETURN jsonb_build_object('status', 'none', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', NULL, 'reason', NULL);
  END IF;

  -- ---- La campaña por id ----
  IF v_campaign_id IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
  END IF;
  IF h_direct IS NULL AND v_utm_campaign IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
  END IF;

  -- ---- Anuncio por id ----
  IF v_ad_id IS NOT NULL THEN
    SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad_id LIMIT 1;
    IF r_ad IS NOT NULL THEN m_ad := 'ad_id'; END IF;
  END IF;
  IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
    SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_utm_content LIMIT 1;
    IF r_ad IS NOT NULL THEN m_ad := 'utm_content_id'; END IF;
  END IF;

  -- ---- Conjunto por id ----
  IF v_adset_id IS NOT NULL THEN
    SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_adset_id LIMIT 1;
    IF r_adset IS NOT NULL THEN m_adset := 'adset_id'; END IF;
  END IF;
  IF r_adset IS NULL AND v_utm_term IS NOT NULL THEN
    SELECT s.adset_id, s.campaign_id INTO r_adset, r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_utm_term LIMIT 1;
    IF r_adset IS NOT NULL THEN m_adset := 'utm_term_id'; END IF;
  END IF;

  -- ---- Anuncio por nombre: solo adentro de lo que ya se conoce por id ----
  IF r_ad IS NULL AND v_utm_content IS NOT NULL AND (r_adset IS NOT NULL OR h_direct IS NOT NULL) THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
         AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END);
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
           AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END)
         LIMIT 1;
        m_ad := CASE WHEN r_adset IS NOT NULL THEN 'utm_content_name_adset' ELSE 'utm_content_name_campaign' END;
      ELSIF v_n > 1 THEN
        ambiguous_ad := true;
      END IF;
    END IF;
  END IF;

  -- ---- El unico anuncio del conjunto. No si llego un id de anuncio que no esta en el catalogo: seria otro anuncio. ----
  IF r_ad IS NULL AND r_adset IS NOT NULL AND NOT ambiguous_ad AND v_ad_id IS NULL
     AND NOT private.meta_is_numeric(v_utm_content) THEN
    SELECT count(*) INTO v_n FROM public.meta_ads a
     WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset;
    IF v_n = 1 THEN
      SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset LIMIT 1;
      m_ad := 'adset_single_ad';
    END IF;
  END IF;

  -- ---- El conjunto del anuncio ----
  IF r_adset IS NULL AND r_ad IS NOT NULL AND r_ad_adset IS NOT NULL THEN
    r_adset := r_ad_adset;
    m_adset := m_ad;
    SELECT s.campaign_id INTO r_adset_camp FROM public.meta_adsets s
     WHERE s.workspace_id = p_workspace_id AND s.adset_id = r_adset LIMIT 1;
  END IF;

  -- ---- Campaña ----
  IF h_direct IS NOT NULL THEN
    r_campaign := h_direct;
    m_campaign := CASE WHEN v_campaign_id IS NOT NULL AND h_direct = v_campaign_id THEN 'campaign_id' ELSE 'utm_campaign_id' END;
    -- Coherencia: si el anuncio es de OTRA campaña, gana el anuncio (es mas especifico).
    IF r_ad IS NOT NULL AND r_ad_campaign IS NOT NULL AND r_ad_campaign <> r_campaign THEN
      r_campaign := r_ad_campaign;
      m_campaign := m_ad;
      v_notes := array_append(v_notes, 'inconsistent_campaign');
    END IF;
  ELSIF r_ad_campaign IS NOT NULL OR r_adset_camp IS NOT NULL THEN
    r_campaign := coalesce(r_ad_campaign, r_adset_camp);
    m_campaign := CASE WHEN r_ad_campaign IS NOT NULL THEN m_ad ELSE m_adset END;
  END IF;

  -- ---- Resultado ----
  IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
    v_status := 'matched';
    v_method := coalesce(m_ad, m_adset, m_campaign);
    IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
    -- Un id que vino y no esta en el catalogo, aunque otra pista haya resuelto algo.
    IF (v_ad_id IS NOT NULL AND r_ad IS NULL) OR (v_adset_id IS NOT NULL AND m_adset IS DISTINCT FROM 'adset_id')
       OR (v_campaign_id IS NOT NULL AND h_direct IS DISTINCT FROM v_campaign_id AND r_campaign IS DISTINCT FROM v_campaign_id) THEN
      v_notes := array_append(v_notes, 'id_not_in_catalog');
    END IF;
    v_reason := nullif(array_to_string(v_notes, ','), '');
  ELSE
    v_status := 'unmatched';
    IF v_ad_id IS NOT NULL OR v_adset_id IS NOT NULL OR v_campaign_id IS NOT NULL THEN
      v_reason := 'id_not_in_catalog';
    ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
      v_reason := 'name_without_id';
    ELSE
      v_reason := 'fbclid_only';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'ad_id', r_ad,
    'adset_id', r_adset,
    'campaign_id', r_campaign,
    'method', v_method,
    'reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_meta_match(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_match(uuid, text, text, text, text, text, text, text) TO service_role;

-- ------------------------------------------------------------
-- 3. rematch_meta_touches: revisa un conjunto sin anuncio y nunca empeora un `matched`
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rematch_meta_touches(p_workspace_id uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed int := 0;
  v_batch   int;
  v_last_at timestamptz := '-infinity';
  v_last_id uuid := '00000000-0000-0000-0000-000000000000';
  t         public.contact_touches%ROWTYPE;
  r         jsonb;
  v_contacts uuid[];
BEGIN
  LOOP
    v_batch := 0;
    v_contacts := ARRAY[]::uuid[];

    FOR t IN
      SELECT ct.*
        FROM public.contact_touches ct
       WHERE ct.workspace_id = p_workspace_id
         AND ct.occurred_at >= p_since
         AND (ct.occurred_at, ct.id) > (v_last_at, v_last_id)
         AND (
           ct.meta_match_status IN ('unmatched', 'none')
           OR (ct.meta_match_status = 'matched' AND ct.meta_ad_id IS NULL
               AND (nullif(btrim(ct.ad_id), '') IS NOT NULL
                    OR nullif(btrim(ct.content_label), '') IS NOT NULL
                    OR ct.meta_adset_id IS NOT NULL))
         )
         AND private.meta_touch_has_data(ct)
       ORDER BY ct.occurred_at, ct.id
       LIMIT 500
    LOOP
      v_batch := v_batch + 1;
      v_last_at := t.occurred_at;
      v_last_id := t.id;

      r := public.resolve_meta_match_for_touch(t);

      -- Lo ya vinculado no empeora: la regla nueva no le saca un conjunto o una campaña a quien ya los tenia.
      CONTINUE WHEN t.meta_match_status = 'matched' AND (
        (r->>'status') IS DISTINCT FROM 'matched'
        OR (t.meta_adset_id IS NOT NULL AND (r->>'adset_id') IS NULL)
        OR (t.meta_campaign_id IS NOT NULL AND (r->>'campaign_id') IS NULL)
      );

      -- Si no cambia nada, no se escribe (y no se cuenta).
      IF (r->>'status') IS DISTINCT FROM t.meta_match_status
         OR (r->>'ad_id') IS DISTINCT FROM t.meta_ad_id
         OR (r->>'adset_id') IS DISTINCT FROM t.meta_adset_id
         OR (r->>'campaign_id') IS DISTINCT FROM t.meta_campaign_id
         OR (r->>'method') IS DISTINCT FROM t.meta_match_method
         OR (r->>'reason') IS DISTINCT FROM t.meta_match_reason THEN
        UPDATE public.contact_touches
           SET meta_campaign_id = r->>'campaign_id',
               meta_adset_id = r->>'adset_id',
               meta_ad_id = r->>'ad_id',
               meta_match_status = coalesce(r->>'status', 'none'),
               meta_match_method = r->>'method',
               meta_match_reason = r->>'reason',
               meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END
         WHERE id = t.id;
        v_changed := v_changed + 1;
        v_contacts := array_append(v_contacts, t.contact_id);
      END IF;
    END LOOP;

    EXIT WHEN v_batch = 0;

    -- El contacto se refresca una vez por lote, no una vez por toque.
    PERFORM private.refresh_contact_attribution(c) FROM (SELECT DISTINCT unnest(v_contacts) AS c) x;
  END LOOP;

  RETURN v_changed;
END;
$$;

-- ------------------------------------------------------------
-- 4. Los `unmatched` que dejan de tener datos de Meta vuelven a `none` (el rematch ya no los mira)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_contacts uuid[];
  v_n int;
BEGIN
  WITH fixed AS (
    UPDATE public.contact_touches ct
       SET meta_match_status = 'none', meta_match_method = NULL, meta_match_reason = NULL, meta_matched_at = NULL
     WHERE ct.meta_match_status = 'unmatched'
       AND NOT private.meta_touch_has_data(ct)
    RETURNING ct.contact_id
  )
  SELECT array_agg(DISTINCT contact_id), count(*) INTO v_contacts, v_n FROM fixed;

  IF v_contacts IS NOT NULL THEN
    PERFORM private.refresh_contact_attribution(c) FROM unnest(v_contacts) AS c;
  END IF;
  RAISE NOTICE '00299: % toque(s) sin datos de Meta vuelven a none', coalesce(v_n, 0);
END $$;
