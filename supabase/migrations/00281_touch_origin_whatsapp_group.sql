-- ============================================================
-- 00281_touch_origin_whatsapp_group
-- ============================================================
-- Grupos de WhatsApp: el toque de quien llega por un grupo (noviembre 2026).
--
-- Cuando un grupo activado guarda contactos (00280), quien se une queda como
-- contacto con un toque de atribucion:
--   origin = 'whatsapp_group', source = 'whatsapp', medium = 'whatsapp_group',
--   content_label = el nombre del grupo, raw = { group_jid, group_event }.
-- Cuenta como ORGANICO: alguien que entra a tu comunidad llego por tu contenido,
-- no por pauta. WhatsApp no dice por que link de invitacion entro (no hay UTMs).
--
-- Dos cambios, los dos aditivos:
--   1. El CHECK de contact_touches.origin suma 'whatsapp_group'.
--   2. touch_channel suma 'whatsapp_group' a los medium organicos. Gemela de
--      ORGANIC_MEDIUMS (lib/attribution/channel.ts), con su caso en
--      lib/attribution/channel.cases.json.
-- record_contact_touch NO se toca.
--
-- Como volver atras:
--   (antes) DELETE FROM public.contact_touches WHERE origin = 'whatsapp_group';  -- y refrescar contacts.attribution
--   ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
--   ALTER TABLE public.contact_touches ADD CONSTRAINT contact_touches_origin_check
--     CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text, 'link_click'::text])));
--   y la definicion vieja de touch_channel (00230), completa:
--   CREATE OR REPLACE FUNCTION public.touch_channel(
--     p_origin text, p_medium text, p_source text,
--     p_ad_id text, p_adset_id text, p_campaign_id text, p_meta_ad_id text, p_meta_campaign_id text,
--     p_gclid text, p_ttclid text, p_li_fat_id text, p_ctwa_clid text, p_fbclid text,
--     p_social_post_id uuid, p_content_post_id uuid
--   )
--   RETURNS text
--   LANGUAGE plpgsql
--   IMMUTABLE
--   SET search_path = ''
--   AS $$
--   DECLARE
--     v_origin text := nullif(lower(btrim(p_origin)), '');
--     v_medium text := nullif(lower(btrim(p_medium)), '');
--     v_source text := nullif(lower(btrim(p_source)), '');
--   BEGIN
--     -- 1) Pauta
--     IF nullif(btrim(p_ad_id), '') IS NOT NULL
--        OR nullif(btrim(p_adset_id), '') IS NOT NULL
--        OR nullif(btrim(p_campaign_id), '') IS NOT NULL
--        OR nullif(btrim(p_meta_ad_id), '') IS NOT NULL
--        OR nullif(btrim(p_meta_campaign_id), '') IS NOT NULL
--        OR nullif(btrim(p_gclid), '') IS NOT NULL
--        OR nullif(btrim(p_ttclid), '') IS NOT NULL
--        OR nullif(btrim(p_li_fat_id), '') IS NOT NULL
--        OR nullif(btrim(p_ctwa_clid), '') IS NOT NULL
--        OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['paid_social', 'cpc', 'ppc', 'paid', 'display', 'paidsocial', 'paid_search'])) THEN
--       RETURN 'paid';
--     END IF;
--   
--     -- 2) Referido (lo deja el selector de la venta)
--     IF v_medium = 'referral_person' THEN
--       RETURN 'referral';
--     END IF;
--   
--     -- 3) Organico
--     IF p_social_post_id IS NOT NULL
--        OR p_content_post_id IS NOT NULL
--        OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['comment', 'story_reply', 'story_mention', 'organic_social', 'social', 'dm_link']))
--        OR (v_origin = 'dm' AND v_source IS NOT NULL
--            AND v_source = ANY (ARRAY['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'threads', 'twitter'])) THEN
--       RETURN 'organic';
--     END IF;
--   
--     -- 4) Cualquier otro caso
--     RETURN 'direct';
--   END;
--   $$;
--
-- Idempotente. Aditiva: se aplica ANTES de desplegar el codigo que la usa.
-- ============================================================

ALTER TABLE public.contact_touches DROP CONSTRAINT IF EXISTS contact_touches_origin_check;
ALTER TABLE public.contact_touches
  ADD CONSTRAINT contact_touches_origin_check
  CHECK ((origin = ANY (ARRAY['dm'::text, 'comment'::text, 'booking'::text, 'form'::text, 'manual'::text, 'import'::text, 'webhook'::text, 'link_click'::text, 'whatsapp_group'::text])));

-- Gemela de lib/attribution/channel.ts (suma 'whatsapp_group' a los medium organicos; lo demas, igual a la 00230).
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
     OR (v_medium IS NOT NULL AND v_medium = ANY (ARRAY['comment', 'story_reply', 'story_mention', 'organic_social', 'social', 'dm_link', 'whatsapp_group']))
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
