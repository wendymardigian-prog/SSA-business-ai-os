# Pendientes — Contactos: regla única

Formato: **qué quedó** / por qué / qué se decidió.

## Duplicados que ya existen (C4)
- **Qué quedó:** al 13/10/2026, **un solo par** (844 contactos vivos, 1 workspace): el de Instagram `fede.com.ia` (abajo). Cero por teléfono, email (principal o secundario), cruces teléfono↔WhatsApp o email↔secundario, TikTok, X o LinkedIn.
- **Cómo se vuelve a mirar** (solo lectura; pegar en `supabase db query --linked -f`):

```sql
-- Duplicados vivos por dato fuerte, por workspace. Cada fila es UN dato compartido por 2 o mas contactos.
WITH live AS (
  SELECT id, workspace_id, created_at, display_name, phone, whatsapp_phone, email, secondary_email,
         lower(instagram_username) AS ig, lower(tiktok_username) AS tt, lower(twitter_username) AS x,
         public.linkedin_slug(linkedin_profile_url) AS li
  FROM public.contacts WHERE deleted_at IS NULL
), vals AS (
  SELECT workspace_id, 'telefono' AS tipo, phone AS dato, id, created_at FROM live WHERE phone IS NOT NULL AND btrim(phone) <> ''
  UNION ALL SELECT workspace_id, 'telefono', whatsapp_phone, id, created_at FROM live WHERE whatsapp_phone IS NOT NULL AND btrim(whatsapp_phone) <> ''
  UNION ALL SELECT workspace_id, 'email', public.normalize_email(email), id, created_at FROM live WHERE public.normalize_email(email) IS NOT NULL
  UNION ALL SELECT workspace_id, 'email', public.normalize_email(secondary_email), id, created_at FROM live WHERE public.normalize_email(secondary_email) IS NOT NULL
  UNION ALL SELECT workspace_id, 'instagram', ig, id, created_at FROM live WHERE ig IS NOT NULL
  UNION ALL SELECT workspace_id, 'tiktok', tt, id, created_at FROM live WHERE tt IS NOT NULL
  UNION ALL SELECT workspace_id, 'x', x, id, created_at FROM live WHERE x IS NOT NULL
  UNION ALL SELECT workspace_id, 'linkedin', li, id, created_at FROM live WHERE li IS NOT NULL
)
SELECT workspace_id, tipo, dato, count(DISTINCT id) AS contactos,
       array_agg(DISTINCT id::text) AS ids, min(created_at) AS primero, max(created_at) AS ultimo
FROM vals GROUP BY workspace_id, tipo, dato HAVING count(DISTINCT id) > 1
ORDER BY tipo, dato;
```

- **Decisión:** nada se fusiona solo. Cada par lo decide una persona (Owner/Admin).

## Duplicado existente: Instagram `fede.com.ia`
- **Qué quedó:** dos contactos con el mismo @ de Instagram, creados con 8 ms de diferencia el 10/10/2026: `7c8a2ad4-40b2-46f3-a80b-9748962c0409` (12:33:00.290, sin canal, 1 conversación) y `f370f154-a81e-4e86-a82e-1893d1153493` (12:33:00.298, con canal, 1 conversación).
- **Por qué:** la carrera que esta regla única cierra; antes no había bloqueo.
- **Decisión:** no se fusiona solo. Se unen a mano con `linkContacts` (Owner/Admin), recomendado conservar `f370f154…` (tiene el canal).

## Índices únicos (`00205`) — SIN APLICAR, aplicar DESPUÉS de desplegar el PR
- **Qué quedó:** `supabase/migrations/00205_contacts_unique_identity.sql` está escrita y **ensayada dentro de una transacción que se deshace sola** (`verify-contacts-single-entry.mjs`: teléfono repetido se rechaza, email repetido con otras mayúsculas se rechaza, otro workspace puede repetir, un contacto borrado no bloquea, WhatsApp y email secundario no cuentan, restaurar un borrado con el dato de otro se rechaza). **No está aplicada ni registrada.**
- **Por qué no antes:** con el código de `main` en producción, `linkContacts` rellenaba el principal ANTES de borrar al duplicado y, con el índice, perdería ese relleno en silencio. El PR corrige el orden; el índice va después.
- **Pasos exactos (después de mergear y desplegar):**
  1. Correr la consulta de duplicados de arriba: tiene que dar **0 filas de tipo `telefono` y `email`** (el par de Instagram no cuenta para este índice). La propia migración aborta con `RAISE EXCEPTION` si encuentra alguno.
  2. `list_migrations` para confirmar la numeración (si otra rama usó la 00205, renumerar el archivo).
  3. `supabase db query --linked -f supabase/migrations/00205_contacts_unique_identity.sql`.
  4. Registrarla en `supabase_migrations.schema_migrations` (version = timestamp UTC, name = `00205_contacts_unique_identity`, statements = el SQL) y `node scripts/build-all-migrations.mjs`.
  5. `node scripts/verify-contacts-single-entry.mjs` (con los índices presentes, prueba los rechazos de verdad), `verify-forms`, `verify-crm`, `verify-csv-import`.
- **Cómo volver atrás:** `DROP INDEX public.uq_contacts_workspace_phone; DROP INDEX public.uq_contacts_workspace_email;`

## Fusión de contactos sin pantalla propia
- **Qué quedó:** `linkContacts` solo se alcanza desde el banner de sugerencia.
- **Decisión:** pendiente una pantalla "fusionar con…".

## Otros pendientes anotados durante la ejecución
- **`verify-forms` ("el job genera el PDF de la firma", `already`)**, **`verify-attribution` (784 de 843 con first_touch)** y **`verify-publishing`** ya fallaban antes de este trabajo; no se tocaron.
- **Facebook** entra a la identidad solo desde un canal de Facebook (hoy no hay): los formularios y el alta manual no lo usan para buscar.
- **Fusión de contactos:** la otra sesión (Tareas CRM) trae `merge_contacts` (00206/00207); cuando se mergee, `linkContacts` puede quedar como envoltorio de esa función.
