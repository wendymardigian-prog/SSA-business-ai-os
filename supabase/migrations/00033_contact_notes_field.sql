-- ============================================================
-- MIGRACION 00033 — LAS NOTAS PASAN A SER UN CAMPO DEL CONTACTO (F3)
-- ============================================================
-- Cambio deliberado respecto de lo que definia la Fase 1: las notas dejan de
-- ser una tabla con una fila por nota y pasan a ser un solo campo de texto en
-- el contacto. Lo que se gana es lo obvio —escribir una nota es escribir en un
-- campo, no crear un registro— y lo que se pierde conviene decirlo en voz alta:
-- ya no hay autor ni fecha por nota, y cualquiera que pueda editar el contacto
-- puede reescribir el texto entero.
--
-- Lo segundo se compensa en parte con el audit log: cada guardado deja quien
-- cambio las notas y de que texto a que texto, asi que la historia no se
-- pierde, solo deja de estar a la vista.
--
-- La tabla contact_notes NO se borra. Queda deprecada y sin nadie
-- escribiendole. Borrarla ahora romperia purge_soft_deleted (que la nombra) y
-- el cron que lee su contador, y no habria forma de volver atras si el campo
-- unico resulta insuficiente. Se limpia en otro bloque, cuando esto lleve
-- tiempo funcionando.
--
-- El bloque de migracion de contenido de abajo hoy no mueve nada porque la
-- tabla esta vacia, pero este proyecto se clona: alguien que lo levante con
-- notas cargadas necesita que funcione. Concatena en orden cronologico y deja
-- la fecha de cada nota, que es lo unico que se puede conservar sin autor.
-- ============================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.contacts.notes IS
  'Notas internas del contacto, en un solo texto. Reemplaza a la tabla contact_notes desde el Bloque 4. Quien cambio que queda en audit_log.';

-- ------------------------------------------------------------
-- Migracion del contenido que hubiera
-- ------------------------------------------------------------
-- Idempotente por partida doble: solo toca contactos cuyo campo esta vacio, y
-- solo lee notas sin borrar. Correrla dos veces no duplica nada.

DO $$
DECLARE
  v_migrados integer;
BEGIN
  WITH juntadas AS (
    SELECT
      n.contact_id,
      string_agg(
        to_char(n.created_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' — ' || n.content,
        E'\n\n' ORDER BY n.created_at
      ) AS texto
    FROM public.contact_notes n
    WHERE n.deleted_at IS NULL
    GROUP BY n.contact_id
  )
  UPDATE public.contacts c
  SET notes = j.texto
  FROM juntadas j
  WHERE c.id = j.contact_id
    AND (c.notes IS NULL OR btrim(c.notes) = '');

  GET DIAGNOSTICS v_migrados = ROW_COUNT;

  IF v_migrados > 0 THEN
    RAISE NOTICE 'Notas migradas al campo del contacto: % contactos', v_migrados;
  END IF;
END;
$$;

COMMENT ON TABLE public.contact_notes IS
  'DEPRECADA desde la migracion 00033: las notas viven en contacts.notes. La tabla se conserva para no perder lo que hubiera y porque purge_soft_deleted todavia la nombra. Nadie le escribe.';
