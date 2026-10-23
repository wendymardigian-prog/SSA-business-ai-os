-- ============================================================================
-- 00250_retire_inbox_keys
-- ============================================================================
-- Retira las seis claves `inbox.<red>.view/.reply` y el alcance `scopes.conversations`: desde la 00249 la
-- bandeja se da por CUENTA (`permissions.channels`) y nadie las lee.
--
--   1. Las saca del jsonb de cada rol personalizado (claves y alcance).
--   2. Redefine `private.member_permission_keys()` sin ellas (COPIA de MEMBER_PERMISSION_KEYS;
--      lib/auth/member-sql-parity.test.ts la compara). El Member de sistema sigue viendo la bandeja por
--      `private.member_channels()` (00249), no por estas claves.
--
-- ES UNA MIGRACION QUE BORRA. Orden (CLAUDE.md, "Una migracion que borra"):
--   a. La 00249 aplicada y el codigo que lee `channels` desplegado y comprobado en el servicio.
--   b. Las dos consultas de abajo en 0.
--   c. El respaldo de lo que se borra en docs/roles/respaldo-inbox-keys.json:
--        select id, name, permissions from public.workspace_roles
--        where system_role is null and (permissions -> 'keys' ?| array['inbox.instagram.view','inbox.instagram.reply',
--          'inbox.whatsapp.view','inbox.whatsapp.reply','inbox.email.view','inbox.email.reply']
--          or permissions -> 'scopes' ? 'conversations');
--   d. Recien ahi, esta migracion.
--
-- Consultas de seguridad (las dos tienen que dar 0):
--   -- Ningun rol personalizado sin `channels` (si no, perderia la bandeja al borrar sus claves):
--   select count(*) from public.workspace_roles where system_role is null and not (permissions ? 'channels');
--   -- Ninguna politica ni funcion viva lee las claves viejas o el alcance de conversaciones:
--   select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public','private') and p.prokind = 'f' and p.proname <> 'channels_from_legacy'
--     and p.proname <> 'member_permission_keys'
--     and (pg_get_functiondef(p.oid) ilike '%inbox.instagram%' or pg_get_functiondef(p.oid) ilike '%''conversations'')%');
--
-- Definicion vieja de `private.member_permission_keys()` (00231), para volver atras:
--   CREATE OR REPLACE FUNCTION private.member_permission_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO ''
--   AS $function$ SELECT ARRAY['dashboards.chat.view','inbox.instagram.view','inbox.instagram.reply','inbox.whatsapp.view',
--     'inbox.whatsapp.reply','inbox.email.view','inbox.email.reply','contacts.view','contacts.edit','contacts.assign',
--     'flows.view','flows.edit','flows.publish','sequences.view','agents.view','content.view','content.create',
--     'scheduling.use','bookings.view','bookings.manage','calls.view','forms.view','sales.view','sales.manage',
--     'payments.manage','tasks.view','tasks.edit','commissions.view']::text[] $function$;
-- Y las claves de cada rol, desde el respaldo.
--
-- Idempotente: quitar lo que ya no esta no cambia nada.
-- ============================================================================

SET search_path = '';

UPDATE public.workspace_roles r
SET permissions = jsonb_set(
      r.permissions,
      '{keys}',
      COALESCE((
        SELECT jsonb_agg(k.key ORDER BY k.ord)
        FROM jsonb_array_elements_text(r.permissions -> 'keys') WITH ORDINALITY AS k(key, ord)
        WHERE k.key NOT IN ('inbox.instagram.view', 'inbox.instagram.reply', 'inbox.whatsapp.view',
                            'inbox.whatsapp.reply', 'inbox.email.view', 'inbox.email.reply')
      ), '[]'::jsonb)
    ) #- '{scopes,conversations}'
WHERE r.system_role IS NULL
  AND jsonb_typeof(r.permissions -> 'keys') = 'array'
  AND (
    (r.permissions -> 'keys') ?| array['inbox.instagram.view', 'inbox.instagram.reply', 'inbox.whatsapp.view',
                                       'inbox.whatsapp.reply', 'inbox.email.view', 'inbox.email.reply']
    OR (r.permissions -> 'scopes') ? 'conversations'
  );

CREATE OR REPLACE FUNCTION private.member_permission_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT ARRAY[
    'dashboards.chat.view',
    'contacts.view',
    'contacts.edit',
    'contacts.assign',
    'flows.view',
    'flows.edit',
    'flows.publish',
    'sequences.view',
    'agents.view',
    'content.view',
    'content.create',
    'scheduling.use',
    'bookings.view',
    'bookings.manage',
    'calls.view',
    'forms.view',
    'sales.view',
    'sales.manage',
    'payments.manage',
    'tasks.view',
    'tasks.edit',
    'commissions.view'
  ]::text[]
$function$;
REVOKE ALL ON FUNCTION private.member_permission_keys() FROM PUBLIC, anon, authenticated;
