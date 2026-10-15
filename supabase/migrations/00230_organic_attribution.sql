-- ============================================================================
-- 00230 — Atribucion organica (Extra I, bloque AO1, F30)
-- ============================================================================
-- Que contenido trajo a cada contacto, y por que canal. Lo que agrega:
--
--   1. `content_posts.attribution_code`: un codigo corto y unico por pieza ('c' + 5 caracteres de [a-z2-9], sin 0, 1, l, o)
--      que se pone en el UTM (`utm_content`) de los links. Lo completa un trigger al crear; se rellena el historico.
--   2. `social_posts.assigned_to`: responsable de una publicacion SIN pieza (externa o marcada a mano), miembro del workspace.
--   3. `contact_touches.channel` ('organic' | 'paid' | 'referral' | 'direct'), calculado por `public.touch_channel(...)`
--      (IMMUTABLE; su gemela en TypeScript es `lib/attribution/channel.ts`, con los mismos casos en `channel.cases.json`).
--   4. El CHECK de `contact_touches.origin` suma `link_click` (un clic en un link con seguimiento).
--   5. Dos triggers de `contact_touches` (BEFORE INSERT), con `EXCEPTION WHEN OTHERS` (un error aca NUNCA cuesta un toque):
--        - `contact_touches_content_code`: si `content_label` es el codigo de una pieza, completa la pieza (y la
--          publicacion si hay UNA sola en esa red). Corre antes de `contact_touches_meta_match` (orden alfabetico).
--        - `contact_touches_zz_channel`: calcula el canal (respeta uno puesto en el INSERT) y, si es organico con pieza
--          y sin ningun dato de anuncio, marca el vinculo de Meta como `ignored / organic_content` (asi no aparece en
--          «Sin vincular» y `rematch_meta_touches`, que nunca toca `ignored`, no lo vuelve a tocar). Corre despues de
--          `contact_touches_meta_match`.
--   6. `public.contact_last_origin_touch(contact)`: el ultimo toque con canal organico, pago o referido. NO se guarda
--      en `contacts.attribution` (eso exigiria tocar `record_contact_touch`, que esta protegido).
--   7. `workspaces.attribution_settings` (jsonb): comentarios que crean contactos, dias de herencia y valores por
--      defecto de los links.
--   8. `private.enqueue_comment_backfill()`: la FUNCION del trigger que encola el vinculo retroactivo de comentarios
--      cuando un contacto gana un usuario de Instagram o TikTok. El trigger en si es la 00234 (despues del merge).
--   9. Relleno de `channel` del historico, en lotes de 1.000.
--
-- NO se tocan: `record_contact_touch`, `find_or_link_contact`, `contact_touches_meta_match_trg`,
-- `rematch_meta_touches` ni `resolve_meta_match` (sus huellas md5 no cambian).
--
-- Definicion vieja del CHECK de origin (la que esta vigente hasta esta migracion):
--   CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text])))
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contact_touches_zz_channel ON public.contact_touches;
--   DROP TRIGGER IF EXISTS contact_touches_content_code ON public.contact_touches;
--   DROP FUNCTION IF EXISTS public.contact_touches_zz_channel_trg();
--   DROP FUNCTION IF EXISTS public.contact_touches_content_code_trg();
--   DROP FUNCTION IF EXISTS public.contact_last_origin_touch(uuid);
--   DROP FUNCTION IF EXISTS private.enqueue_comment_backfill();
--   DROP FUNCTION IF EXISTS public.touch_channel(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, uuid);
--   ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
--   ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_origin_check
--     CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text])));
--     (antes, borrar o recodificar los toques con origin = 'link_click', si los hubiera)
--   DROP INDEX IF EXISTS public.idx_contact_touches_channel;
--   ALTER TABLE public.contact_touches DROP COLUMN IF EXISTS channel;
--   DROP TRIGGER IF EXISTS social_posts_assignee ON public.social_posts;
--   DROP FUNCTION IF EXISTS public.social_posts_assignee_guard();
--   ALTER TABLE public.social_posts DROP COLUMN IF EXISTS assigned_to;
--   DROP TRIGGER IF EXISTS content_posts_attribution_code ON public.content_posts;
--   DROP FUNCTION IF EXISTS public.content_posts_attribution_code_trg();
--   DROP FUNCTION IF EXISTS private.new_attribution_code(uuid);
--   DROP INDEX IF EXISTS public.uq_content_posts_attribution_code;
--   ALTER TABLE public.content_posts DROP COLUMN IF EXISTS attribution_code;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS attribution_settings;
-- Riesgo: medio-alto. Toca la tabla donde escribe todo lo entrante; los dos triggers nuevos no pueden fallar un insert.
-- ============================================================================

SET search_path = '';

-- 1. Codigo de atribucion de cada pieza ---------------------------------------------------------------------------

ALTER TABLE public.content_posts ADD COLUMN IF NOT EXISTS attribution_code text;

COMMENT ON COLUMN public.content_posts.attribution_code IS
  'Codigo corto y unico por workspace (c + 5 caracteres [a-z2-9]) que va en el utm_content de los links de la pieza.';

-- 32 simbolos: a-z sin l ni o (24) + 2-9 (8). Reintenta ante colision hasta 10 veces.
CREATE OR REPLACE FUNCTION private.new_attribution_code(p_workspace_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_code text;
  v_try int := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_code := 'c';
    FOR i IN 1..5 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.content_posts p WHERE p.workspace_id = p_workspace_id AND p.attribution_code = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_try >= 10 THEN
      RAISE EXCEPTION 'No pude generar un codigo de atribucion libre despues de 10 intentos';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION private.new_attribution_code(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.content_posts_attribution_code_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.attribution_code IS NULL OR btrim(NEW.attribution_code) = '' THEN
    NEW.attribution_code := private.new_attribution_code(NEW.workspace_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.content_posts_attribution_code_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS content_posts_attribution_code ON public.content_posts;
CREATE TRIGGER content_posts_attribution_code
  BEFORE INSERT ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.content_posts_attribution_code_trg();

-- Relleno de las piezas que ya existen (una por una: cada una ve el codigo de la anterior).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, workspace_id FROM public.content_posts WHERE attribution_code IS NULL LOOP
    UPDATE public.content_posts SET attribution_code = private.new_attribution_code(r.workspace_id) WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.content_posts ALTER COLUMN attribution_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_posts_attribution_code
  ON public.content_posts (workspace_id, attribution_code);

-- 2. Responsable de una publicacion sin pieza ---------------------------------------------------------------------

ALTER TABLE public.social_posts ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.social_posts.assigned_to IS
  'Responsable de una publicacion SIN pieza (externa o marcada a mano). Las de una pieza usan content_posts.assigned_to.';

CREATE OR REPLACE FUNCTION public.social_posts_assignee_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.assigned_to
    ) THEN
      RAISE EXCEPTION 'El responsable tiene que ser parte del equipo.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.social_posts_assignee_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS social_posts_assignee ON public.social_posts;
CREATE TRIGGER social_posts_assignee
  BEFORE INSERT OR UPDATE OF assigned_to ON public.social_posts
  FOR EACH ROW EXECUTE FUNCTION public.social_posts_assignee_guard();

-- 3. El canal de un toque -----------------------------------------------------------------------------------------

ALTER TABLE public.contact_touches ADD COLUMN IF NOT EXISTS channel text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_touches_channel_check' AND conrelid = 'public.contact_touches'::regclass) THEN
    ALTER TABLE public.contact_touches
      ADD CONSTRAINT contact_touches_channel_check CHECK (channel IS NULL OR channel IN ('organic', 'paid', 'referral', 'direct'));
  END IF;
END $$;

COMMENT ON COLUMN public.contact_touches.channel IS
  'organic | paid | referral | direct. Lo calcula contact_touches_zz_channel con touch_channel(); un valor puesto en el INSERT se respeta.';

CREATE INDEX IF NOT EXISTS idx_contact_touches_channel
  ON public.contact_touches (workspace_id, contact_id, channel, occurred_at DESC);

-- Gemela de lib/attribution/channel.ts. IMMUTABLE. `fbclid` SOLO no alcanza para pauta (Meta lo agrega tambien a
-- clics organicos): el parametro existe para que las dos firmas sean identicas, y no se usa.
CREATE OR REPLACE FUNCTION public.touch_channel(
  p_origin text, p_medium text, p_source text,
  p_ad_id text, p_adset_id text, p_campaign_id text, p_meta_ad_id text, p_meta_campaign_id text,
  p_gclid text, p_ttclid text, p_li_fat_id text, p_ctwa_clid text, p_fbclid text,
  p_social_post_id uuid, p_content_post_id uuid
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_origin text := nullif(lower(btrim(p_origin)), '');
  v_medium text := nullif(lower(btrim(p_medium)), '');
  v_source text := nullif(lower(btrim(p_source)), '');
BEGIN
  -- 1) Pauta
  IF nullif(btrim(p_ad_id), '') IS NOT NULL
     OR nullif(btrim(p_adset_id), '') IS NOT NULL
     OR nullif(btrim(p_campaign_id), '') IS NOT NULL
     OR nullif(btrim(p_meta_ad_id), '') IS NOT NULL
     OR nullif(btrim(p_meta_campaign_id), '') IS NOT NULL
     OR nullif(btrim(p_gclid), '') IS NOT NULL
     OR nullif(btrim(p_ttclid), '') IS NOT NULL
     OR nullif(btrim(p_li_fat_id), '') IS NOT NULL
     OR nullif(btrim(p_ctwa_clid), '') IS NOT NULL
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['paid_social', 'cpc', 'ppc', 'paid', 'display', 'paidsocial', 'paid_search'])) THEN
    RETURN 'paid';
  END IF;

  -- 2) Referido (lo deja el selector de la venta)
  IF v_medium = 'referral_person' THEN
    RETURN 'referral';
  END IF;

  -- 3) Organico
  IF p_social_post_id IS NOT NULL
     OR p_content_post_id IS NOT NULL
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['comment', 'story_reply', 'story_mention', 'organic_social', 'social', 'dm_link']))
     OR (v_origin = 'dm' AND v_source IS NOT NULL
         AND v_source = ANY (ARRAY['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'threads', 'twitter'])) THEN
    RETURN 'organic';
  END IF;

  -- 4) Cualquier otro caso
  RETURN 'direct';
END;
$$;

REVOKE ALL ON FUNCTION public.touch_channel(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_channel(text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, uuid) TO authenticated, service_role;

-- 4. Origen `link_click` ------------------------------------------------------------------------------------------

ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
ALTER TABLE public.contact_touches
  ADD CONSTRAINT contact_touches_origin_check
  CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text, 'link_click'::text])));

-- 5. Triggers de contact_touches ----------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_touches_content_code_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label text;
  v_piece uuid;
  v_source text;
  v_count int;
  v_post uuid;
BEGIN
  IF NEW.content_post_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_label := lower(btrim(private.meta_url_decode(NEW.content_label)));
    IF v_label IS NULL OR v_label !~ '^c[a-z2-9]{5}$' THEN
      RETURN NEW;
    END IF;
    SELECT p.id INTO v_piece FROM public.content_posts p WHERE p.workspace_id = NEW.workspace_id AND p.attribution_code = v_label;
    IF v_piece IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW.social_post_id IS NULL THEN
      v_source := lower(btrim(coalesce(NEW.source, '')));
      SELECT count(*), (array_agg(s.id))[1] INTO v_count, v_post
        FROM public.social_posts s
       WHERE s.workspace_id = NEW.workspace_id AND s.content_post_id = v_piece AND s.platform = v_source AND s.deleted_at IS NULL;
      IF v_count = 1 THEN
        NEW.social_post_id := v_post;
      END IF;
    END IF;
    NEW.content_post_id := v_piece;
    NEW.raw := coalesce(NEW.raw, '{}'::jsonb) || jsonb_build_object('content_code_matched', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contact_touches_content_code: no pude completar la pieza del toque (%): %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_touches_content_code_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contact_touches_content_code ON public.contact_touches;
CREATE TRIGGER contact_touches_content_code
  BEFORE INSERT ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.contact_touches_content_code_trg();

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
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF v_channel IS NULL THEN
        v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
                                          NEW.gclid, NEW.ttclid, NEW.li_fat_id, NEW.ctwa_clid, NEW.fbclid, NEW.social_post_id, NEW.content_post_id);
      END IF;
    ELSIF NEW.channel IS NOT DISTINCT FROM OLD.channel THEN
      -- Se actualizo algo que cambia el canal y nadie lo puso a mano: se recalcula.
      v_channel := public.touch_channel(NEW.origin, NEW.medium, NEW.source, NEW.ad_id, NEW.adset_id, NEW.campaign_id, NEW.meta_ad_id, NEW.meta_campaign_id,
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

DROP TRIGGER IF EXISTS contact_touches_zz_channel ON public.contact_touches;
CREATE TRIGGER contact_touches_zz_channel
  BEFORE INSERT OR UPDATE OF ad_id, adset_id, campaign_id, meta_ad_id, meta_adset_id, meta_campaign_id, social_post_id, content_post_id, medium
  ON public.contact_touches
  FOR EACH ROW EXECUTE FUNCTION public.contact_touches_zz_channel_trg();

-- 6. El ultimo toque con origen identificado ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_last_origin_touch(p_contact_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT t.id
    FROM public.contact_touches t
   WHERE t.contact_id = p_contact_id
     AND t.channel IN ('organic', 'paid', 'referral')
   ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.contact_last_origin_touch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_last_origin_touch(uuid) TO authenticated, service_role;

-- 7. Configuracion de la atribucion -------------------------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS attribution_settings jsonb NOT NULL
  DEFAULT '{"comments_create_contact":{"instagram":false,"tiktok":true},"content_inherit_days":7,"links_append_default":false,"links_track_clicks_default":true}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_attribution_settings_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces
      ADD CONSTRAINT workspaces_attribution_settings_check CHECK (jsonb_typeof(attribution_settings) = 'object');
  END IF;
END $$;

-- 8. La funcion del vinculo retroactivo de comentarios (el trigger es la 00234) -----------------------------------

CREATE OR REPLACE FUNCTION private.enqueue_comment_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_platform text;
  v_username text;
  v_old text;
BEGIN
  BEGIN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    FOREACH v_platform IN ARRAY ARRAY['instagram', 'tiktok'] LOOP
      v_username := nullif(btrim(CASE v_platform WHEN 'instagram' THEN NEW.instagram_username ELSE NEW.tiktok_username END), '');
      v_old := CASE WHEN TG_OP = 'UPDATE' THEN nullif(btrim(CASE v_platform WHEN 'instagram' THEN OLD.instagram_username ELSE OLD.tiktok_username END), '') END;
      IF v_username IS NULL OR v_username IS NOT DISTINCT FROM v_old THEN
        CONTINUE;
      END IF;
      INSERT INTO public.scheduled_jobs (type, payload, run_at, dedupe_key)
      VALUES (
        'comment_backfill',
        jsonb_build_object('workspace_id', NEW.workspace_id, 'contact_id', NEW.id, 'platform', v_platform),
        now() + interval '5 seconds',
        'comment_backfill:' || NEW.id::text || ':' || v_platform || ':' || lower(v_username)
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'pending' DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Encolar el vinculo de comentarios nunca puede costar un contacto.
    RAISE WARNING 'enqueue_comment_backfill: no pude encolar el contacto %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_comment_backfill() FROM PUBLIC, anon, authenticated;

-- 9. Relleno del canal del historico (lotes de 1.000). `channel` no esta en la lista de columnas del trigger, asi que
--    esta actualizacion no lo dispara. -----------------------------------------------------------------------------

DO $$
DECLARE
  n int;
  total int := 0;
  r record;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id FROM public.contact_touches WHERE channel IS NULL LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    UPDATE public.contact_touches t
       SET channel = public.touch_channel(t.origin, t.medium, t.source, t.ad_id, t.adset_id, t.campaign_id, t.meta_ad_id, t.meta_campaign_id,
                                          t.gclid, t.ttclid, t.li_fat_id, t.ctwa_clid, t.fbclid, t.social_post_id, t.content_post_id)
      FROM batch
     WHERE t.id = batch.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0;
    total := total + n;
  END LOOP;
  FOR r IN SELECT channel, count(*) AS c FROM public.contact_touches GROUP BY channel ORDER BY channel LOOP
    RAISE NOTICE 'contact_touches.channel = %: % toques', r.channel, r.c;
  END LOOP;
  RAISE NOTICE 'canal calculado para % toques', total;
END $$;
