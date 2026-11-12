-- ============================================================
-- 00366_calls_service_proposals.sql
-- ============================================================
-- Servicios A4 (plano: A4-M2), F135 y F142/F143:
--
--   * `calls.service_id` (uuid SIN clave foranea, como `form_submissions.service_id`: lo valida el modulo; una
--     grabacion nunca falla por el modulo, regla del 8/11), `calls.service_link` (auto | booking | manual | review;
--     NULL = sin intento) y `calls.proposals` (las propuestas del analizador, `[]` por defecto).
--   * `call_analysis_profiles.proposals`: «Proponer acciones» y «Proponer siempre un mensaje para el cliente».
--     Nace APAGADO: ningun analizador empieza a proponer hasta que alguien lo prenda.
--   * `public.call_proposal_claim(call_id, proposal_id)`: pasa UNA propuesta de `pending` (o `failed`, para
--     reintentar) a `executing` con la fila de la reunion bloqueada. Si dos personas aprueban a la vez, gana una.
--     Solo el servidor (`service_role`).
--   * `public.call_proposal_patch(call_id, proposal_id, patch)`: cambia UNA propuesta (mezcla el patch en ese elemento)
--     de forma atomica, asi dos personas que resuelven propuestas distintas de la misma reunion no se pisan.
--
-- Los datos que ya existen: `service_id` y `service_link` quedan en NULL y `proposals` en `[]`. Las reuniones viejas
-- no se vinculan solas (boton «Vincular las reuniones de este servicio» y `scripts/backfill-call-services.mjs`).
--
-- Aditiva. Como volver atras (nadie lee estas columnas sin el codigo nuevo):
--   DROP FUNCTION IF EXISTS public.call_proposal_claim(uuid, text);
--   DROP FUNCTION IF EXISTS public.call_proposal_patch(uuid, text, jsonb);
--   DROP INDEX IF EXISTS public.idx_calls_service, public.idx_calls_service_review;
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS service_id, DROP COLUMN IF EXISTS service_link, DROP COLUMN IF EXISTS proposals;
--   ALTER TABLE public.call_analysis_profiles DROP COLUMN IF EXISTS proposals;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS service_id uuid;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS service_link text;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS proposals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.call_analysis_profiles
  ADD COLUMN IF NOT EXISTS proposals jsonb NOT NULL DEFAULT '{"enabled": false, "client_message": false}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_service_link_check') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_service_link_check
      CHECK (service_link IS NULL OR service_link IN ('auto', 'booking', 'manual', 'review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_proposals_array_check') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_proposals_array_check CHECK (jsonb_typeof(proposals) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_analysis_profiles_proposals_check') THEN
    ALTER TABLE public.call_analysis_profiles ADD CONSTRAINT call_analysis_profiles_proposals_check
      CHECK (jsonb_typeof(proposals) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.calls.service_id IS
  'El servicio de la reunion (Servicios A4, F135). Sin clave foranea a proposito: lo valida el modulo (regla del 8/11).';
COMMENT ON COLUMN public.calls.service_link IS
  'Como quedo vinculada: auto (un solo servicio posible), booking (la agenda traia el paso), manual (una persona), review (por revisar). NULL = sin intento.';
COMMENT ON COLUMN public.calls.proposals IS
  'Propuestas del analizador (F142): [{id, type, status, original, edited, result, reason, resolved_by, resolved_at}]. Se ejecutan solo al aprobarlas.';
COMMENT ON COLUMN public.call_analysis_profiles.proposals IS
  '{enabled, client_message}: si el analizador propone acciones y si propone siempre un mensaje para el cliente (F142, F144). Nace apagado.';

CREATE INDEX IF NOT EXISTS idx_calls_service ON public.calls (workspace_id, service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_service_review ON public.calls (workspace_id) WHERE service_link = 'review';

-- Reclama UNA propuesta para ejecutarla: pending|failed -> executing. true si la tomo esta llamada.
CREATE OR REPLACE FUNCTION public.call_proposal_claim(p_call_id uuid, p_proposal_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_props jsonb;
  v_idx int;
  v_status text;
BEGIN
  SELECT c.proposals INTO v_props FROM public.calls c WHERE c.id = p_call_id FOR UPDATE;
  IF v_props IS NULL OR jsonb_typeof(v_props) <> 'array' THEN RETURN false; END IF;
  SELECT (o.ord - 1)::int, o.elem ->> 'status' INTO v_idx, v_status
  FROM jsonb_array_elements(v_props) WITH ORDINALITY AS o(elem, ord)
  WHERE o.elem ->> 'id' = p_proposal_id
  LIMIT 1;
  IF v_idx IS NULL OR v_status NOT IN ('pending', 'failed') THEN RETURN false; END IF;
  UPDATE public.calls
     SET proposals = jsonb_set(proposals, ARRAY[v_idx::text, 'status'], '"executing"'::jsonb)
   WHERE id = p_call_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.call_proposal_claim(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_proposal_claim(uuid, text) TO service_role;

-- Cambia UNA propuesta (mezcla el patch en ese elemento) de forma atomica. Devuelve la propuesta resultante.
CREATE OR REPLACE FUNCTION public.call_proposal_patch(p_call_id uuid, p_proposal_id text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_props jsonb;
  v_idx int;
  v_new jsonb;
BEGIN
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  SELECT c.proposals INTO v_props FROM public.calls c WHERE c.id = p_call_id FOR UPDATE;
  IF v_props IS NULL OR jsonb_typeof(v_props) <> 'array' THEN RETURN NULL; END IF;
  SELECT (o.ord - 1)::int, o.elem || (p_patch - 'id' - 'type' - 'original') INTO v_idx, v_new
  FROM jsonb_array_elements(v_props) WITH ORDINALITY AS o(elem, ord)
  WHERE o.elem ->> 'id' = p_proposal_id
  LIMIT 1;
  IF v_idx IS NULL THEN RETURN NULL; END IF;
  UPDATE public.calls SET proposals = jsonb_set(proposals, ARRAY[v_idx::text], v_new) WHERE id = p_call_id;
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.call_proposal_patch(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_proposal_patch(uuid, text, jsonb) TO service_role;
