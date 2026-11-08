-- ============================================================================
-- 00318 — Conciliacion de anuncios: reglas, nombre exacto, parecido y el canal de los formularios
-- ============================================================================
-- Lo que mostraba «Sin vincular» (produccion, 7/11/2026): links de la bio y de ManyChat que no son anuncios (la fuente
-- «ig» contaba como Meta y el fbclid que Instagram agrega a cualquier link tambien), y anuncios cuyos UTMs son
-- etiquetas escritas a mano («clase-9-nov» / «ad-n4-techo») que no coinciden con los nombres de Meta («N4 · El techo»).
--
-- La regla (la misma en TypeScript: lib/attribution/meta-match.ts, con meta-match.cases.json):
--   1. Por id, como siempre (00299).
--   2. Una REGLA de `meta_match_rules`: «estos UTMs (campaign, content, term) = este anuncio» o «no es un anuncio».
--      La crea una persona desde «Sin vincular» y vale para lo que ya llego y lo que llegue. Nunca contradice un
--      conjunto o una campaña que vinieron por id.
--   3. El anuncio por nombre exacto adentro de lo conocido por id (00299).
--   4. Sin ids: la campaña por su nombre exacto si es UNICO (`utm_campaign_name`); si no, por parecido: la unica
--      campaña cuyas palabras contienen todas las del utm_campaign (`utm_campaign_similar`).
--   5. El anuncio por nombre exacto dentro de esa campaña (`utm_content_name`).
--   6. El anuncio por PARECIDO: el unico del alcance (conjunto o campaña(s) ya halladas) cuyas palabras contienen todas
--      las del utm_content, con dos palabras o un codigo (n4, s3) (`utm_content_similar_adset|_campaign`).
--      Nunca contra el catalogo entero. Lo que se vincula por parecido queda en «Para revisar».
--   7. El unico anuncio del conjunto (00299).
--
-- Lo que cuenta como dato de Meta cambia:
--   - El fbclid solo ya no cuenta (Instagram y Facebook se lo agregan a cualquier link).
--   - Un utm_medium organico (social, bio, email...) gana: esos UTMs no son de un anuncio.
--   - «ig/instagram/fb» solo cuentan con un medium pago; «meta/facebook» cuentan salvo medium organico.
--
-- El canal: un formulario guarda medium = 'form' y el utm_medium real en raw.utm; `touch_channel` lo ignoraba (los
-- anuncios quedaban «directo»). El trigger ahora le pasa el medium efectivo (`private.touch_effective_medium`).
--
-- Cambia a proposito la huella de `resolve_meta_match` (scripts/protected-functions.mjs). Misma firma en todas.
-- `touch_channel` NO cambia. NO cambian: `record_contact_touch`, `create_booking`, `submit_form_response`,
-- `find_or_link_contact`.
-- Aditiva: una tabla nueva (`meta_match_rules`) y funciones. Va ANTES de desplegar el codigo (la pantalla lee la tabla).
-- Al final re-vincula lo existente (rematch de cada workspace con catalogo) y corrige el canal.
--
-- Como volver atras: aplicar las definiciones de abajo; DROP FUNCTION public.create_meta_match_rule(uuid, uuid, text,
-- text, text, text, text, text, text, text), public.delete_meta_match_rule(uuid, uuid),
-- private.meta_rematch_by_keys(uuid, text, text, text), private.meta_name_tokens(text), private.meta_tokens_qualify(text[]),
-- private.meta_rule_key(text), private.meta_touch_medium(public.contact_touches), private.meta_medium_is_paid(text),
-- private.meta_medium_is_organic(text), private.touch_effective_medium(text, jsonb); DROP TABLE public.meta_match_rules;
-- y `select public.rematch_meta_touches(<workspace>, '-infinity')` (no deshace un vinculo hecho: no empeora un matched).
-- Riesgo: medio (el trigger corre en cada toque nuevo; sigue envuelto en EXCEPTION y nunca hace fallar un insert).
--
-- La tarea de IA `ads_matching` («Vincular anuncios») suma su valor a los CHECK de `agent_runs.source` y
-- `ai_task_prompt_versions.task`. Los vigentes antes (leidos de la base el 7/11/2026):
--   agent_runs_source_check: CHECK ((source = ANY (ARRAY['agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
--     'conversation_summary', 'message_classification', 'message_classification_eval', 'content_copy', 'ads_analysis',
--     'audio_transcription', 'media_description', 'call_classification', 'call_analysis', 'call_correction', 'call_summary',
--     'call_prompt_test'])))
--   ai_task_prompt_versions_task_check: CHECK ((task = ANY (ARRAY['message_classification', 'conversation_summary',
--     'close_classification', 'media_description', 'ads_analysis', 'call_classification', 'call_analysis', 'call_summary'])))
--
-- Definiciones VIGENTES antes de esta migracion:
--
-- meta_touch_utm_counts, meta_touch_has_data y resolve_meta_match_for_touch (00299):
--   CREATE OR REPLACE FUNCTION private.meta_touch_utm_counts(t public.contact_touches)
--   RETURNS boolean
--   LANGUAGE sql
--   IMMUTABLE
--   SET search_path = ''
--   AS $$
--     SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
--         OR nullif(btrim(t.adset_id), '') IS NOT NULL
--         OR nullif(btrim(t.campaign_id), '') IS NOT NULL
--         OR (
--           t.origin IN ('booking', 'form', 'webhook', 'import', 'manual')
--           AND (
--             private.meta_source_counts(t.source)
--             OR private.meta_is_numeric(t.campaign)
--             OR private.meta_is_numeric(t.content_label)
--             OR private.meta_is_numeric(t.term)
--           )
--         )
--   $$;
--
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
--                OR nullif(btrim(t.term), '') IS NOT NULL
--                OR (private.meta_source_counts(t.source) AND private.meta_is_numeric(private.meta_touch_utm_id(t))))
--         )
--   $$;
--
--   CREATE OR REPLACE FUNCTION public.resolve_meta_match_for_touch(t public.contact_touches)
--   RETURNS jsonb
--   LANGUAGE sql
--   STABLE
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--     SELECT public.resolve_meta_match(
--       t.workspace_id, t.ad_id, t.adset_id,
--       coalesce(
--         nullif(btrim(t.campaign_id), ''),
--         CASE WHEN private.meta_touch_utm_counts(t) AND private.meta_source_counts(t.source)
--                   AND private.meta_is_numeric(private.meta_touch_utm_id(t))
--              THEN private.meta_touch_utm_id(t) END
--       ),
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.campaign END,
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.content_label END,
--       CASE WHEN private.meta_touch_utm_counts(t) THEN t.term END,
--       t.fbclid
--     )
--   $$;
--
-- resolve_meta_match (00299):
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
--     h_direct       text;
--     v_name_key     text;
--     v_n            int;
--
--     ambiguous_ad   boolean := false;
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
--     -- ---- La campaña por id ----
--     IF v_campaign_id IS NOT NULL THEN
--       SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
--        WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
--     END IF;
--     IF h_direct IS NULL AND v_utm_campaign IS NOT NULL THEN
--       SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
--        WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
--     END IF;
--
--     -- ---- Anuncio por id ----
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
--
--     -- ---- Conjunto por id ----
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
--
--     -- ---- Anuncio por nombre: solo adentro de lo que ya se conoce por id ----
--     IF r_ad IS NULL AND v_utm_content IS NOT NULL AND (r_adset IS NOT NULL OR h_direct IS NOT NULL) THEN
--       v_name_key := public.meta_name_key(v_utm_content);
--       IF v_name_key <> '' THEN
--         SELECT count(*) INTO v_n FROM public.meta_ads a
--          WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
--            AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END);
--         IF v_n = 1 THEN
--           SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--            WHERE a.workspace_id = p_workspace_id AND a.name_key = v_name_key
--              AND (CASE WHEN r_adset IS NOT NULL THEN a.adset_id = r_adset ELSE a.campaign_id = h_direct END)
--            LIMIT 1;
--           m_ad := CASE WHEN r_adset IS NOT NULL THEN 'utm_content_name_adset' ELSE 'utm_content_name_campaign' END;
--         ELSIF v_n > 1 THEN
--           ambiguous_ad := true;
--         END IF;
--       END IF;
--     END IF;
--
--     -- ---- El unico anuncio del conjunto. No si llego un id de anuncio que no esta en el catalogo: seria otro anuncio. ----
--     IF r_ad IS NULL AND r_adset IS NOT NULL AND NOT ambiguous_ad AND v_ad_id IS NULL
--        AND NOT private.meta_is_numeric(v_utm_content) THEN
--       SELECT count(*) INTO v_n FROM public.meta_ads a
--        WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset;
--       IF v_n = 1 THEN
--         SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
--          WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset LIMIT 1;
--         m_ad := 'adset_single_ad';
--       END IF;
--     END IF;
--
--     -- ---- El conjunto del anuncio ----
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
--     END IF;
--
--     -- ---- Resultado ----
--     IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
--       v_status := 'matched';
--       v_method := coalesce(m_ad, m_adset, m_campaign);
--       IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
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
--       ELSIF v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL THEN
--         v_reason := 'name_without_id';
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
-- contact_touches_zz_channel_trg (00230):
--   CREATE OR REPLACE FUNCTION public.contact_touches_zz_channel_trg()
--   RETURNS trigger
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_channel text := NEW.channel;
--     v_status text := NEW.meta_match_status;
--     v_reason text := NEW.meta_match_reason;
--   BEGIN
--     BEGIN
--       IF TG_OP = 'INSERT' THEN
--         IF v_channel IS NULL THEN
--           v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
--                                             NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
--         END IF;
--       ELSIF NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
--         -- Se actualizo algo que cambia el canal y nadie lo puso a mano: se recalcula.
--         v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
--                                           NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
--       END IF;
--
--       -- Un link organico con UTMs no es un anuncio sin vincular.
--       IF v_channel = 'organic'
--          AND (NEW.content_post_id IS NOT NULL OR NEW.social_post_id IS NOT NULL)
--          AND nullif(btrim(NEW.ad_id), '') IS NULL AND nullif(btrim(NEW.adset_id), '') IS NULL AND nullif(btrim(NEW.campaign_id), '') IS NULL
--          AND nullif(btrim(NEW.fbclid), '') IS NULL
--          AND nullif(btrim(NEW.meta_ad_id), '') IS NULL AND nullif(btrim(NEW.meta_adset_id), '') IS NULL AND nullif(btrim(NEW.meta_campaign_id), '') IS NULL
--          AND v_status = 'unmatched' THEN
--         v_status := 'ignored';
--         v_reason := 'organic_content';
--       END IF;
--
--       NEW.channel := v_channel;
--       NEW.meta_match_status := v_status;
--       NEW.meta_match_reason := v_reason;
--     EXCEPTION WHEN OTHERS THEN
--       NEW.channel := 'direct';
--       RAISE WARNING 'contact_touches_zz_channel: no pude calcular el canal del toque (%): %', NEW.id, SQLERRM;
--     END;
--
--     RETURN NEW;
--   END;
--   $$;
--
-- ============================================================================

SET search_path = '';

-- ------------------------------------------------------------
-- 1. Las palabras de un nombre y la clave de una regla
-- ------------------------------------------------------------
-- Las palabras de un nombre: meta_name_key, partido por todo lo que no es letra ni numero, sin relleno ni repetidos.
-- Gemela: metaNameTokens (lib/attribution/meta-match.ts). La lista de relleno es la misma en las dos.
CREATE OR REPLACE FUNCTION private.meta_name_tokens(p_raw text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(DISTINCT w ORDER BY w), ARRAY[]::text[])
    FROM unnest(regexp_split_to_array(coalesce(public.meta_name_key(p_raw), ''), '[^a-z0-9]+')) AS w
   WHERE w <> ''
     AND w <> ALL (ARRAY['ad', 'ads', 'anuncio', 'anuncios', 'campana', 'campanas', 'campaign', 'conjunto', 'adset',
                         'copia', 'copy', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'e', 'en', 'un', 'una', 'a', 'al',
                         'con', 'por', 'para', 'the', 'of', 'and'])
$$;

-- ¿Alcanzan estas palabras para buscar un anuncio por parecido? Dos o mas, o un codigo con letras y numeros (n4, s3).
CREATE OR REPLACE FUNCTION private.meta_tokens_qualify(p_tokens text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(cardinality(p_tokens), 0) >= 2
      OR EXISTS (SELECT 1 FROM unnest(coalesce(p_tokens, ARRAY[]::text[])) w WHERE w ~ '[a-z]' AND w ~ '[0-9]')
$$;

-- La clave de un valor de UTM para una regla: decodificado, recortado y con meta_name_key. Vacio = no vino.
CREATE OR REPLACE FUNCTION private.meta_rule_key(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(public.meta_name_key(nullif(btrim(private.meta_url_decode(p_raw)), '')), '')
$$;

REVOKE ALL ON FUNCTION private.meta_name_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_tokens_qualify(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_rule_key(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. Las reglas: «estos UTMs = este anuncio» (o «no es un anuncio»)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_match_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_key  text NOT NULL DEFAULT '',
  content_key   text NOT NULL DEFAULT '',
  term_key      text NOT NULL DEFAULT '',
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  action        text NOT NULL,
  ad_id         text,
  adset_id      text,
  campaign_id   text,
  origin        text NOT NULL DEFAULT 'manual',
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_match_rules_action_check') THEN
    ALTER TABLE public.meta_match_rules ADD CONSTRAINT meta_match_rules_action_check CHECK (action IN ('link', 'ignore'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_match_rules_origin_check') THEN
    ALTER TABLE public.meta_match_rules ADD CONSTRAINT meta_match_rules_origin_check CHECK (origin IN ('manual', 'confirmed', 'ai'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_match_rules_keys_check') THEN
    ALTER TABLE public.meta_match_rules ADD CONSTRAINT meta_match_rules_keys_check CHECK (campaign_key <> '' OR content_key <> '' OR term_key <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_match_rules_target_check') THEN
    ALTER TABLE public.meta_match_rules ADD CONSTRAINT meta_match_rules_target_check
      CHECK ((action = 'ignore' AND ad_id IS NULL AND adset_id IS NULL AND campaign_id IS NULL)
          OR (action = 'link' AND coalesce(ad_id, adset_id, campaign_id) IS NOT NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_match_rules_keys ON public.meta_match_rules (workspace_id, campaign_key, content_key, term_key);

ALTER TABLE public.meta_match_rules ENABLE ROW LEVEL SECURITY;

-- Las ve quien ve los anuncios. Escribe solo el servidor (create_meta_match_rule / delete_meta_match_rule).
DROP POLICY IF EXISTS meta_match_rules_select ON public.meta_match_rules;
CREATE POLICY meta_match_rules_select ON public.meta_match_rules FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id) AND public.has_permission(workspace_id, 'dashboards.ads.view'));

REVOKE ALL ON public.meta_match_rules FROM anon, authenticated;
GRANT SELECT ON public.meta_match_rules TO authenticated;
GRANT ALL ON public.meta_match_rules TO service_role;

-- ------------------------------------------------------------
-- 3. Lo que cuenta como dato de Meta
-- ------------------------------------------------------------
-- El utm_medium que mando la persona: un formulario y una reunion lo guardan en raw.utm; si no, la columna medium.
CREATE OR REPLACE FUNCTION private.meta_touch_medium(t public.contact_touches)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(lower(btrim(coalesce(t.raw->'utm'->>'utm_medium', t.raw->>'utm_medium'))), ''),
    nullif(lower(btrim(t.medium)), '')
  )
$$;

CREATE OR REPLACE FUNCTION private.meta_medium_is_paid(p_medium text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(lower(btrim(p_medium)) IN ('paid', 'paid_social', 'paidsocial', 'paid-social', 'cpc', 'ppc', 'cpm', 'display', 'paid_search', 'ads', 'ad'), false)
$$;

CREATE OR REPLACE FUNCTION private.meta_medium_is_organic(p_medium text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(lower(btrim(p_medium)) IN ('social', 'organic', 'organic_social', 'bio', 'link_in_bio', 'referral', 'email',
                                             'newsletter', 'dm', 'dm_link', 'story', 'story_reply', 'story_mention', 'comment',
                                             'whatsapp', 'whatsapp_group', 'sms'), false)
$$;

REVOKE ALL ON FUNCTION private.meta_touch_medium(public.contact_touches) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_medium_is_paid(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.meta_medium_is_organic(text) FROM PUBLIC, anon, authenticated;

-- Los UTMs de texto cuentan si el toque ya trae un id, o si puede traer UTMs (agenda, formulario, webhook, importado,
-- manual), el medium no es organico y ademas: algun UTM es numerico, la fuente es «meta»/«facebook», o el medium
-- es pago y la fuente puede ser de Meta. «ig»/«instagram» sin un medium pago no alcanza: es el link de la bio o ManyChat.
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
        AND NOT private.meta_medium_is_organic(private.meta_touch_medium(t))
        AND (
          private.meta_is_numeric(t.campaign)
          OR private.meta_is_numeric(t.content_label)
          OR private.meta_is_numeric(t.term)
          OR coalesce(lower(btrim(t.source)), '') IN ('meta', 'facebook', 'meta_ads', 'facebook_ads', 'fb_ads')
          OR (private.meta_medium_is_paid(private.meta_touch_medium(t)) AND private.meta_source_counts(t.source))
        )
      )
$$;

-- El fbclid solo ya no cuenta: Instagram y Facebook se lo agregan a cualquier link, tambien al de la bio.
CREATE OR REPLACE FUNCTION private.meta_touch_has_data(t public.contact_touches)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(t.ad_id), '') IS NOT NULL
      OR nullif(btrim(t.adset_id), '') IS NOT NULL
      OR nullif(btrim(t.campaign_id), '') IS NOT NULL
      OR (
        private.meta_touch_utm_counts(t)
        AND (nullif(btrim(t.campaign), '') IS NOT NULL
             OR nullif(btrim(t.content_label), '') IS NOT NULL
             OR nullif(btrim(t.term), '') IS NOT NULL
             OR (private.meta_source_counts(t.source) AND private.meta_is_numeric(private.meta_touch_utm_id(t))))
      )
$$;

-- Igual que la 00299, salvo el fbclid: ya no se pasa (solo no dice nada).
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
    NULL
  )
$$;

REVOKE ALL ON FUNCTION public.resolve_meta_match_for_touch(public.contact_touches) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_match_for_touch(public.contact_touches) TO service_role;

-- ------------------------------------------------------------
-- 4. resolve_meta_match: ids -> regla -> nombre exacto -> parecido
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
  h_named        text;
  m_named        text;
  v_scope        text[];
  v_name_key     text;
  v_tokens       text[];
  v_n            int;
  v_rule         public.meta_match_rules%ROWTYPE;

  ambiguous_ad       boolean := false;
  ambiguous_campaign boolean := false;
  v_notes        text[] := ARRAY[]::text[];
  v_status       text;
  v_method       text;
  v_reason       text;
BEGIN
  IF v_ad_id IS NULL AND v_adset_id IS NULL AND v_campaign_id IS NULL
     AND v_utm_campaign IS NULL AND v_utm_content IS NULL AND v_utm_term IS NULL AND v_fbclid IS NULL THEN
    RETURN jsonb_build_object('status', 'none', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', NULL, 'reason', NULL);
  END IF;

  -- ---- 1. Por id ----
  IF v_campaign_id IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_campaign_id LIMIT 1;
  END IF;
  IF h_direct IS NULL AND v_utm_campaign IS NOT NULL THEN
    SELECT c.campaign_id INTO h_direct FROM public.meta_campaigns c
     WHERE c.workspace_id = p_workspace_id AND c.campaign_id = v_utm_campaign LIMIT 1;
  END IF;

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

  -- ---- 2. Una regla (lo que decidio una persona para estos mismos UTMs) ----
  IF r_ad IS NULL AND (v_utm_campaign IS NOT NULL OR v_utm_content IS NOT NULL OR v_utm_term IS NOT NULL) THEN
    SELECT * INTO v_rule FROM public.meta_match_rules mr
     WHERE mr.workspace_id = p_workspace_id
       AND mr.campaign_key = coalesce(public.meta_name_key(v_utm_campaign), '')
       AND mr.content_key = coalesce(public.meta_name_key(v_utm_content), '')
       AND mr.term_key = coalesce(public.meta_name_key(v_utm_term), '')
     LIMIT 1;
    IF FOUND THEN
      IF v_rule.action = 'ignore' THEN
        -- «No es un anuncio» solo vale si ningun id dijo lo contrario.
        IF r_adset IS NULL AND h_direct IS NULL THEN
          RETURN jsonb_build_object('status', 'ignored', 'ad_id', NULL, 'adset_id', NULL, 'campaign_id', NULL, 'method', 'rule', 'reason', NULL);
        END IF;
      -- Una regla nunca contradice un conjunto o una campaña que vinieron por id.
      ELSIF (r_adset IS NULL OR v_rule.adset_id IS NULL OR v_rule.adset_id = r_adset)
        AND (h_direct IS NULL OR v_rule.campaign_id IS NULL OR v_rule.campaign_id = h_direct) THEN
        IF v_rule.ad_id IS NOT NULL THEN
          r_ad := v_rule.ad_id;
          r_ad_adset := v_rule.adset_id;
          r_ad_campaign := v_rule.campaign_id;
          m_ad := 'rule';
        ELSIF v_rule.adset_id IS NOT NULL AND r_adset IS NULL THEN
          r_adset := v_rule.adset_id;
          r_adset_camp := v_rule.campaign_id;
          m_adset := 'rule';
        ELSIF v_rule.campaign_id IS NOT NULL AND h_direct IS NULL THEN
          h_named := v_rule.campaign_id;
          m_named := 'rule';
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---- 3. Anuncio por nombre exacto, adentro de lo que se conoce por id ----
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

  -- ---- 4. Sin ningun id: la campaña por su nombre (unico) o, si no, por parecido ----
  IF r_ad IS NULL AND r_adset IS NULL AND h_direct IS NULL AND h_named IS NULL
     AND v_utm_campaign IS NOT NULL AND NOT private.meta_is_numeric(v_utm_campaign) THEN
    v_name_key := public.meta_name_key(v_utm_campaign);
    IF v_name_key <> '' THEN
      SELECT count(*), min(c.campaign_id) INTO v_n, h_named FROM public.meta_campaigns c
       WHERE c.workspace_id = p_workspace_id AND c.name_key = v_name_key;
      IF v_n = 1 THEN
        m_named := 'utm_campaign_name';
      ELSE
        h_named := NULL;
        IF v_n > 1 THEN ambiguous_campaign := true; END IF;
      END IF;
    END IF;
    IF h_named IS NULL THEN
      v_tokens := private.meta_name_tokens(v_utm_campaign);
      IF cardinality(v_tokens) > 0 THEN
        SELECT coalesce(array_agg(c.campaign_id ORDER BY c.campaign_id), ARRAY[]::text[]) INTO v_scope
          FROM public.meta_campaigns c
         WHERE c.workspace_id = p_workspace_id AND private.meta_name_tokens(c.name_key) @> v_tokens;
        IF cardinality(v_scope) = 1 THEN
          h_named := v_scope[1];
          m_named := 'utm_campaign_similar';
        ELSIF cardinality(v_scope) > 1 THEN
          ambiguous_campaign := true;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ---- 5. Anuncio por nombre exacto dentro de la campaña hallada por su nombre ----
  IF r_ad IS NULL AND v_ad_id IS NULL AND m_named = 'utm_campaign_name' AND v_utm_content IS NOT NULL THEN
    v_name_key := public.meta_name_key(v_utm_content);
    IF v_name_key <> '' THEN
      SELECT count(*) INTO v_n FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.campaign_id = h_named AND a.name_key = v_name_key;
      IF v_n = 1 THEN
        SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.campaign_id = h_named AND a.name_key = v_name_key LIMIT 1;
        m_ad := 'utm_content_name';
      ELSIF v_n > 1 THEN
        ambiguous_ad := true;
      END IF;
    END IF;
  END IF;

  -- ---- 6. Anuncio por parecido: el UNICO del alcance cuyas palabras contienen todas las del utm_content ----
  IF r_ad IS NULL AND v_ad_id IS NULL AND NOT ambiguous_ad AND v_utm_content IS NOT NULL
     AND NOT private.meta_is_numeric(v_utm_content) THEN
    v_tokens := private.meta_name_tokens(v_utm_content);
    v_n := 0;
    IF private.meta_tokens_qualify(v_tokens) THEN
      IF r_adset IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset AND private.meta_name_tokens(a.name_key) @> v_tokens;
        IF v_n = 1 THEN
          SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.adset_id = r_adset AND private.meta_name_tokens(a.name_key) @> v_tokens LIMIT 1;
          m_ad := 'utm_content_similar_adset';
        END IF;
      ELSIF coalesce(h_direct, h_named) IS NOT NULL OR cardinality(v_scope) > 1 THEN
        IF coalesce(h_direct, h_named) IS NOT NULL THEN v_scope := ARRAY[coalesce(h_direct, h_named)]; END IF;
        SELECT count(*) INTO v_n FROM public.meta_ads a
         WHERE a.workspace_id = p_workspace_id AND a.campaign_id = ANY (v_scope) AND private.meta_name_tokens(a.name_key) @> v_tokens;
        IF v_n = 1 THEN
          SELECT a.ad_id, a.adset_id, a.campaign_id INTO r_ad, r_ad_adset, r_ad_campaign FROM public.meta_ads a
           WHERE a.workspace_id = p_workspace_id AND a.campaign_id = ANY (v_scope) AND private.meta_name_tokens(a.name_key) @> v_tokens LIMIT 1;
          m_ad := 'utm_content_similar_campaign';
        END IF;
      END IF;
      IF v_n > 1 THEN ambiguous_ad := true; END IF;
    END IF;
  END IF;

  -- ---- 7. El unico anuncio del conjunto (no si llego un id de anuncio desconocido: seria otro anuncio) ----
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
    IF r_ad IS NOT NULL AND r_ad_campaign IS NOT NULL AND r_ad_campaign <> r_campaign THEN
      r_campaign := r_ad_campaign;
      m_campaign := m_ad;
      v_notes := array_append(v_notes, 'inconsistent_campaign');
    END IF;
  ELSIF r_ad_campaign IS NOT NULL OR r_adset_camp IS NOT NULL THEN
    r_campaign := coalesce(r_ad_campaign, r_adset_camp);
    m_campaign := CASE WHEN r_ad_campaign IS NOT NULL THEN m_ad ELSE m_adset END;
  ELSIF h_named IS NOT NULL THEN
    r_campaign := h_named;
    m_campaign := m_named;
  END IF;

  -- ---- Resultado ----
  IF r_ad IS NOT NULL OR r_adset IS NOT NULL OR r_campaign IS NOT NULL THEN
    v_status := 'matched';
    v_method := coalesce(m_ad, m_adset, m_campaign);
    IF ambiguous_ad THEN v_notes := array_append(v_notes, 'ambiguous_ad_name'); END IF;
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
    ELSIF v_utm_campaign IS NOT NULL AND NOT private.meta_is_numeric(v_utm_campaign) THEN
      v_reason := 'name_not_found';
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
-- 5. Crear, aplicar y borrar una regla
-- ------------------------------------------------------------
-- Vuelve a resolver los toques con esta clave. Nunca toca lo que eligio una persona (manual, o ignorado por alguien).
CREATE OR REPLACE FUNCTION private.meta_rematch_by_keys(p_workspace_id uuid, p_campaign_key text, p_content_key text, p_term_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t          public.contact_touches%ROWTYPE;
  r          jsonb;
  v_changed  int := 0;
  v_contacts uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR t IN
    SELECT ct.* FROM public.contact_touches ct
     WHERE ct.workspace_id = p_workspace_id
       AND ct.meta_match_status IN ('none', 'unmatched', 'matched', 'ignored')
       AND NOT (ct.meta_match_status = 'ignored' AND ct.meta_match_by IS NOT NULL)
       AND private.meta_touch_utm_counts(ct)
       AND private.meta_rule_key(ct.campaign) = p_campaign_key
       AND private.meta_rule_key(ct.content_label) = p_content_key
       AND private.meta_rule_key(ct.term) = p_term_key
     FOR UPDATE
  LOOP
    r := public.resolve_meta_match_for_touch(t);
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
             meta_matched_at = CASE WHEN r->>'status' IN ('matched', 'ignored') THEN now() END
       WHERE id = t.id;
      v_changed := v_changed + 1;
      v_contacts := array_append(v_contacts, t.contact_id);
    END IF;
  END LOOP;

  PERFORM private.refresh_contact_attribution(c) FROM (SELECT DISTINCT unnest(v_contacts) AS c) x;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION private.meta_rematch_by_keys(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- Crea (o reemplaza) la regla para estos UTMs y la aplica a todos los toques que los traen.
-- El destino tiene que estar en el catalogo: un anuncio completa su conjunto y su campaña; un conjunto, su campaña.
CREATE OR REPLACE FUNCTION public.create_meta_match_rule(
  p_workspace_id uuid,
  p_user_id uuid,
  p_utm_campaign text,
  p_utm_content text,
  p_utm_term text,
  p_action text,
  p_ad_id text DEFAULT NULL,
  p_adset_id text DEFAULT NULL,
  p_campaign_id text DEFAULT NULL,
  p_origin text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ckey     text := private.meta_rule_key(p_utm_campaign);
  v_kkey     text := private.meta_rule_key(p_utm_content);
  v_tkey     text := private.meta_rule_key(p_utm_term);
  v_ad       text := nullif(btrim(p_ad_id), '');
  v_adset    text := nullif(btrim(p_adset_id), '');
  v_campaign text := nullif(btrim(p_campaign_id), '');
  a_adset    text;
  a_campaign text;
  s_campaign text;
  v_id       uuid;
  v_applied  int;
BEGIN
  IF p_action NOT IN ('link', 'ignore') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF coalesce(p_origin, '') NOT IN ('manual', 'confirmed', 'ai') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_origin');
  END IF;
  IF v_ckey = '' AND v_kkey = '' AND v_tkey = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_keys');
  END IF;

  IF p_action = 'link' THEN
    IF v_ad IS NOT NULL THEN
      SELECT a.adset_id, a.campaign_id INTO a_adset, a_campaign FROM public.meta_ads a
       WHERE a.workspace_id = p_workspace_id AND a.ad_id = v_ad LIMIT 1;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_in_catalog'); END IF;
      v_adset := a_adset;
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
  ELSE
    v_ad := NULL; v_adset := NULL; v_campaign := NULL;
  END IF;

  INSERT INTO public.meta_match_rules AS mr
    (workspace_id, campaign_key, content_key, term_key, utm_campaign, utm_content, utm_term,
     action, ad_id, adset_id, campaign_id, origin, created_by)
  VALUES
    (p_workspace_id, v_ckey, v_kkey, v_tkey,
     nullif(btrim(private.meta_url_decode(p_utm_campaign)), ''),
     nullif(btrim(private.meta_url_decode(p_utm_content)), ''),
     nullif(btrim(private.meta_url_decode(p_utm_term)), ''),
     p_action, v_ad, v_adset, v_campaign, p_origin, p_user_id)
  ON CONFLICT (workspace_id, campaign_key, content_key, term_key) DO UPDATE
    SET action = EXCLUDED.action, ad_id = EXCLUDED.ad_id, adset_id = EXCLUDED.adset_id, campaign_id = EXCLUDED.campaign_id,
        origin = EXCLUDED.origin, created_by = EXCLUDED.created_by, updated_at = now()
  RETURNING mr.id INTO v_id;

  v_applied := private.meta_rematch_by_keys(p_workspace_id, v_ckey, v_kkey, v_tkey);

  RETURN jsonb_build_object('ok', true, 'rule_id', v_id, 'applied', v_applied,
                            'ad_id', v_ad, 'adset_id', v_adset, 'campaign_id', v_campaign);
END;
$$;

-- Borra la regla y vuelve a resolver sus toques (pueden quedar sin vincular: es lo que se pidio).
CREATE OR REPLACE FUNCTION public.delete_meta_match_rule(p_workspace_id uuid, p_rule_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rule    public.meta_match_rules%ROWTYPE;
  v_changed int;
BEGIN
  DELETE FROM public.meta_match_rules WHERE id = p_rule_id AND workspace_id = p_workspace_id RETURNING * INTO v_rule;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rule_not_found');
  END IF;
  v_changed := private.meta_rematch_by_keys(p_workspace_id, v_rule.campaign_key, v_rule.content_key, v_rule.term_key);
  RETURN jsonb_build_object('ok', true, 'reverted', v_changed, 'rule', to_jsonb(v_rule));
END;
$$;

REVOKE ALL ON FUNCTION public.create_meta_match_rule(uuid, uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_meta_match_rule(uuid, uuid, text, text, text, text, text, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.delete_meta_match_rule(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_meta_match_rule(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. El canal: un formulario o una reunion usan el utm_medium que llego (la columna medium dice «form»)
-- ------------------------------------------------------------
-- Gemela: effectiveTouchMedium (lib/attribution/channel.ts).
CREATE OR REPLACE FUNCTION private.touch_effective_medium(p_medium text, p_raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(nullif(lower(btrim(p_medium)), ''), 'form') IN ('form', 'booking', 'webhook', 'import', 'manual')
      THEN coalesce(nullif(lower(btrim(coalesce(p_raw->'utm'->>'utm_medium', p_raw->>'utm_medium'))), ''), p_medium)
    ELSE p_medium
  END
$$;

REVOKE ALL ON FUNCTION private.touch_effective_medium(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contact_touches_zz_channel_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel text := NEW.channel;
  v_status text := NEW.meta_match_status;
  v_reason text := NEW.meta_match_reason;
  v_medium text;
BEGIN
  BEGIN
    v_medium := private.touch_effective_medium(NEW.medium, NEW.raw);
    IF TG_OP = 'INSERT' THEN
      IF v_channel IS NULL THEN
        v_channel := public.touch_channel(NEW.origin, v_medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                          NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
      END IF;
    ELSIF NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
      v_channel := public.touch_channel(NEW.origin, v_medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                        NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
    END IF;

    -- Un link organico con UTMs no es un anuncio sin vincular.
    IF v_channel = 'organic'
       AND (NEW.content_post_id IS NOT NULL OR NEW.social_post_id IS NOT NULL)
       AND nullif(btrim(NEW.ad_id), '') IS NULL AND nullif(btrim(NEW.adset_id), '') IS NULL AND nullif(btrim(NEW.campaign_id), '') IS NULL
       AND nullif(btrim(NEW.fbclid), '') IS NULL
       AND nullif(btrim(NEW.meta_ad_id), '') IS NULL AND nullif(btrim(NEW.meta_adset_id), '') IS NULL AND nullif(btrim(NEW.meta_campaign_id), '') IS NULL
       AND v_status = 'unmatched' THEN
      v_status := 'ignored';
      v_reason := 'organic_content';
    END IF;

    NEW.channel := v_channel;
    NEW.meta_match_status := v_status;
    NEW.meta_match_reason := v_reason;
  EXCEPTION WHEN OTHERS THEN
    NEW.channel := 'direct';
    RAISE WARNING 'contact_touches_zz_channel: no pude calcular el canal del toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_touches_zz_channel_trg() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 7. La tarea de IA «Vincular anuncios» (`ads_matching`): propone, nunca vincula sola
-- ------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
  ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check
    CHECK (source = ANY (ARRAY[
      'agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing', 'conversation_summary', 'message_classification',
      'message_classification_eval', 'content_copy', 'ads_analysis', 'audio_transcription', 'media_description',
      'call_classification', 'call_analysis', 'call_correction', 'call_summary', 'call_prompt_test', 'ads_matching'
    ]::text[]));

  ALTER TABLE public.ai_task_prompt_versions DROP CONSTRAINT IF EXISTS ai_task_prompt_versions_task_check;
  ALTER TABLE public.ai_task_prompt_versions ADD CONSTRAINT ai_task_prompt_versions_task_check
    CHECK (task = ANY (ARRAY[
      'message_classification', 'conversation_summary', 'close_classification', 'media_description', 'ads_analysis',
      'call_classification', 'call_analysis', 'call_summary', 'ads_matching'
    ]::text[]));
END $$;

-- ------------------------------------------------------------
-- 8. Lo que ya existe
-- ------------------------------------------------------------
DO $$
DECLARE
  v_contacts uuid[];
  v_n int;
  v_ws uuid;
  v_total int := 0;
BEGIN
  -- a) Los `unmatched` que dejan de tener datos de Meta (link de la bio, ManyChat, fbclid suelto) vuelven a `none`.
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
  RAISE NOTICE '00318: % toque(s) sin datos de Meta vuelven a none', coalesce(v_n, 0);

  -- b) El vinculo nuevo (nombre exacto y parecido) para todo lo que tiene datos de Meta.
  FOR v_ws IN SELECT DISTINCT workspace_id FROM public.meta_campaigns LOOP
    v_total := v_total + public.rematch_meta_touches(v_ws, '-infinity');
  END LOOP;
  RAISE NOTICE '00318: % toque(s) re-vinculados', v_total;

  -- c) El canal de los formularios y las reuniones que tenian un utm_medium guardado.
  WITH fixed AS (
    UPDATE public.contact_touches ct
       SET channel = public.touch_channel(ct.origin, private.touch_effective_medium(ct.medium, ct.raw), ct.source, ct.ad_id, ct.adset_id,
                                          ct.campaign_id, ct.meta_ad_id, ct.meta_campaign_id, ct.gclid, ct.ttclid, ct.li_fat_id,
                                          ct.ctwa_clid, ct.fbclid, ct.social_post_id, ct.content_post_id)
     WHERE ct.origin IN ('form', 'booking', 'webhook', 'import', 'manual')
       AND coalesce(ct.raw->'utm'->>'utm_medium', ct.raw->>'utm_medium') IS NOT NULL
       AND ct.channel IS DISTINCT FROM public.touch_channel(ct.origin, private.touch_effective_medium(ct.medium, ct.raw), ct.source, ct.ad_id,
                                          ct.adset_id, ct.campaign_id, ct.meta_ad_id, ct.meta_campaign_id, ct.gclid, ct.ttclid, ct.li_fat_id,
                                          ct.ctwa_clid, ct.fbclid, ct.social_post_id, ct.content_post_id)
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM fixed;
  RAISE NOTICE '00318: canal corregido en % toque(s)', coalesce(v_n, 0);
END $$;
