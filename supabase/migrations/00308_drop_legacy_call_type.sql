-- 00308_drop_legacy_call_type (6/11/2026)
--
-- Etapa 5 de Grabaciones, segunda parte: BORRA lo que quedo sin usarse.
--
--   calls: call_type, call_type_source, call_type_rule, call_type_confidence, call_type_alternative
--          y call_type_proposed. La clave vieja de tipo ahora se deriva del area y el tipo
--          (`lib/calls/legacy-type.ts`), y "quien decidio" vive en classification_* (00307).
--   workspace_members: is_closer. Nadie la lee desde la 00297. `closer_emails` se queda: son los
--          otros correos con los que una persona graba.
--   workspaces.ai_background_settings:
--          call_analysis: mode, analyze_types, auto_summary, auto_knowledge y rubric (lo decide cada
--          analizador, 00303).
--          call_classification: allow_ai_types y discarded_types (la IA ya no propone tipos, 00300).
--
-- ORDEN: va DESPUES de desplegar el codigo que ya no usa nada de esto, y despues de la 00307. Con
-- el codigo viejo desplegado, la lista y la ficha de Grabaciones dan error. Un clon tiene que
-- desplegar primero y aplicar esta migracion despues.
--
-- ANTES DE APLICAR, consultas de seguridad:
--
--   -- Grabaciones con una clave vieja que no quedaron con area: van a decir "Sin clasificar".
--   -- Son las que la 00300 no pudo convertir. Se pueden clasificar a mano desde la ficha.
--   SELECT count(*) FROM public.calls WHERE call_type IS NOT NULL AND area_id IS NULL AND NOT no_show;
--
--   -- Lo que se pierde de la marca vieja de closer (no se usa para nada).
--   SELECT count(*) FROM public.workspace_members WHERE is_closer;
--
--   -- Claves que se van de la configuracion.
--   SELECT id, ai_background_settings->'call_analysis' FROM public.workspaces
--    WHERE ai_background_settings ? 'call_analysis';
--
-- PARA VOLVER ATRAS: las columnas vuelven vacias, no con lo que tenian. Se recrean con las
-- definiciones de la 00145 y lo guardado se recupera del respaldo del proyecto
-- (`docs/llamadas/respaldo-etapa5.json`).
--
--   ALTER TABLE public.calls
--     ADD COLUMN call_type text,
--     ADD COLUMN call_type_source text CHECK (call_type_source IN ('rule', 'ai', 'human')),
--     ADD COLUMN call_type_rule text,
--     ADD COLUMN call_type_confidence numeric(3, 2) CHECK (call_type_confidence IS NULL OR (call_type_confidence >= 0 AND call_type_confidence <= 1)),
--     ADD COLUMN call_type_alternative text,
--     ADD COLUMN call_type_proposed text;
--   ALTER TABLE public.workspace_members ADD COLUMN is_closer boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'calls' AND column_name = 'call_type'
  ) THEN
    -- Lo que clasifico el codigo viejo entre la 00307 y el deploy no se pierde.
    EXECUTE $sql$
      UPDATE public.calls SET classification_source = 'human'
       WHERE call_type_source = 'human' AND classification_source IS DISTINCT FROM 'human'
    $sql$;
    EXECUTE $sql$
      UPDATE public.calls
         SET classification_rule = CASE WHEN classification_source IN ('booking', 'connection', 'human') THEN NULL ELSE call_type_rule END,
             classification_confidence = call_type_confidence
       WHERE classification_rule IS NULL
         AND classification_confidence IS NULL
         AND (call_type_rule IS NOT NULL OR call_type_confidence IS NOT NULL)
    $sql$;
    EXECUTE $sql$
      UPDATE public.calls SET no_show = true WHERE call_type = 'no_show' AND no_show = false
    $sql$;
  END IF;
END $$;

ALTER TABLE public.calls
  DROP COLUMN IF EXISTS call_type,
  DROP COLUMN IF EXISTS call_type_source,
  DROP COLUMN IF EXISTS call_type_rule,
  DROP COLUMN IF EXISTS call_type_confidence,
  DROP COLUMN IF EXISTS call_type_alternative,
  DROP COLUMN IF EXISTS call_type_proposed;

ALTER TABLE public.workspace_members
  DROP COLUMN IF EXISTS is_closer;

UPDATE public.workspaces
   SET ai_background_settings = jsonb_set(
         ai_background_settings,
         '{call_analysis}',
         (ai_background_settings->'call_analysis') - ARRAY['mode', 'analyze_types', 'auto_summary', 'auto_knowledge', 'rubric']
       )
 WHERE jsonb_typeof(ai_background_settings->'call_analysis') = 'object'
   AND (ai_background_settings->'call_analysis') ?| ARRAY['mode', 'analyze_types', 'auto_summary', 'auto_knowledge', 'rubric'];

UPDATE public.workspaces
   SET ai_background_settings = jsonb_set(
         ai_background_settings,
         '{call_classification}',
         (ai_background_settings->'call_classification') - ARRAY['allow_ai_types', 'discarded_types']
       )
 WHERE jsonb_typeof(ai_background_settings->'call_classification') = 'object'
   AND (ai_background_settings->'call_classification') ?| ARRAY['allow_ai_types', 'discarded_types'];
