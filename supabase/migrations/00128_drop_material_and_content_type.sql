-- ============================================================
-- 00128_drop_material_and_content_type.sql  (Contenido v4, C4 + C9)
--
-- ESCRITA Y NO APLICADA A PROPOSITO (regla del proyecto: lo destructivo se
-- escribe y se anota, nunca se aplica en la misma corrida que lo reemplaza).
-- Ver docs/PENDIENTE.md, seccion "Contenido v4", para el orden exacto y el
-- estado de las consultas de seguridad de abajo.
--
-- Borra DOS cosas que dejaron de leerse en esta tanda:
--
--   1. `content_posts.material_status` (C4): reemplazado por el dropdown de
--      estado, teñido con el color del estado. Sin referencias en lib/ ni en
--      app/ fuera de un comentario en el tipo de la base (que dice "sin uso,
--      se borra en la 00128").
--   2. La clave `options.contentType` dentro de `content_posts.networks[]`
--      (C9): reemplazada por `networks[].format`, el unico campo de formato.
--      No es una columna, es una clave de un jsonb: se borra con
--      `jsonb_set(... '{options}' ...)` quitando `contentType` del objeto
--      `options` de cada entrada de red, sin tocar el resto.
--
-- Esta migracion NO borra `copy`, `hook`, `angle`, `notes` ni `pillar`
-- (texto): esos ya los borro la 00118 (Contenido v3, 6/10/2026).
--
-- ============================================================
-- Consultas de seguridad: tienen que dar 0 ANTES de aplicar esta migracion.
-- ============================================================
--
--   -- A. Nada en el codigo desplegado lee material_status (fuera del
--   --    comentario del tipo y de esta migracion): se verifica con
--   --    `grep -rn "material_status" lib app` en el commit que esta en
--   --    produccion, no aca.
--
--   -- B. Nada en el codigo desplegado lee options.contentType como dato de
--   --    la pieza (fuera del campo propio que el body de Zernio le manda a
--   --    Zernio, que se llama igual mal pero es otra cosa): se verifica con
--   --    `grep -rn "contentType" lib app` en el commit que esta en
--   --    produccion.
--
--   -- C. Nadie quedo con una red sin `format` que dependiera de
--   --    `options.contentType` para programarse: tiene que dar 0.
--   SELECT count(*) FROM content_posts p, jsonb_array_elements(p.networks) n
--   WHERE n ->> 'platform' = 'instagram'
--     AND (n ->> 'format' IS NULL OR n ->> 'format' = '')
--     AND n -> 'options' ->> 'contentType' IS NOT NULL;
--
--   -- D. Un respaldo de lo que se va a borrar (no es una tabla nueva: una
--   --    exportacion a un archivo, fuera de la base, antes de aplicar):
--   SELECT id, material_status, networks FROM content_posts WHERE deleted_at IS NULL;
--
-- ============================================================
-- Reversa (solo funciona si se guardo el respaldo de la consulta D; sin eso
-- es IRREVERSIBLE: los valores se pierden):
--   ALTER TABLE public.content_posts ADD COLUMN material_status text;
--   -- + restaurar material_status y options.contentType desde el respaldo.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'content_posts' AND column_name = 'material_status'
  ) THEN
    ALTER TABLE public.content_posts DROP CONSTRAINT IF EXISTS content_posts_material_check;
    ALTER TABLE public.content_posts DROP COLUMN material_status;
  END IF;
END $$;

-- Saca la clave 'contentType' de adentro de 'options', en cada entrada de
-- 'networks' de cada pieza que la tenga. El resto de la entrada (platform,
-- format, files, cta, planned_at...) no se toca.
UPDATE public.content_posts
SET networks = (
  SELECT jsonb_agg(
    CASE
      WHEN n -> 'options' ? 'contentType'
        THEN jsonb_set(n, '{options}', (n -> 'options') - 'contentType')
      ELSE n
    END
  )
  FROM jsonb_array_elements(networks) n
)
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(networks) n WHERE n -> 'options' ? 'contentType'
);
