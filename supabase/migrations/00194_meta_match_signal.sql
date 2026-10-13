-- ============================================================================
-- 00194 — Vinculo con Meta: solo cuentan los toques que PUEDEN traer datos de anuncio  (correccion de la 00192)
-- ============================================================================
-- La 00192 trataba cualquier `campaign`, `content_label` o `term` de un toque como un UTM. Pero en un
-- comentario o un DM organico, `content_label` es el TITULO DE LA PUBLICACION (o de la historia), no un UTM:
-- el backfill de la 00193 lo comprobo con el primer toque real que vio (un comentario "unmatched / name_not_found").
-- Con esa regla, todo comentario y DM organico iba a ensuciar «Sin vincular».
--
-- La regla corregida (la misma en SQL y en TypeScript: `touchMetaInput`, lib/attribution/meta-match.ts):
--   Los ids (`ad_id`, `adset_id`, `campaign_id`) y el `fbclid` SIEMPRE cuentan.
--   `campaign`, `content_label` y `term` cuentan como UTMs solo si el toque puede traerlos de verdad:
--     - su origen es booking, form, webhook, import o manual, o
--     - ya trae algun id de anuncio (un DM que viene de un anuncio: el titulo del anuncio SI sirve para el nombre).
--   Un comentario o un DM sin ids de anuncio no tiene datos de Meta: queda `none`.
--
-- Cambia (CREATE OR REPLACE, mismas firmas): el trigger, `rematch_meta_touches` y `set_touch_meta_match`.
-- Suma: `private.meta_touch_utm_counts`, `private.meta_touch_has_data` y `public.resolve_meta_match_for_touch`.
-- `resolve_meta_match` NO cambia (sigue siendo la funcion pura que comparten SQL y TypeScript).
-- Corrige el dato: los toques que la 00193 dejo `unmatched` sin tener datos de Meta vuelven a `none`.
--
-- Definiciones VIGENTES antes de esta migracion: son las de la 00192 (trigger, rematch, set_touch_meta_match).
--
-- Como volver atras: volver a aplicar las tres funciones tal como estan en la 00192 y
--   DROP FUNCTION IF EXISTS public.resolve_meta_match_for_touch(public.contact_touches);
--   DROP FUNCTION IF EXISTS private.meta_touch_has_data(public.contact_touches);
--   DROP FUNCTION IF EXISTS private.meta_touch_utm_counts(public.contact_touches);
-- Riesgo: medio (cambia el trigger que corre en cada insert de un toque; sigue envuelto en EXCEPTION).
-- ============================================================================

SET search_path = '';

-- ¿El toque puede traer UTMs de verdad (y no el titulo de una publicacion)?
CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
      OR nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
$$;

-- ¿El toque trae algun dato de Meta (ids, fbclid o UTMs que cuentan)?
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
             OR nullif(btrim(t.term), '') IS NOT NULL)
      )
$$;

-- La resolucion de UN toque: aplica la regla de arriba y llama a la funcion pura.
CREATE OR REPLACE FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.resolve_meta_match(
    t.workspace_id, t.ad_id, t.adset_id, t.campaign_id,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
    CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
    t.fbclid
  )
$$;

REVOKE ALL ON FUNCTION private.meta_touch_utm_counts(public.contact_touches) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_touch_has_data(public.contact_touches) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_meta_match_for_touch(public.contact_touches) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_match_for_touch(public.contact_touches) TO service_role;

-- ------------------------------------------------------------
-- El trigger (mismo cuerpo, llama a la funcion por toque)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_touches_meta_match_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r jsonb;
BEGIN
  -- Lo que una persona eligio o descarto no se vuelve a resolver solo.
  IF NEW.meta_match_status IN ('manual', 'ignored') THEN
    RETURN NEW;
  END IF;

  BEGIN
    r := public.resolve_meta_match_for_touch(NEW);
    NEW.meta_campaign_id := r->>'campaign_id';
    NEW.meta_adset_id    := r->>'adset_id';
    NEW.meta_ad_id       := r->>'ad_id';
    NEW.meta_match_status := coalesce(r->>'status', 'none');
    NEW.meta_match_method := r->>'method';
    NEW.meta_match_reason := r->>'reason';
    NEW.meta_matched_at   := CASE WHEN NEW.meta_match_status = 'matched' THEN now() END;
  EXCEPTION WHEN OTHERS THEN
    -- Un error en el vinculo no puede costar un toque: se guarda sin vincular y queda el aviso en el log.
    NEW.meta_campaign_id := NULL;
    NEW.meta_adset_id := NULL;
    NEW.meta_ad_id := NULL;
    NEW.meta_match_status := 'none';
    NEW.meta_match_method := NULL;
    NEW.meta_match_reason := NULL;
    NEW.meta_matched_at := NULL;
    RAISE WARNING 'contact_touches_meta_match: no pude vincular el toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- rematch_meta_touches (mismo cuerpo; solo mira toques con datos de Meta de verdad)
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
               AND (nullif(btrim(ct.ad_id), '') IS NOT NULL OR nullif(btrim(ct.content_label), '') IS NOT NULL))
         )
         AND private.meta_touch_has_data(ct)
       ORDER BY ct.occurred_at, ct.id
       LIMIT 500
    LOOP
      v_batch := v_batch + 1;
      v_last_at := t.occurred_at;
      v_last_id := t.id;

      r := public.resolve_meta_match_for_touch(t);

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
-- set_touch_meta_match (mismo cuerpo; quitar un vinculo manual vuelve a resolver con la regla nueva)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_touch_meta_match(
  p_workspace_id uuid,
  p_touch_id uuid,
  p_action text,
  p_user_id uuid,
  p_ad_id text DEFAULT NULL,
  p_adset_id text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t          public.contact_touches%ROWTYPE;
  v_before   jsonb;
  v_ad       text := nullif(btrim(p_ad_id), '');
  v_adset    text := nullif(btrim(p_adset_id), '');
  v_campaign text := nullif(btrim(p_campaign_id), '');
  a_adset    text;
  a_campaign text;
  s_campaign text;
  r          jsonb;
BEGIN
  IF p_action NOT IN ('link', 'ignore', 'unlink') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  SELECT * INTO t FROM public.contact_touches WHERE id = p_touch_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'touch_not_found');
  END IF;

  v_before := jsonb_build_object(
    'status', t.meta_match_status, 'ad_id', t.meta_ad_id, 'adset_id', t.meta_adset_id,
    'campaign_id', t.meta_campaign_id, 'method', t.meta_match_method
  );

  IF p_action = 'link' THEN
    -- Elegir un anuncio completa su conjunto y su campaña; un conjunto, su campaña. Todo tiene que estar en el catalogo.
    IF v_ad IS NOT NULL THEN
      SELECT a.adset_id, a.campaign_id INTO a_adset, a_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad LIMIT 1;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_adset := coalesce(a_adset, v_adset);
      v_campaign := coalesce(a_campaign, v_campaign);
    END IF;
    IF v_adset IS NOT NULL THEN
      SELECT s.campaign_id INTO s_campaign FROM public.meta_adsets s
       WHERE s.workspace_id = p_workspace_id AND s.adset_id = v_adset LIMIT 1;
      IF NOT FOUND AND v_ad IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_campaign := coalesce(v_campaign, s_campaign);
    END IF;
    IF v_campaign IS NOT NULL AND v_ad IS NULL AND v_adset IS NULL THEN
      PERFORM 1 FROM public.meta_campaigns c WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
    END IF;
    IF v_ad IS NULL AND v_adset IS NULL AND v_campaign IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_link');
    END IF;

    UPDATE public.contact_touches
       SET meta_ad_id = v_ad, meta_adset_id = v_adset, meta_campaign_id = v_campaign,
           meta_match_status = 'manual', meta_match_method = 'manual', meta_match_reason = NULL,
           meta_matched_at = now(), meta_match_by = p_user_id
     WHERE id = t.id;

  ELSIF p_action = 'ignore' THEN
    UPDATE public.contact_touches
       SET meta_ad_id = NULL, meta_adset_id = NULL, meta_campaign_id = NULL,
           meta_match_status = 'ignored', meta_match_method = NULL, meta_match_reason = NULL,
           meta_matched_at = now(), meta_match_by = p_user_id
     WHERE id = t.id;

  ELSE
    -- unlink: solo tiene sentido sobre lo que una persona toco; vuelve a resolverse solo.
    IF t.meta_match_status NOT IN ('manual', 'ignored') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_manual');
    END IF;
    r := public.resolve_meta_match_for_touch(t);
    UPDATE public.contact_touches
       SET meta_campaign_id = r->>'campaign_id', meta_adset_id = r->>'adset_id', meta_ad_id = r->>'ad_id',
           meta_match_status = coalesce(r->>'status', 'none'), meta_match_method = r->>'method',
           meta_match_reason = r->>'reason',
           meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END,
           meta_match_by = NULL
     WHERE id = t.id;
  END IF;

  PERFORM private.refresh_contact_attribution(t.contact_id);

  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', t.contact_id,
    'before', v_before,
    'after', (SELECT jsonb_build_object(
        'status', x.meta_match_status, 'ad_id', x.meta_ad_id, 'adset_id', x.meta_adset_id,
        'campaign_id', x.meta_campaign_id, 'method', x.meta_match_method)
      FROM public.contact_touches x WHERE x.id = t.id)
  );
END;
$$;

-- ------------------------------------------------------------
-- Corregir lo que dejo la 00193: toques `unmatched` que no tenian datos de Meta vuelven a `none`
-- ------------------------------------------------------------
DO $$
DECLARE
  v_contacts uuid[];
  v_n int;
BEGIN
  WITH fixed AS (
    UPDATE public.contact_touches ct
       SET meta_match_status = 'none', meta_match_method = NULL, meta_match_reason = NULL,
           meta_matched_at = NULL, meta_campaign_id = NULL, meta_adset_id = NULL, meta_ad_id = NULL
     WHERE ct.meta_match_status IN ('unmatched', 'matched')
       AND NOT private.meta_touch_has_data(ct)
    RETURNING ct.contact_id
  )
  SELECT array_agg(DISTINCT contact_id), count(*) INTO v_contacts, v_n FROM fixed;

  IF v_contacts IS NOT NULL THEN
    PERFORM private.refresh_contact_attribution(c) FROM unnest(v_contacts) AS c;
  END IF;
  RAISE NOTICE '00194: % toque(s) sin datos de Meta vuelven a none', coalesce(v_n, 0);
END $$;
