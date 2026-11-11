-- ============================================================================
-- 00359 — booking_last_touches: los ultimos toques de cada reunion (Agenda: «Ultimo click»)
-- ============================================================================
-- Aditiva (una funcion de lectura, sin tablas). Puede ir antes o despues del deploy: sin ella, la columna
-- «Ultimo click» de la lista de Agenda y el bloque del panel quedan vacios («—»), nada se rompe
-- (`loadBookingLastTouches` captura el error).
--
-- Para cada reunion de la lista: los ultimos `p_limit` (3 por defecto, hasta 10) toques del contacto
-- ANTERIORES O IGUALES a cuando se creo la reunion, de cualquier canal (organico, pauta, referido,
-- directo). Mismo orden y mismo corte que «A que anuncio cuenta una venta» (`ads_crm_items`, 00302):
-- `occurred_at <= bookings.created_at`, `occurred_at desc, created_at desc, id desc`. A diferencia de
-- aquella, NO se limita a toques con anuncio de Meta.
-- El toque de la propia reunion (`origin = 'booking'`) cuenta cuando trae algo (una fuente, una campana,
-- un id de anuncio o de clic): es el rastro de la visita que termino en la reunion. Si no trae nada
-- (fuente 'web' y todo lo demas vacio) es ruido y se saltea.
-- Solo `service_role`: la app la llama con el cliente de servicio, con ids de reuniones que la persona ya
-- leyo con su sesion (quien atiende una reunion puede no ver el contacto). Nunca devuelve datos del contacto.
CREATE OR REPLACE FUNCTION public.booking_last_touches(
  p_workspace_id uuid,
  p_booking_ids uuid[],
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  booking_id uuid,
  touch_rank integer,
  touch_id uuid,
  occurred_at timestamptz,
  source text,
  medium text,
  campaign text,
  content_label text,
  term text,
  origin text,
  channel text,
  social_post_id uuid,
  content_post_id uuid,
  ad_id text,
  adset_id text,
  campaign_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_match_status text,
  entry_url text
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    b.id,
    (row_number() OVER (PARTITION BY b.id ORDER BY t.occurred_at DESC, t.created_at DESC, t.id DESC))::integer,
    t.id, t.occurred_at, t.source, t.medium, t.campaign, t.content_label, t.term, t.origin, t.channel,
    t.social_post_id, t.content_post_id, t.ad_id, t.adset_id, t.campaign_id,
    t.meta_campaign_id, t.meta_adset_id, t.meta_ad_id, t.meta_match_status, t.entry_url
  FROM public.bookings b
  CROSS JOIN LATERAL (
    SELECT ct.*
    FROM public.contact_touches ct
    WHERE ct.workspace_id = b.workspace_id
      AND ct.contact_id = b.contact_id
      AND ct.occurred_at <= b.created_at
      AND NOT (
        ct.origin = 'booking' AND ct.source = 'web'
        AND ct.campaign IS NULL AND ct.content_label IS NULL AND ct.term IS NULL
        AND ct.ad_id IS NULL AND ct.adset_id IS NULL AND ct.campaign_id IS NULL
        AND ct.fbclid IS NULL AND ct.gclid IS NULL AND ct.ttclid IS NULL AND ct.li_fat_id IS NULL
      )
    ORDER BY ct.occurred_at DESC, ct.created_at DESC, ct.id DESC
    LIMIT greatest(1, least(coalesce(p_limit, 3), 10))
  ) t
  WHERE b.workspace_id = p_workspace_id
    AND b.id = ANY (p_booking_ids)
  ORDER BY b.id, 2;
$$;

REVOKE ALL ON FUNCTION public.booking_last_touches(uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_last_touches(uuid, uuid[], integer) TO service_role;
