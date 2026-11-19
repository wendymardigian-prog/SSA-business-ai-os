-- ============================================================
-- 00410_trash_engine.sql
-- ============================================================
-- La Papelera (docs/papelera.md): eliminar ventas, pagos, reuniones, servicios,
-- grabaciones, formularios y demas, con 30 dias para restaurar.
--
-- Traida de RER-BAIOS (sus 00474/00475, 18/11/2026) y adaptada a SSA: sin tickets
-- (SSA no los tiene). Contactos y tareas siguen con su borrado suave (`deleted_at`).
--
-- Por que una FOTO y no `deleted_at` en cada tabla: agregar la columna obligaria
-- a filtrar en decenas de lectores (funciones SECURITY DEFINER de metricas,
-- finanzas, comisiones, crons). Un olvido mostraria un registro "eliminado" en un
-- numero. Aca el registro se borra de verdad y su foto (la fila y todo lo que
-- colgaba de ella por `ON DELETE CASCADE`) queda en `private.trash_items` hasta
-- que vence. Restaurar vuelve a insertar las mismas filas, con los mismos ids.
--
-- El motor es generico: recorre `pg_constraint`. Una tabla hija nueva queda
-- cubierta sola, sin tocar esta migracion.
--
--   * CASCADE        -> la fila hija entra en la foto (y se recorre).
--   * SET NULL/DEFAULT -> se anota para volver a enlazarla al restaurar.
--   * RESTRICT/NO ACTION -> bloquea, salvo que esa fila tambien se elimine.
--
-- Restaurar apaga los triggers de las tablas que vuelve a llenar (solo dentro de
-- esa transaccion, por nombre, y los vuelve a prender antes de terminar): las
-- filas vuelven tal cual estaban, sin regenerar comisiones, eventos de Meta,
-- servicios, avisos ni automatizaciones. Las claves foraneas SI se siguen
-- controlando (son triggers internos que no se tocan); igual se comprueban antes
-- para devolver un motivo claro.
--
-- Por que no `session_replication_role = replica`: Supabase no deja cambiarlo
-- desde una funcion (permission denied). `ALTER TABLE … DISABLE TRIGGER` si,
-- porque el dueno de las tablas es el dueno de la funcion. Toma un candado
-- exclusivo sobre esas tablas hasta el final de la restauracion (milisegundos);
-- con `lock_timeout` de 3 s, si una tabla esta ocupada responde `busy` en vez
-- de hacer esperar a todos.
--
-- Esta migracion trae el motor, la tabla, el tombstone de Fathom, la purga, la
-- lista y la restauracion. Las reglas de cada entidad estan en la 00411.
--
-- Aditiva: tablas y funciones nuevas. Puede ir antes o despues del codigo
-- (sin ella, eliminar responde un error claro).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tablas
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.trash_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity ~ '^[a-z_]{1,40}$'),
  entity_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 300),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trash_items_ws_live
  ON private.trash_items (workspace_id, deleted_at DESC) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_trash_items_expires ON private.trash_items (expires_at);

ALTER TABLE private.trash_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.trash_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.trash_items TO service_role;

COMMENT ON TABLE private.trash_items IS
  'Papelera (00410): la foto de lo eliminado, 30 dias. Solo la leen y escriben funciones; nunca viaja al navegador.';

-- Una grabacion eliminada no vuelve a entrar al sincronizar Fathom ni al importar el historial.
-- Sin vencimiento y sin datos personales: solo el id externo.
CREATE TABLE IF NOT EXISTS public.calls_deleted_external (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source text NOT NULL,
  external_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source, external_id)
);

ALTER TABLE public.calls_deleted_external ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calls_deleted_external FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.calls_deleted_external TO service_role;

COMMENT ON TABLE public.calls_deleted_external IS
  'Grabaciones eliminadas a mano (00410): la ingesta de Fathom las saltea. Restaurar la grabacion saca la fila.';

-- ------------------------------------------------------------
-- 2. Ayudantes del catalogo
-- ------------------------------------------------------------

-- Las columnas de la clave primaria, en orden.
CREATE OR REPLACE FUNCTION private.trash_pk(p_rel regclass)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT array_agg(a.attname::text ORDER BY k.ord)
  FROM pg_catalog.pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = p_rel AND i.indisprimary;
$$;

-- Las claves de una fila que importan (la clave primaria, o lo que se pida).
CREATE OR REPLACE FUNCTION private.trash_pick(p_row jsonb, p_cols text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_object_agg(c, p_row -> c), '{}'::jsonb) FROM unnest(p_cols) AS c;
$$;

-- "Las filas de esta tabla cuyas columnas coinciden con estas filas de la otra".
-- Devuelve un predicado sobre el alias `c`, con las filas de referencia en $1 (jsonb array).
-- Cada valor se convierte al tipo de la columna (no al reves) para que el indice sirva.
CREATE OR REPLACE FUNCTION private.trash_match(
  p_child regclass, p_child_cols smallint[], p_parent regclass, p_parent_cols smallint[]
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT '(' || string_agg(format('c.%I', ca.attname), ', ' ORDER BY k.ord) || ') IN (SELECT '
         || string_agg(format('(x ->> %L)::%s', pa.attname, pg_catalog.format_type(ca.atttypid, ca.atttypmod)), ', ' ORDER BY k.ord)
         || ' FROM jsonb_array_elements($1) AS x WHERE '
         || string_agg(format('x ->> %L IS NOT NULL', pa.attname), ' AND ' ORDER BY k.ord) || ')'
  FROM unnest(p_child_cols, p_parent_cols) WITH ORDINALITY AS k(ck, pk, ord)
  JOIN pg_catalog.pg_attribute ca ON ca.attrelid = p_child AND ca.attnum = k.ck
  JOIN pg_catalog.pg_attribute pa ON pa.attrelid = p_parent AND pa.attnum = k.pk;
$$;

-- ------------------------------------------------------------
-- 3. Recorrer lo que cuelga de unas filas
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.trash_walk(p_rel regclass, p_rows jsonb, p_depth integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_con record;
  v_cond text;
  v_rows jsonb;
  v_pk text[];
  v_cols text[];
  v_sub jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('entries', v_entries, 'relinks', v_relinks, 'blockers', v_blockers);
  END IF;
  IF p_depth > 10 THEN
    RAISE EXCEPTION 'trash: demasiados niveles debajo de %', p_rel USING ERRCODE = 'P0001';
  END IF;

  FOR v_con IN
    SELECT c.conrelid::regclass AS child, c.confdeltype AS action, c.conkey, c.confkey
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f' AND c.confrelid = p_rel
    ORDER BY c.conrelid::regclass::text, c.conname
  LOOP
    v_cond := private.trash_match(v_con.child, v_con.conkey, p_rel, v_con.confkey);
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(c)), ''[]''::jsonb) FROM %s AS c WHERE %s', v_con.child, v_cond)
      INTO v_rows USING p_rows;
    CONTINUE WHEN jsonb_array_length(v_rows) = 0;

    v_pk := private.trash_pk(v_con.child);

    IF v_con.action = 'c' THEN
      -- Se va con el padre: entra en la foto, y lo que cuelga de ella tambien.
      SELECT v_entries || COALESCE(jsonb_agg(jsonb_build_object('t', v_con.child::text, 'r', r)), '[]'::jsonb)
        INTO v_entries FROM jsonb_array_elements(v_rows) AS r;
      v_sub := private.trash_walk(v_con.child, v_rows, p_depth + 1);
      v_entries := v_entries || (v_sub -> 'entries');
      v_relinks := v_relinks || (v_sub -> 'relinks');
      v_blockers := v_blockers || (v_sub -> 'blockers');
    ELSIF v_con.action IN ('n', 'd') THEN
      -- Queda, sin el vinculo: se anota para volver a enlazarla al restaurar.
      CONTINUE WHEN v_pk IS NULL;
      SELECT array_agg(a.attname::text ORDER BY k.ord) INTO v_cols
      FROM unnest(v_con.conkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_catalog.pg_attribute a ON a.attrelid = v_con.child AND a.attnum = k.attnum;
      SELECT v_relinks || COALESCE(jsonb_agg(jsonb_build_object(
               't', v_con.child::text, 'pk', private.trash_pick(r, v_pk), 'set', private.trash_pick(r, v_cols))), '[]'::jsonb)
        INTO v_relinks FROM jsonb_array_elements(v_rows) AS r;
    ELSE
      -- RESTRICT / NO ACTION: bloquea, salvo que esa fila tambien se elimine (lo resuelve trash_capture).
      SELECT v_blockers || COALESCE(jsonb_agg(jsonb_build_object(
               't', v_con.child::text, 'pk', CASE WHEN v_pk IS NULL THEN NULL ELSE private.trash_pick(r, v_pk) END)), '[]'::jsonb)
        INTO v_blockers FROM jsonb_array_elements(v_rows) AS r;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entries', v_entries, 'relinks', v_relinks, 'blockers', v_blockers);
END;
$$;

-- La foto de varias raices, en el orden en que se vuelven a insertar (el padre antes que el hijo).
-- p_roots: [{"t": "public.sales", "ids": ["…"]}, {"t": "public.payments", "ids": [...]}, ...]
-- Devuelve {entries, relinks, blockers: [{"t": tabla, "n": cantidad}], counts: {tabla: cantidad}}.
CREATE OR REPLACE FUNCTION private.trash_capture(p_roots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_root jsonb;
  v_rel regclass;
  v_rows jsonb;
  v_sub jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_relinks jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_counts jsonb;
  v_left jsonb;
BEGIN
  FOR v_root IN SELECT value FROM jsonb_array_elements(COALESCE(p_roots, '[]'::jsonb)) LOOP
    CONTINUE WHEN jsonb_array_length(COALESCE(v_root -> 'ids', '[]'::jsonb)) = 0;
    v_rel := (v_root ->> 't')::regclass;
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), ''[]''::jsonb) FROM %s AS c '
      'WHERE c.id = ANY (SELECT (x #>> ''{}'')::uuid FROM jsonb_array_elements($1) AS x)', v_rel)
      INTO v_rows USING v_root -> 'ids';
    SELECT v_entries || COALESCE(jsonb_agg(jsonb_build_object('t', v_rel::text, 'r', r)), '[]'::jsonb)
      INTO v_entries FROM jsonb_array_elements(v_rows) AS r;
    v_sub := private.trash_walk(v_rel, v_rows, 1);
    v_entries := v_entries || (v_sub -> 'entries');
    v_relinks := v_relinks || (v_sub -> 'relinks');
    v_blockers := v_blockers || (v_sub -> 'blockers');
  END LOOP;

  -- Sin repetidos (una fila a la que se llega por dos caminos): queda la primera, que es la del padre.
  SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO v_entries
  FROM (
    SELECT e, ord, row_number() OVER (
      PARTITION BY e ->> 't', private.trash_pick(e -> 'r', private.trash_pk((e ->> 't')::regclass))
      ORDER BY ord) AS rn
    FROM jsonb_array_elements(v_entries) WITH ORDINALITY AS x(e, ord)
  ) d WHERE rn = 1;

  -- Un vinculo de una fila que tambien se elimina no se anota: la fila vuelve entera.
  SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) INTO v_relinks
  FROM jsonb_array_elements(v_relinks) AS l
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_entries) AS e
    WHERE e ->> 't' = l ->> 't' AND (e -> 'r') @> (l -> 'pk'));

  -- Lo que bloquea y no se elimina en esta misma operacion.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', t, 'n', n) ORDER BY t), '[]'::jsonb) INTO v_left
  FROM (
    SELECT b ->> 't' AS t, count(*) AS n
    FROM jsonb_array_elements(v_blockers) AS b
    WHERE b -> 'pk' IS NULL OR jsonb_typeof(b -> 'pk') = 'null' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_entries) AS e
      WHERE e ->> 't' = b ->> 't' AND (e -> 'r') @> (b -> 'pk'))
    GROUP BY b ->> 't'
  ) s;

  SELECT COALESCE(jsonb_object_agg(t, n), '{}'::jsonb) INTO v_counts
  FROM (SELECT e ->> 't' AS t, count(*) AS n FROM jsonb_array_elements(v_entries) AS e GROUP BY e ->> 't') s;

  RETURN jsonb_build_object('entries', v_entries, 'relinks', v_relinks, 'blockers', v_left, 'counts', v_counts);
END;
$$;

-- Borra las raices en el orden inverso al de la foto (el hijo antes que el padre).
CREATE OR REPLACE FUNCTION private.trash_delete_roots(p_roots jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_root jsonb;
BEGIN
  FOR v_root IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_roots, '[]'::jsonb)) WITH ORDINALITY AS x(value, ord) ORDER BY ord DESC
  LOOP
    CONTINUE WHEN jsonb_array_length(COALESCE(v_root -> 'ids', '[]'::jsonb)) = 0;
    EXECUTE format(
      'DELETE FROM %s WHERE id = ANY (SELECT (x #>> ''{}'')::uuid FROM jsonb_array_elements($1) AS x)',
      (v_root ->> 't')::regclass)
      USING v_root -> 'ids';
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 4. Restaurar una foto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.trash_restore_snapshot(p_snapshot jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entry jsonb;
  v_link jsonb;
  v_rel regclass;
  v_cols text;
  v_key text;
  v_pkcond text;
  v_type text;
  v_tables regclass[];
  v_touched regclass[];
  v_trg record;
  v_off jsonb := '[]'::jsonb;
  v_con record;
  v_check text;
  v_nulls text;
  v_entries jsonb;
  v_missing bigint;
  v_pending jsonb;
  v_retry jsonb;
  v_progress boolean;
  v_fk_error text;
BEGIN
  SELECT array_agg(DISTINCT (e ->> 't')::regclass) INTO v_tables
  FROM jsonb_array_elements(COALESCE(p_snapshot -> 'entries', '[]'::jsonb)) AS e;
  v_tables := COALESCE(v_tables, ARRAY[]::regclass[]);
  SELECT array_agg(DISTINCT (l ->> 't')::regclass) INTO v_touched
  FROM jsonb_array_elements(COALESCE(p_snapshot -> 'relinks', '[]'::jsonb)) AS l;
  v_touched := v_tables || COALESCE(v_touched, ARRAY[]::regclass[]);

  -- 1. Antes de tocar nada: que cada padre exista. El padre puede estar en la misma foto (la venta de sus
  -- pagos): eso cuenta como presente. Si falta el padre de un vinculo opcional (ON DELETE SET NULL, como la
  -- reunion de una grabacion), la fila vuelve sin ese vinculo, igual que si el padre se hubiera borrado con
  -- ella viva. Si falta uno obligatorio (el contacto de una venta), no se restaura nada y se dice cual.
  v_entries := COALESCE(p_snapshot -> 'entries', '[]'::jsonb);
  FOR v_con IN
    SELECT c.conrelid::regclass AS child, c.confrelid::regclass AS parent, c.conkey, c.confkey, c.confdeltype
    FROM pg_catalog.pg_constraint c
    WHERE c.contype = 'f' AND c.conrelid = ANY (v_tables)
  LOOP
    SELECT
      'e ->> ''t'' = ' || quote_literal(v_con.child::text)
      || ' AND ' || string_agg(format('(e -> ''r'' ->> %L) IS NOT NULL', ca.attname), ' AND ')
      || format(' AND NOT EXISTS (SELECT 1 FROM %s AS p WHERE ', v_con.parent)
      || string_agg(format('p.%I = (e -> ''r'' ->> %L)::%s', pa.attname, ca.attname, pg_catalog.format_type(pa.atttypid, pa.atttypmod)), ' AND ')
      || ') AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) AS q WHERE q ->> ''t'' = ' || quote_literal(v_con.parent::text)
      || ' AND ' || string_agg(format('(q -> ''r'' ->> %L) = (e -> ''r'' ->> %L)', pa.attname, ca.attname), ' AND ') || ')',
      'jsonb_build_object(' || string_agg(format('%L, NULL', ca.attname), ', ') || ')'
      INTO v_check, v_nulls
    FROM unnest(v_con.conkey, v_con.confkey) AS k(ck, pk)
    JOIN pg_catalog.pg_attribute ca ON ca.attrelid = v_con.child AND ca.attnum = k.ck
    JOIN pg_catalog.pg_attribute pa ON pa.attrelid = v_con.parent AND pa.attnum = k.pk;

    IF v_con.confdeltype IN ('n', 'd') THEN
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(CASE WHEN %s THEN jsonb_set(e, ''{r}'', (e -> ''r'') || %s) ELSE e END ORDER BY ord), ''[]''::jsonb) '
        'FROM jsonb_array_elements($1) WITH ORDINALITY AS x(e, ord)', v_check, v_nulls)
        INTO v_entries USING v_entries;
    ELSE
      EXECUTE 'SELECT count(*) FROM jsonb_array_elements($1) AS e WHERE ' || v_check INTO v_missing USING v_entries;
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'trash_missing_parent:%', v_con.parent::text USING ERRCODE = 'foreign_key_violation';
      END IF;
    END IF;
  END LOOP;

  -- 2. Los triggers de usuario de esas tablas, apagados solo en esta transaccion.
  -- `ALTER TABLE` no se puede con chequeos diferidos pendientes (el formulario apunta a su version vigente con una
  -- clave DEFERRABLE): primero se corren los que haya (en la llamada de la app no hay ninguno; sirve si antes, en la
  -- misma transaccion, se borro algo de esas tablas). Despues, diferidos hasta que este todo adentro: el formulario
  -- entra antes que la version a la que apunta.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM set_config('lock_timeout', '3s', true);
  FOR v_trg IN
    SELECT t.tgrelid::regclass AS rel, t.tgname
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = ANY (v_touched) AND NOT t.tgisinternal AND t.tgenabled = 'O'
    ORDER BY t.tgrelid::regclass::text, t.tgname
  LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', v_trg.rel, v_trg.tgname);
    v_off := v_off || jsonb_build_object('rel', v_trg.rel::text, 'name', v_trg.tgname);
  END LOOP;

  -- 3. Las filas. La foto pone el padre antes que sus hijos, pero entre dos hijos del mismo registro el orden es
  -- el alfabetico de la tabla (los pasos de un servicio antes que sus fases, las respuestas de un formulario antes
  -- que sus versiones) y una tabla puede apuntarse a si misma. Una fila cuyo padre todavia no entro se deja para
  -- la vuelta siguiente; si una vuelta entera no avanza, el error es real y se devuelve.
  v_pending := v_entries;
  LOOP
    v_retry := '[]'::jsonb;
    v_progress := false;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_pending) LOOP
      v_rel := (v_entry ->> 't')::regclass;
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
      FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';
      BEGIN
        EXECUTE format('INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_record(NULL::%s, $1)',
                       v_rel, v_cols, v_cols, v_rel)
          USING v_entry -> 'r';
        v_progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_retry := v_retry || jsonb_build_array(v_entry);
        v_fk_error := SQLERRM;
      END;
    END LOOP;
    EXIT WHEN jsonb_array_length(v_retry) = 0;
    IF NOT v_progress THEN
      RAISE EXCEPTION '%', v_fk_error USING ERRCODE = 'foreign_key_violation';
    END IF;
    v_pending := v_retry;
  END LOOP;

  -- 4. Volver a enlazar lo que habia quedado sin vinculo, si nadie lo enlazo con otra cosa mientras tanto.
  FOR v_link IN SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot -> 'relinks', '[]'::jsonb)) LOOP
    v_rel := (v_link ->> 't')::regclass;
    SELECT string_agg(format('x.%I = ($2 ->> %L)::%s', a.attname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)), ' AND ')
      INTO v_pkcond
    FROM jsonb_object_keys(v_link -> 'pk') AS k
    JOIN pg_catalog.pg_attribute a ON a.attrelid = v_rel AND a.attname = k;
    CONTINUE WHEN v_pkcond IS NULL;
    FOR v_key IN SELECT jsonb_object_keys(v_link -> 'set') LOOP
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO v_type
      FROM pg_catalog.pg_attribute a WHERE a.attrelid = v_rel AND a.attname = v_key;
      CONTINUE WHEN v_type IS NULL OR (v_link -> 'set' ->> v_key) IS NULL;
      EXECUTE format('UPDATE %s AS x SET %I = ($1 ->> %L)::%s WHERE %s AND x.%I IS NULL',
                     v_rel, v_key, v_key, v_type, v_pkcond, v_key)
        USING v_link -> 'set', v_link -> 'pk';
    END LOOP;
  END LOOP;

  -- 5. Los triggers, prendidos otra vez (los mismos, por nombre). Antes, los chequeos diferidos de lo que se
  -- inserto (si no, `ALTER TABLE` se niega); como ya esta todo adentro, pasan.
  SET CONSTRAINTS ALL IMMEDIATE;
  FOR v_trg IN SELECT value AS v FROM jsonb_array_elements(v_off) LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', (v_trg.v ->> 'rel')::regclass, v_trg.v ->> 'name');
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 5. Que clave pide cada tipo de registro
-- ------------------------------------------------------------
-- Gemela de lib/trash/entities.ts (`TRASH_ENTITIES`): lib/trash/entities.test.ts las compara.
-- Literal por clave a proposito: cada `has_permission(…, '<clave>')` es la capa de la base de esa clave.

CREATE OR REPLACE FUNCTION private.trash_can(p_workspace_id uuid, p_entity text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(CASE p_entity
    WHEN 'booking'         THEN public.has_permission(p_workspace_id, 'bookings.delete')
    WHEN 'sale'            THEN public.has_permission(p_workspace_id, 'sales.delete')
    WHEN 'payment'         THEN public.has_permission(p_workspace_id, 'payments.delete')
    WHEN 'product'         THEN public.has_permission(p_workspace_id, 'products.delete')
    WHEN 'service'         THEN public.has_permission(p_workspace_id, 'services.delete')
    WHEN 'call'            THEN public.has_permission(p_workspace_id, 'calls.delete')
    WHEN 'form'            THEN public.has_permission(p_workspace_id, 'forms.delete')
    WHEN 'form_submission' THEN public.has_permission(p_workspace_id, 'forms.delete_responses')
    WHEN 'eod_report'      THEN public.has_permission(p_workspace_id, 'eod.delete')
    WHEN 'expense'         THEN public.has_permission(p_workspace_id, 'expenses.delete')
    WHEN 'commission'      THEN public.has_permission(p_workspace_id, 'commissions.delete')
    WHEN 'content_post'    THEN public.has_permission(p_workspace_id, 'content.delete')
    WHEN 'content_idea'    THEN public.has_permission(p_workspace_id, 'content.delete')
    WHEN 'conversation'    THEN public.has_permission(p_workspace_id, 'conversations.delete')
    ELSE false
  END, false);
$$;

REVOKE ALL ON FUNCTION private.trash_pk(regclass) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_pick(jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_match(regclass, smallint[], regclass, smallint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_walk(regclass, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_capture(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_delete_roots(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_restore_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.trash_can(uuid, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. La lista de la Papelera
-- ------------------------------------------------------------
-- Lo que la persona puede ver: solo los tipos cuya clave de eliminar tiene. Nunca la foto.

CREATE OR REPLACE FUNCTION public.trash_list(p_workspace_id uuid)
RETURNS TABLE (
  id uuid,
  entity text,
  entity_id uuid,
  label text,
  counts jsonb,
  deleted_by uuid,
  deleted_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.entity, t.entity_id, t.label, t.counts, t.deleted_by, t.deleted_at, t.expires_at
  FROM private.trash_items t
  WHERE t.workspace_id = p_workspace_id
    AND t.restored_at IS NULL
    AND t.expires_at > now()
    AND public.is_workspace_member(p_workspace_id)
    AND private.trash_can(p_workspace_id, t.entity)
  ORDER BY t.deleted_at DESC
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION public.trash_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_list(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Purga diaria
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.purge_trash()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM private.trash_items WHERE expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION private.purge_trash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.purge_trash() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trash-purge') THEN
      PERFORM cron.unschedule('trash-purge');
    END IF;
    PERFORM cron.schedule('trash-purge', '41 4 * * *', 'SELECT private.purge_trash()');
  END IF;
END $$;
