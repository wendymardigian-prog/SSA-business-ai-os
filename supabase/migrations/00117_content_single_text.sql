-- 00117: rellena el texto unico de ideas y piezas desde las columnas viejas
-- (Contenido v3, B12: F90).
--
-- Aditiva e idempotente. Solo escribe las columnas NUEVAS (content, script,
-- recording_notes) y solo donde estan vacias: nunca pisa algo que ya se haya
-- escrito con el modelo nuevo, y correrla dos veces no cambia nada. Las
-- columnas viejas (hook, angle, notes, copy) no se tocan: las borra la 00118,
-- que no se aplica.
--
-- Idea: content = hook + angulo + notas, separados por una linea en blanco y
-- salteando los que esten vacios.
-- Pieza: script = hook + desarrollo + CTA del copy; recording_notes = las
-- notas de grabacion del copy.
--
-- Hoy hay 1 idea y 1 pieza y las dos estan vacias: el backfill no toca ninguna
-- fila existente. Importa para el dia que se clone el sistema con datos.

UPDATE public.content_ideas
SET content = nullif(btrim(concat_ws(
  E'\n\n',
  nullif(btrim(hook), ''),
  nullif(btrim(angle), ''),
  nullif(btrim(notes), '')
)), '')
WHERE content IS NULL
  AND (
    nullif(btrim(hook), '') IS NOT NULL
    OR nullif(btrim(angle), '') IS NOT NULL
    OR nullif(btrim(notes), '') IS NOT NULL
  );

UPDATE public.content_posts
SET
  script = nullif(btrim(concat_ws(
    E'\n\n',
    nullif(btrim(copy ->> 'hook'), ''),
    nullif(btrim(copy ->> 'body'), ''),
    nullif(btrim(copy ->> 'cta'), '')
  )), ''),
  recording_notes = nullif(btrim(copy ->> 'recording_notes'), '')
WHERE script IS NULL
  AND recording_notes IS NULL
  AND jsonb_typeof(copy) = 'object'
  AND (
    nullif(btrim(copy ->> 'hook'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'body'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'cta'), '') IS NOT NULL
    OR nullif(btrim(copy ->> 'recording_notes'), '') IS NOT NULL
  );
