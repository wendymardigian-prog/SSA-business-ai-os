-- ============================================================================
-- Seed — precios de los modelos de IA (model_pricing)
-- ============================================================================
-- DATOS, no estructura: por eso vive fuera de supabase/migrations y no entra en
-- ALL_MIGRATIONS.sql. Correr a mano en el SQL editor de Supabase DESPUES de
-- aplicar la 00059.
--
-- SIN ESTE SEED TODOS LOS RUNS QUEDAN CON cost_usd EN NULL.
--
-- Precios verificados el 2026-09-13 contra las paginas oficiales:
--   - Anthropic: platform.claude.com/docs/en/pricing (lectura de cache = 0,1x la entrada)
--   - OpenAI:    developers.openai.com/api/docs/pricing (tier estandar)
--   - Google:    ai.google.dev/gemini-api/docs/pricing (tier pago, prompts <= 200k)
--   - Voyage:    docs.voyageai.com/docs/pricing (despues de los 200M tokens gratis)
--
-- gemini-2.0-flash esta en el catalogo de la app pero ya no figura en la pagina
-- de precios de Google: no se siembra. Si alguien lo usa, el run se guarda con
-- el costo en null y la pantalla lo avisa.
--
-- >>> REVISAR ESTA TABLA CADA VEZ QUE SE CAMBIE DE MODELO. <<<
-- Los costos reportados dependen de estos numeros. Un precio nuevo se carga
-- como fila nueva con valid_from nuevo (no se pisa la anterior): los runs viejos
-- conservan el costo con el que se congelaron.
--
-- Nota sobre las escrituras de cache de Anthropic (1,25x la entrada): se cobran
-- al precio de entrada normal. El agente no marca breakpoints de cache, asi que
-- en la practica no aparecen; si un dia se usan, el costo reportado queda un
-- poco por debajo del real.
--
-- Single-tenant: siembra los precios en todos los workspaces que existan.
-- Idempotente: re-ejecutarlo no duplica (unico por workspace, proveedor, modelo
-- y vigencia).
-- ============================================================================

INSERT INTO public.model_pricing
  (workspace_id, provider, model, input_per_mtok, output_per_mtok, cached_input_per_mtok, valid_from, note)
SELECT w.id, p.provider, p.model, p.input_per_mtok, p.output_per_mtok, p.cached_input_per_mtok,
       '2026-09-13T00:00:00Z'::timestamptz, 'Seed inicial, verificado 2026-09-13'
FROM public.workspaces w
CROSS JOIN (VALUES
  -- proveedor,  modelo,                       entrada, salida, cache
  ('anthropic', 'claude-opus-5',               5.00,    25.00,  0.50),
  ('anthropic', 'claude-sonnet-5',             2.00,    10.00,  0.20),
  ('anthropic', 'claude-haiku-4-5-20251001',   1.00,     5.00,  0.10),
  ('anthropic', 'claude-haiku-4-5',            1.00,     5.00,  0.10),
  ('openai',    'gpt-5',                       1.25,    10.00,  0.125),
  ('openai',    'gpt-5-mini',                  0.25,     2.00,  0.025),
  ('openai',    'gpt-4.1',                     2.00,     8.00,  0.50),
  ('openai',    'gpt-4o',                      2.50,    10.00,  1.25),
  ('google_ai', 'gemini-2.5-pro',              1.25,    10.00,  0.125),
  ('google_ai', 'gemini-2.5-flash',            0.30,     2.50,  0.03),
  -- Embeddings: sin salida ni cache.
  ('voyage',    'voyage-4-lite',               0.02,     0.00,  0.00),
  ('voyage',    'voyage-4',                    0.06,     0.00,  0.00),
  ('voyage',    'voyage-4-large',              0.12,     0.00,  0.00)
) AS p(provider, model, input_per_mtok, output_per_mtok, cached_input_per_mtok)
ON CONFLICT (workspace_id, provider, model, valid_from) DO NOTHING;

-- Verificacion:
--   SELECT provider, model, input_per_mtok, output_per_mtok, cached_input_per_mtok, valid_from
--   FROM public.model_pricing ORDER BY provider, model;
