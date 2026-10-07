-- ============================================================
-- 00126_networks_format_backfill.sql  (Contenido v4, C9)
--
-- Completa `content_posts.networks[].format` desde el campo viejo
-- `networks[].options.contentType`, donde `format` esta vacio. Es el paso
-- previo a que el publicador de Instagram (y la validacion y el calculo de
-- media_type) dejen de leer `contentType` y lean solo `format`.
--
-- Mapeo (solo Instagram tenia `contentType`; las demas redes no se tocan):
--   reel     -> reel
--   story    -> story
--   carousel -> carousel
--   feed     -> image si la red (o, sin `files` propios, la pieza) tiene 1
--               archivo; carousel si tiene 2 o mas; NULL si tiene 0 (nunca
--               se adivina un formato sin archivos: queda para revisar a
--               mano, ver docs/PENDIENTE.md)
--   otro valor (no deberia haber ninguno) -> NULL
--
-- Idempotente: solo completa entradas con `format` vacio Y `contentType`
-- presente. Una vez corrida, una segunda corrida no encuentra nada que
-- cambiar.
--
-- Reversa: poner `format` en NULL donde la pieza tenga
-- `networks[].options.contentType`:
--   update content_posts set networks = (
--     select jsonb_agg(
--       case when n->'options'->>'contentType' is not null
--         then n - 'format' else n end
--     ) from jsonb_array_elements(networks) n
--   ) where networks @> '[{"options":{}}]'::jsonb; -- (ajustar el filtro)
-- La definicion completa de esta migracion, para copiar y pegar en la
-- reversa si hiciera falta el detalle exacto, queda en este comentario.
-- ============================================================

-- Funcion de uso unico: transforma un `networks[]` completo. `media` es la
-- biblioteca de la pieza, para contar archivos cuando la red no tiene
-- `files` propios (modelo anterior a F92/F93).
CREATE OR REPLACE FUNCTION private._cv4_backfill_network_format(networks jsonb, media jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  entry jsonb;
  result jsonb := '[]'::jsonb;
  content_type text;
  file_count int;
  new_format text;
BEGIN
  FOR entry IN SELECT * FROM jsonb_array_elements(COALESCE(networks, '[]'::jsonb))
  LOOP
    content_type := entry -> 'options' ->> 'contentType';

    IF entry ->> 'platform' = 'instagram'
       AND (entry ->> 'format' IS NULL OR entry ->> 'format' = '')
       AND content_type IS NOT NULL
    THEN
      IF entry ? 'files' THEN
        file_count := jsonb_array_length(entry -> 'files');
      ELSE
        file_count := COALESCE(jsonb_array_length(media), 0);
      END IF;

      new_format := CASE content_type
        WHEN 'reel' THEN 'reel'
        WHEN 'story' THEN 'story'
        WHEN 'carousel' THEN 'carousel'
        WHEN 'feed' THEN
          CASE
            WHEN file_count >= 2 THEN 'carousel'
            WHEN file_count = 1 THEN 'image'
            ELSE NULL
          END
        ELSE NULL
      END;

      -- OJO: jsonb_set con un new_value que es SQL NULL devuelve SQL NULL
      -- (se pierde la fila entera), no el jsonb 'null'. Hay que convertir
      -- expresamente: to_jsonb(new_format) es NULL cuando new_format es
      -- NULL; coalesce a 'null'::jsonb lo vuelve un valor jsonb valido.
      entry := jsonb_set(entry, '{format}', COALESCE(to_jsonb(new_format), 'null'::jsonb), true);
    END IF;

    result := result || jsonb_build_array(entry);
  END LOOP;

  RETURN result;
END;
$$;

-- Respaldo de lo que se va a tocar, para poder auditar o volver atras sin
-- adivinar que habia antes (se consulta con list_migrations / execute_sql;
-- no es una tabla nueva, es el registro de esta corrida en el comentario de
-- PROGRESS-CV4.md tras aplicar).
UPDATE public.content_posts
SET networks = private._cv4_backfill_network_format(networks, media)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(networks) n
  WHERE n ->> 'platform' = 'instagram'
    AND (n ->> 'format' IS NULL OR n ->> 'format' = '')
    AND n -> 'options' ->> 'contentType' IS NOT NULL
);

DROP FUNCTION private._cv4_backfill_network_format(jsonb, jsonb);
