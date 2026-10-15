-- ============================================================================
-- 00220 — Leads y compras de Meta: un nombre por evento  (Tirón 2, E1, decisión 1)
-- ============================================================================
-- Meta informa el MISMO lead con varios nombres a la vez (`lead`, `onsite_conversion.lead_grouped`, las variantes
-- `offsite_*_add_meta_leads`…). El sync sumaba todo lo que contuviera «lead» y cada lead contaba hasta cinco veces: la base guarda
-- 2.337 leads por nivel cuando Meta informa 468 (la suma de la acción `lead`). Por eso el «Leads Meta» y el «CPL Meta» de todas las
-- pantallas estaban inflados.
--
-- Esta migración recalcula `leads` y `purchases` de TODAS las filas de `meta_ads_insights_daily` desde el jsonb `actions` que ya
-- está guardado (sin llamar a Meta), con la regla nueva: el PRIMER nombre de la lista de preferencia que venga. Es la gemela en SQL de
-- `lib/meta/action-counts.ts` (los mismos casos: `lib/meta/action-counts.cases.json`; `verify-ads-attribution.mjs` los corre contra la
-- función de acá).
--   leads:    lead › onsite_conversion.lead_grouped › offsite_conversion.fb_pixel_lead › onsite_web_lead › complete_registration ›
--             offsite_conversion.fb_pixel_complete_registration
--   compras:  omni_purchase › purchase › offsite_conversion.fb_pixel_purchase
-- Una fila sin ninguno de esos nombres queda en NULL (Meta no lo informa), no en 0. `purchase_value` no se toca: sale de
-- `action_values`, que no se guarda crudo.
--
-- Orden: se aplica DESPUÉS de desplegar el código nuevo. Si no, el próximo sync con el código viejo vuelve a escribir los últimos días
-- inflados. Respaldo previo (id, leads y purchases de cada fila): docs/atribucion/respaldo-leads-meta.json.
--
-- Como volver atras (con el respaldo):
--   UPDATE public.meta_ads_insights_daily t SET leads = r.leads, purchases = r.purchases
--     FROM jsonb_to_recordset('<el arreglo "rows" del respaldo>'::jsonb) AS r(id uuid, leads int, purchases int)
--    WHERE t.id = r.id;
--   DROP FUNCTION IF EXISTS public.meta_action_canonical(jsonb, text[]);
-- Riesgo: bajo (cambia un número derivado de datos crudos que se conservan; con respaldo).
-- ============================================================================

SET search_path = '';

-- El primer nombre de la lista que venga en `actions` (un mapa {tipo: cantidad}); NULL si ninguno.
CREATE OR REPLACE FUNCTION public.meta_action_canonical(p_actions jsonb, p_preference text[])
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT (p_actions ->> pref)::numeric::integer
    FROM unnest(p_preference) WITH ORDINALITY AS u(pref, ord)
   WHERE jsonb_typeof(p_actions) = 'object'
     AND p_actions ? pref
     AND jsonb_typeof(p_actions -> pref) = 'number'
   ORDER BY ord
   LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION public.meta_action_canonical(jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meta_action_canonical(jsonb, text[]) TO authenticated, service_role;

UPDATE public.meta_ads_insights_daily t
   SET leads = public.meta_action_canonical(t.actions, ARRAY[
         'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead',
         'complete_registration', 'offsite_conversion.fb_pixel_complete_registration']),
       purchases = public.meta_action_canonical(t.actions, ARRAY['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'])
 WHERE jsonb_typeof(t.actions) = 'object'
   AND (
     t.leads IS DISTINCT FROM public.meta_action_canonical(t.actions, ARRAY[
         'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead',
         'complete_registration', 'offsite_conversion.fb_pixel_complete_registration'])
     OR t.purchases IS DISTINCT FROM public.meta_action_canonical(t.actions, ARRAY['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'])
   );
