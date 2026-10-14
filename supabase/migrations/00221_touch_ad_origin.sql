-- ============================================================================
-- 00221 — Recuperar el anuncio de origen de un toque de Instagram desde la conversación de Zernio  (Tirón 2, A1)
-- ============================================================================
-- Meta manda los datos del anuncio (`referral`) SOLO en el primer mensaje después del clic. Si ese mensaje llegó sin
-- ellos (o no se entendió), el toque quedó como «mensaje directo» orgánico. Zernio sí guarda el anuncio en la
-- conversación (`metadata.meta_ad_id`, una vez, sin pisarlo), así que un job lo pide y esta función completa el toque:
--
--   public.enrich_touch_ad_origin(workspace, dedupe_key, ad_id, título, publicación)
--
-- Qué hace: busca el toque `msg:<id>` del mensaje; si NO tiene ya un anuncio y una persona no lo decidió a mano
-- (`manual` / `ignored`), le pone el `ad_id` (y el título del anuncio como `content_label`, el medio `paid_social` y el
-- `referral` en `raw`, que es lo que habría guardado `recordInboundTouch` con el referral), lo vincula con el catálogo
-- (`resolve_meta_match_for_touch`, la misma regla de siempre) y recalcula la atribución del contacto
-- (`private.refresh_contact_attribution`).
--
-- Reglas:
--   - Nunca pisa un anuncio que el toque ya tenía, ni un vínculo `manual` o `ignored`.
--   - Nunca lanza: ante cualquier error devuelve `{ok:false, error:'exception'}` y deja el toque como estaba.
--   - Sin catálogo todavía, el toque queda `unmatched` con su `ad_id`; el re-vínculo (`rematch_meta_touches`) lo resuelve
--     después del próximo sync.
--   - `record_contact_touch`, `find_or_link_contact` y `create_booking` NO se tocan.
--
-- Solo `service_role` la ejecuta (SECURITY DEFINER, `search_path` vacío).
--
-- Como volver atras: DROP FUNCTION IF EXISTS public.enrich_touch_ad_origin(uuid, text, text, text, text);
--   (los toques ya enriquecidos conservan su `ad_id`; para deshacer uno, `set_touch_meta_match(... 'unlink')` o vaciar `ad_id`
--   y llamar a `rematch_meta_touches`)
-- Riesgo: bajo (aditiva: una función nueva; ninguna tabla cambia).
-- ============================================================================

SET search_path = '';

CREATE OR REPLACE FUNCTION public.enrich_touch_ad_origin(
  p_workspace_id uuid,
  p_dedupe_key text,
  p_ad_id text,
  p_title text DEFAULT NULL,
  p_post_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  t       public.contact_touches%ROWTYPE;
  v_ad    text := left(nullif(btrim(p_ad_id), ''), 500);
  v_title text := left(nullif(btrim(p_title), ''), 500);
  v_post  text := left(nullif(btrim(p_post_id), ''), 500);
  r       jsonb;
BEGIN
  IF p_workspace_id IS NULL OR nullif(btrim(p_dedupe_key), '') IS NULL OR v_ad IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_to_enrich');
  END IF;

  BEGIN
    SELECT * INTO t FROM public.contact_touches
     WHERE workspace_id = p_workspace_id AND dedupe_key = p_dedupe_key
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'touch_not_found');
    END IF;

    -- Lo que una persona decidió, o un anuncio que el toque ya traía, no se toca.
    IF t.meta_match_status IN ('manual', 'ignored') THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'reason', 'decided_by_person');
    END IF;
    IF nullif(btrim(t.ad_id), '') IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'changed', false, 'reason', 'already_has_ad');
    END IF;

    UPDATE public.contact_touches
       SET ad_id = v_ad,
           content_label = coalesce(nullif(btrim(content_label), ''), v_title),
           medium = 'paid_social',
           raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
             'referral', jsonb_strip_nulls(jsonb_build_object(
               'ad_id', v_ad,
               'headline', v_title,
               'post_id', v_post,
               'platform', source,
               'recovered_from', 'zernio_conversation'
             ))
           )
     WHERE id = t.id
     RETURNING * INTO t;

    -- El vínculo con el catálogo, con la regla de siempre (con el anuncio ya puesto, sus datos cuentan).
    r := public.resolve_meta_match_for_touch(t);
    UPDATE public.contact_touches
       SET meta_campaign_id = r->>'campaign_id',
           meta_adset_id = r->>'adset_id',
           meta_ad_id = r->>'ad_id',
           meta_match_status = coalesce(r->>'status', 'none'),
           meta_match_method = r->>'method',
           meta_match_reason = r->>'reason',
           meta_matched_at = CASE WHEN r->>'status' = 'matched' THEN now() END
     WHERE id = t.id;

    PERFORM private.refresh_contact_attribution(t.contact_id);

    RETURN jsonb_build_object(
      'ok', true, 'changed', true, 'contact_id', t.contact_id,
      'status', coalesce(r->>'status', 'none'), 'ad_id', r->>'ad_id'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enrich_touch_ad_origin: no pude completar el toque (%): %', p_dedupe_key, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'error', 'exception');
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.enrich_touch_ad_origin(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enrich_touch_ad_origin(uuid, text, text, text, text) TO service_role;
