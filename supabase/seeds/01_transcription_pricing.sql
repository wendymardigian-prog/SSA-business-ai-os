-- ============================================================================
-- Seed — precios de transcripcion (model_pricing.audio_per_hour)
-- ============================================================================
-- DATOS, no estructura: igual que 00_model_pricing.sql, vive fuera de
-- supabase/migrations y no entra en ALL_MIGRATIONS.sql. Correr a mano en el SQL
-- editor DESPUES de aplicar la 00103.
--
-- SIN ESTE SEED, LOS RUNS DE TRANSCRIPCION QUEDAN CON cost_usd EN NULL.
-- (La transcripcion funciona igual: lo unico que falta es el costo reportado.)
--
-- Los proveedores de transcripcion cobran por HORA DE AUDIO, no por tokens. Por
-- eso estas filas usan `audio_per_hour` y dejan las columnas por token en 0.
--
-- Precios verificados el 2026-09-28:
--   - Groq:   console.groq.com/docs/model/whisper-large-v3-turbo  -> US$ 0,04/h
--   - OpenAI: developers.openai.com/api/docs/pricing (whisper-1)  -> US$ 0,36/h
--
-- >>> REVISAR CUANDO SE CAMBIE DE PROVEEDOR O DE MODELO. <<<
-- Un precio nuevo es una fila NUEVA con valid_from nuevo: no se pisa la
-- anterior, asi los runs viejos conservan el costo con el que se congelaron.
--
-- Single-tenant: siembra en todos los workspaces que existan.
-- ============================================================================

INSERT INTO public.model_pricing
  (workspace_id, provider, model, input_per_mtok, output_per_mtok, cached_input_per_mtok, audio_per_hour, valid_from)
SELECT w.id, v.provider, v.model, 0, 0, 0, v.audio_per_hour, '2026-09-28T00:00:00Z'::timestamptz
FROM public.workspaces w
CROSS JOIN (VALUES
  ('groq',   'whisper-large-v3-turbo', 0.040000),
  ('groq',   'whisper-large-v3',       0.111000),
  ('openai', 'whisper-1',              0.360000)
) AS v(provider, model, audio_per_hour)
WHERE NOT EXISTS (
  SELECT 1 FROM public.model_pricing p
  WHERE p.workspace_id = w.id
    AND p.provider = v.provider
    AND p.model = v.model
    AND p.valid_from = '2026-09-28T00:00:00Z'::timestamptz
);
