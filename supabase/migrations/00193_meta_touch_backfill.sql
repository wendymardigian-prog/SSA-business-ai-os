-- ============================================================================
-- 00193 — Backfill del vinculo de toques con Meta  (M8 del Extra L, AT3)
-- ============================================================================
-- La 00192 vincula cada toque NUEVO. Esta migracion vuelve a resolver los toques que ya existian:
-- corre `rematch_meta_touches` en cada workspace con `p_since = '-infinity'` (todo el historial).
--
-- - Solo toca toques con algun dato de Meta (ids, UTMs o fbclid) que estan `none`/`unmatched`; nunca los
--   `manual` ni los `ignored`. Al final de cada lote refresca `contacts.attribution` de los contactos
--   afectados.
-- - Idempotente: correrla otra vez no cambia nada (un toque que ya esta resuelto no se vuelve a escribir).
-- - Al medirla (12/10/2026) ningun toque tenia datos de anuncio; la migracion deja un NOTICE con
--   cuantos toques cambio por workspace, para que se vea si hizo algo.
--
-- Como volver atras: no hay nada que deshacer en los datos que no se pueda recalcular. Para dejar los toques
-- sin vincular: UPDATE public.contact_touches SET meta_match_status = 'none', meta_campaign_id = NULL,
-- meta_adset_id = NULL, meta_ad_id = NULL, meta_match_method = NULL, meta_match_reason = NULL,
-- meta_matched_at = NULL WHERE meta_match_status IN ('matched', 'unmatched');   (los manuales no se tocan)
-- Riesgo: medio (escribe en toques existentes), acotado a los que traen datos de anuncio.
-- ============================================================================

DO $$
DECLARE
  ws record;
  n int;
  total int := 0;
BEGIN
  FOR ws IN SELECT id FROM public.workspaces LOOP
    n := public.rematch_meta_touches(ws.id, '-infinity'::timestamptz);
    IF n > 0 THEN
      RAISE NOTICE '00193: workspace % -> % toque(s) vinculado(s) o actualizado(s)', ws.id, n;
    END IF;
    total := total + n;
  END LOOP;
  RAISE NOTICE '00193: backfill del vinculo con Meta: % toque(s) en total', total;
END $$;
