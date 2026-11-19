-- ============================================================
-- 00450_call_proposals_replace_pending.sql
-- ============================================================
-- Analizador de grabaciones (traído de RER, 18/11/2026): las propuestas de una reunión tienen dos orígenes en la
-- MISMA lista `calls.proposals` (00366):
--   * el analizador (tarea, mensaje, paso, aviso), como hasta ahora;
--   * el resumen de la grabación (idea y borrador de contenido): las ideas ya no entran solas al banco de Contenido,
--     se proponen en la reunión y entran solo si alguien las aprueba.
-- Cada origen, al volver a correr, reemplaza SOLO sus pendientes. El análisis y el resumen pueden terminar casi a la
-- vez: leer-juntar-escribir desde la app haría que uno pise al otro. Esta función lo hace con la reunión bloqueada.
--
-- Solo agrega una función (no cambia tablas, datos ni políticas). Gemela de `mergeOnRegenerate`
-- (lib/calls/proposals.ts). La app funciona igual sin ella (cae al leer-juntar-escribir de antes), así que se puede
-- aplicar antes o después de desplegar.
--
-- Volver atrás:
--   DROP FUNCTION IF EXISTS public.call_proposals_replace_pending(uuid, text[], jsonb);

CREATE OR REPLACE FUNCTION public.call_proposals_replace_pending(p_call_id uuid, p_types text[], p_fresh jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_props jsonb;
  v_kept jsonb;
BEGIN
  IF p_fresh IS NULL OR jsonb_typeof(p_fresh) <> 'array' THEN
    RAISE EXCEPTION 'p_fresh tiene que ser una lista' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_types IS NULL OR cardinality(p_types) = 0 THEN
    RAISE EXCEPTION 'p_types no puede venir vacío' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT c.proposals INTO v_props FROM public.calls c WHERE c.id = p_call_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_props IS NULL OR jsonb_typeof(v_props) <> 'array' THEN v_props := '[]'::jsonb; END IF;

  -- Quedan las resueltas, la que está en curso y las pendientes de los otros tipos (el otro origen).
  SELECT COALESCE(jsonb_agg(o.elem ORDER BY o.ord), '[]'::jsonb) INTO v_kept
    FROM jsonb_array_elements(v_props) WITH ORDINALITY AS o(elem, ord)
   WHERE NOT (o.elem ->> 'status' = 'pending' AND (o.elem ->> 'type') = ANY (p_types));

  UPDATE public.calls SET proposals = v_kept || p_fresh WHERE id = p_call_id;
  RETURN jsonb_array_length(v_kept || p_fresh);
END;
$$;

COMMENT ON FUNCTION public.call_proposals_replace_pending(uuid, text[], jsonb) IS
  '00450: reemplaza las propuestas pendientes de esos tipos por las nuevas, con la reunión bloqueada. Solo servidor (jobs call_analyze y call_summary).';

REVOKE ALL ON FUNCTION public.call_proposals_replace_pending(uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_proposals_replace_pending(uuid, text[], jsonb) TO service_role;
