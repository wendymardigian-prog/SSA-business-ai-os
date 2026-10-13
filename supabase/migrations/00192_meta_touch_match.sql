-- ============================================================================
-- 00192 — Vinculo de cada toque con su campaña, conjunto y anuncio de Meta  (M7 del Extra L, AT3)
-- ============================================================================
-- Cada toque del CRM (`contact_touches`) puede traer datos de un anuncio: ids (`ad_id`, `adset_id`,
-- `campaign_id`), UTMs (`campaign`, `content_label`, `term`) o un `fbclid`. Esta migracion los
-- RESUELVE contra el catalogo de Meta (00191) y deja el resultado en el propio toque:
--
--   meta_campaign_id / meta_adset_id / meta_ad_id   lo que se encontro (ids de Meta)
--   meta_match_status   none | matched | unmatched | manual | ignored   (default none)
--   meta_match_method   como se encontro (ad_id, utm_content_id, utm_content_name, ...)
--   meta_match_reason   por que no, o que advertencia hay (id_not_in_catalog, ambiguous_ad_name, ...)
--   meta_matched_at / meta_match_by   cuando y quien (este ultimo solo en lo manual)
--
-- Piezas:
--  - `private.meta_url_decode(text)`: `%XX` y `+` (los UTMs a veces llegan codificados).
--  - `public.resolve_meta_match(...)`: la resolucion, pura sobre el catalogo. STABLE, SECURITY DEFINER,
--    solo service_role. Su gemela en TypeScript es lib/attribution/meta-match.ts, y los casos compartidos
--    estan en lib/attribution/meta-match.cases.json (corren contra las dos).
--  - Trigger `contact_touches_meta_match` (BEFORE INSERT): completa las columnas. **Todo dentro de
--    BEGIN ... EXCEPTION WHEN OTHERS**: ante CUALQUIER error deja `none` y un RAISE WARNING. NUNCA hace
--    fallar el insert (un toque que no se guarda es un lead sin atribucion).
--  - `contact_touch_json` suma los campos `meta_*` (la definicion vieja completa esta mas abajo).
--  - `private.refresh_contact_attribution(uuid)`: recalcula `first_touch`/`last_touch` con EXACTAMENTE
--    el mismo orden que `record_contact_touch` (occurred_at, created_at, id).
--  - `public.rematch_meta_touches(ws, since)`: vuelve a resolver los toques sin vincular (F28).
--  - `public.set_touch_meta_match(...)`: vincular/ignorar/quitar a mano (F29), atomica. Va en `public`
--    porque la API solo expone ese esquema: la logica es la misma que pide el plano para las acciones.
--
-- NO se toca `record_contact_touch` (su huella tiene que seguir igual) ni `find_or_link_contact`.
-- El backfill de los toques viejos lo hace la 00193, aparte.
--
-- Como volver atras (los toques ya guardados conservan sus columnas `meta_*`; se pierden solo al dropearlas):
--   DROP TRIGGER IF EXISTS contact_touches_meta_match ON public.contact_touches;
--   DROP FUNCTION IF EXISTS public.contact_touches_meta_match_trg();
--   DROP FUNCTION IF EXISTS public.set_touch_meta_match(uuid, uuid, text, uuid, text, text, text);
--   DROP FUNCTION IF EXISTS public.rematch_meta_touches(uuid, timestamptz);
--   DROP FUNCTION IF EXISTS private.refresh_contact_attribution(uuid);
--   DROP FUNCTION IF EXISTS public.resolve_meta_match(uuid, text, text, text, text, text, text, text);
--   DROP FUNCTION IF EXISTS private.meta_url_decode(text);
--   -- y la definicion VIEJA de contact_touch_json (la de abajo, sin los meta_*), luego:
--   ALTER TABLE public.contact_touches
--     DROP COLUMN IF EXISTS meta_campaign_id, DROP COLUMN IF EXISTS meta_adset_id, DROP COLUMN IF EXISTS meta_ad_id,
--     DROP COLUMN IF EXISTS meta_match_status, DROP COLUMN IF EXISTS meta_match_method, DROP COLUMN IF EXISTS meta_match_reason,
--     DROP COLUMN IF EXISTS meta_matched_at, DROP COLUMN IF EXISTS meta_match_by;
-- Riesgo: alto (cambia una funcion que usan todos los toques y suma un trigger que corre en cada insert).
--
-- Definicion VIGENTE de contact_touch_json antes de esta migracion (pg_get_functiondef de la base viva):
--
--   CREATE OR REPLACE FUNCTION public.contact_touch_json(t contact_touches)
--    RETURNS jsonb
--    LANGUAGE sql
--    IMMUTABLE
--    SET search_path TO ''
--   AS $function$
--     SELECT jsonb_strip_nulls(jsonb_build_object(
--       'occurred_at',     t.occurred_at,
--       'source',          t.source,
--       'medium',          t.medium,
--       'campaign',        t.campaign,
--       'content',         t.content_label,
--       'term',            t.term,
--       'medium_raw',      CASE WHEN t.medium_raw THEN true END,
--       'social_post_id',  t.social_post_id,
--       'content_post_id', t.content_post_id,
--       'ad_id',           t.ad_id,
--       'adset_id',        t.adset_id,
--       'campaign_id',     t.campaign_id,
--       'fbclid',          t.fbclid,
--       'gclid',           t.gclid,
--       'ttclid',          t.ttclid,
--       'li_fat_id',       t.li_fat_id,
--       'ctwa_clid',       t.ctwa_clid,
--       'referrer_url',    t.referrer_url,
--       'landing_page',    t.landing_page,
--       'origin',          t.origin
--     ))
--   $function$
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Columnas del vinculo
-- ------------------------------------------------------------
ALTER TABLE public.contact_touches
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  ADD COLUMN IF NOT EXISTS meta_match_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS meta_match_method text,
  ADD COLUMN IF NOT EXISTS meta_match_reason text,
  ADD COLUMN IF NOT EXISTS meta_matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_match_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_touches_meta_match_status_check') THEN
    ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_meta_match_status_check
      CHECK (meta_match_status IN ('none', 'matched', 'unmatched', 'manual', 'ignored'));
  END IF;
END $$;

COMMENT ON COLUMN public.contact_touches.meta_match_status IS
  'Resultado del vinculo con el catalogo de Meta: none (sin datos de anuncio), matched, unmatched, manual (lo eligio una persona) o ignored. Lo completa el trigger contact_touches_meta_match.';

-- Los indices que usan la tabla Meta vs CRM (AT4) y la pantalla "Sin vincular".
CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_ad
  ON public.contact_touches (workspace_id, meta_ad_id, occurred_at) WHERE meta_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_adset
  ON public.contact_touches (workspace_id, meta_adset_id, occurred_at) WHERE meta_adset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_campaign
  ON public.contact_touches (workspace_id, meta_campaign_id, occurred_at) WHERE meta_campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_touches_meta_unmatched
  ON public.contact_touches (workspace_id, occurred_at DESC) WHERE meta_match_status = 'unmatched';

-- Las busquedas por id del catalogo (el indice unico empieza por workspace + cuenta, y los ids de Meta son globales).
CREATE INDEX IF NOT EXISTS idx_meta_ads_ws_ad ON public.meta_ads (workspace_id, ad_id);
CREATE INDEX IF NOT EXISTS idx_meta_adsets_ws_adset ON public.meta_adsets (workspace_id, adset_id);
CREATE INDEX IF NOT EXISTS idx_meta_campaigns_ws_campaign ON public.meta_campaigns (workspace_id, campaign_id);

-- ------------------------------------------------------------
-- 2. Decodificar un UTM (%XX y +)
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.meta_url_decode(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_plus text;
  v_out text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  v_plus := replace(p_raw, '+', ' ');
  IF position('%' IN v_plus) = 0 THEN
    RETURN v_plus;
  END IF;
  BEGIN
    SELECT convert_from(
      string_agg(
        CASE WHEN m[1] IS NOT NULL THEN decode(substr(m[1], 2), 'hex') ELSE convert_to(m[2], 'UTF8') END,
        ''::bytea ORDER BY ord
      ),
      'UTF8'
    )
    INTO v_out
    FROM regexp_matches(v_plus, '(%[0-9A-Fa-f]{2})|([^%]+|%)', 'g') WITH ORDINALITY AS t(m, ord);
    RETURN coalesce(v_out, v_plus);
  EXCEPTION WHEN OTHERS THEN
    -- Un %XX que no es UTF-8 valido: se deja el texto como llego (igual que decodeURIComponent al fallar).
    RETURN v_plus;
  END;
END;
$$;

REVOKE ALL ON FUNCTION private.meta_url_decode(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. resolve_meta_match
-- ------------------------------------------------------------
-- Devuelve {status, ad_id, adset_id, campaign_id, method, reason}. La gemela en TypeScript esta en
-- lib/attribution/meta-match.ts; las dos tienen que dar lo mismo para los casos de meta-match.cases.json.
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

  -- Pistas de campaña (pasos 1, 2 y 4) para desempatar anuncios homonimos
  h_campaign     text;
  h_campaign_n   int;
  h_direct       text;
  v_name_key     text;
  v_n            int;

  ambiguous_ad       boolean := false;
  ambiguous_campaign boolean := false;
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

  -- ---- La campaña que se puede deducir SIN pasar por el anuncio (pistas 1, 2 y 4) ----
  IF v_campaign_id IS NOT NULL THEN
    SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
    IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
  END IF;
  IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
    SELECT c.campaign_id INTO h_campaign FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
    IF h_campaign IS NOT NULL THEN h_direct := h_campaign; END IF;
  END IF;
  IF h_campaign IS NULL AND v_utm_campaign IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_campaign);
    SELECT count(DISTINCT c.campaign_id), min(c.campaign_id) INTO h_campaign_n, h_campaign
      FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.name_key = v_name_key AND v_name_key <> '';
    IF h_campaign_n > 1 THEN
      h_campaign := NULL;
      ambiguous_campaign := true;
    END IF;
  END IF;

  -- ---- Anuncio ----
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
  IF r_ad IS NULL AND v_utm_content IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key;
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key LIMIT 1;
        m_ad := 'utm_content_name';
      ELSIF v_n > 1 THEN
        -- Varios anuncios con ese nombre: se desempata con la campaña (pistas 1, 2 y 4).
        IF h_campaign IS NOT NULL THEN
          SELECT count(*) INTO v_n FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign;
          IF v_n = 1 THEN
            SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
             WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key AND a.campaign_id = h_campaign LIMIT 1;
            m_ad := 'utm_content_name_campaign';
          END IF;
        END IF;
        IF r_ad IS NULL THEN ambiguous_ad := true; END IF;
      END IF;
    END IF;
  END IF;

  -- ---- Conjunto ----
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
  ELSIF h_campaign IS NOT NULL THEN
    -- El nombre de la campaña de una sola coincidencia (paso 4).
    r_campaign := h_campaign;
    m_campaign := 'utm_campaign_name';
  END IF;

  -- ---- Resultado ----
  IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
    v_status := 'matched';
    v_method := coalesce(m_ad, m_adset, m_campaign);
    IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
    IF ambiguous_campaign AND r_campaign IS NULL THEN v_notes := array_append(v_notes, 'ambiguous_campaign_name'); END IF;
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
    ELSIF ambiguous_ad THEN
      v_reason := 'ambiguous_ad_name';
    ELSIF ambiguous_campaign THEN
      v_reason := 'ambiguous_campaign_name';
    ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
      v_reason := 'name_not_found';
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
-- 4. El trigger BEFORE INSERT: nunca hace fallar el insert
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
    r := public.resolve_meta_match(
      NEW.workspace_id, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.campaign, NEW.content_label, NEW.term, NEW.fbclid
    );
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

REVOKE ALL ON FUNCTION public.contact_touches_meta_match_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contact_touches_meta_match ON public.contact_touches;
CREATE TRIGGER contact_touches_meta_match
  BEFORE INSERT ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.contact_touches_meta_match_trg();

-- ------------------------------------------------------------
-- 5. contact_touch_json suma los campos meta_*
-- ------------------------------------------------------------
-- `meta_match_status` solo se escribe cuando NO es 'none': un 'none' en cada toque ensuciaria
-- `contacts.attribution` sin decir nada. Con jsonb_strip_nulls, lo que es null desaparece.
CREATE OR REPLACE FUNCTION public.contact_touch_json(t public.contact_touches)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'occurred_at',     t.occurred_at,
    'source',          t.source,
    'medium',          t.medium,
    'campaign',        t.campaign,
    'content',         t.content_label,
    'term',            t.term,
    'medium_raw',      CASE WHEN t.medium_raw THEN true END,
    'social_post_id',  t.social_post_id,
    'content_post_id', t.content_post_id,
    'ad_id',           t.ad_id,
    'adset_id',        t.adset_id,
    'campaign_id',     t.campaign_id,
    'fbclid',          t.fbclid,
    'gclid',           t.gclid,
    'ttclid',          t.ttclid,
    'li_fat_id',       t.li_fat_id,
    'ctwa_clid',       t.ctwa_clid,
    'referrer_url',    t.referrer_url,
    'landing_page',    t.landing_page,
    'origin',          t.origin,
    'meta_campaign_id', t.meta_campaign_id,
    'meta_adset_id',    t.meta_adset_id,
    'meta_ad_id',       t.meta_ad_id,
    'meta_match_status', CASE WHEN t.meta_match_status <> 'none' THEN t.meta_match_status END,
    'meta_match_method', t.meta_match_method
  ))
$function$;

-- ------------------------------------------------------------
-- 6. refresh_contact_attribution: el mismo calculo que record_contact_touch
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.refresh_contact_attribution(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_first jsonb;
  v_last  jsonb;
BEGIN
  -- Sin toques no hay nada que recalcular (record_contact_touch siempre inserta uno antes de escribir).
  PERFORM 1 FROM public.contact_touches WHERE contact_id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- El MISMO orden que record_contact_touch: occurred_at, created_at, id.
  SELECT public.contact_touch_json(t) INTO v_first
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at ASC, t.created_at ASC, t.id ASC
  LIMIT 1;

  SELECT public.contact_touch_json(t) INTO v_last
  FROM public.contact_touches t
  WHERE t.contact_id = p_contact_id
  ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
  LIMIT 1;

  UPDATE public.contacts
  SET attribution = coalesce(attribution, '{}'::jsonb)
        || jsonb_build_object('version', 2, 'first_touch', v_first, 'last_touch', v_last)
  WHERE id = p_contact_id;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_contact_attribution(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_contact_attribution(uuid) TO service_role;

-- ------------------------------------------------------------
-- 7. rematch_meta_touches: volver a resolver lo que quedo sin vincular
-- ------------------------------------------------------------
-- Toques con datos de Meta que quedaron `unmatched` o `none` (o `matched` pero sin anuncio, con datos
-- de anuncio): se resuelven de nuevo y, si cambia algo, se actualizan. NUNCA toca `manual` ni `ignored`.
-- De a 500 y con el contacto refrescado al final de cada lote. Devuelve cuantos toques cambiaron.
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
  t         record;
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
         AND (
           nullif(btrim(ct.ad_id), '') IS NOT NULL OR nullif(btrim(ct.adset_id), '') IS NOT NULL
           OR nullif(btrim(ct.campaign_id), '') IS NOT NULL OR nullif(btrim(ct.campaign), '') IS NOT NULL
           OR nullif(btrim(ct.content_label), '') IS NOT NULL OR nullif(btrim(ct.term), '') IS NOT NULL
           OR nullif(btrim(ct.fbclid), '') IS NOT NULL
         )
       ORDER BY ct.occurred_at, ct.id
       LIMIT 500
    LOOP
      v_batch := v_batch + 1;
      v_last_at := t.occurred_at;
      v_last_id := t.id;

      r := public.resolve_meta_match(
        t.workspace_id, t.ad_id, t.adset_id, t.campaign_id, t.campaign, t.content_label, t.term, t.fbclid
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

REVOKE ALL ON FUNCTION public.rematch_meta_touches(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rematch_meta_touches(uuid, timestamptz) TO service_role;

-- ------------------------------------------------------------
-- 8. set_touch_meta_match: vincular, ignorar o quitar a mano (atomica)
-- ------------------------------------------------------------
-- p_action: 'link' (con al menos un id del catalogo), 'ignore' o 'unlink' (vuelve a resolver solo).
-- Devuelve {ok, contact_id, before, after} o {ok:false, error}. El permiso y la visibilidad del contacto
-- los chequea quien llama (la Server Action, con la sesion); esto verifica el workspace del toque.
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
    r := public.resolve_meta_match(
      t.workspace_id, t.ad_id, t.adset_id, t.campaign_id, t.campaign, t.content_label, t.term, t.fbclid
    );
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

REVOKE ALL ON FUNCTION public.set_touch_meta_match(uuid, uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_touch_meta_match(uuid, uuid, text, uuid, text, text, text) TO service_role;
