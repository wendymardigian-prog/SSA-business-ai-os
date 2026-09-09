# Advertencias de seguridad aceptadas

El linter de seguridad de Supabase (`get_advisors`, tipo `security`) reporta
cosas que en este proyecto están bien como están. Este documento explica cuáles
y por qué, para no volver a discutirlo cada trimestre — y, sobre todo, para que
nadie las "arregle" y rompa algo.

Estado al cierre de la Fase 2: **15 hallazgos, todos los de abajo.** Antes de la
pasada de endurecimiento eran 40.

---

## 1. Funciones de Vault ejecutables por usuarios logueados

`read_secret`, `store_secret`, `delete_secret`, `list_secret_names`,
`assert_can_manage_secrets`.

**Por qué está bien.** El control está adentro, no en el `GRANT`:
`assert_can_manage_secrets` deja pasar al `service_role` y para todo lo demás
exige `is_workspace_admin`, o corta con `forbidden`. Un Member rebota. Está
fijado como caso de regresión en `scripts/verify-rls.mjs`, bloque "Vault por
rol".

**Por qué no se revoca.** Los cuatro lugares que las llaman usan el cliente del
usuario **a propósito**, porque es el usuario quien tiene que estar autorizado:
`lib/actions/integrations.ts`, la pantalla de Integraciones y
`app/api/v1/channels/test-key/route.ts`. Pasarlas a service client movería la
decisión de autorización de la base a la app, que es al revés de cómo funciona
todo el resto del sistema.

## 2. Helpers de RLS ejecutables por usuarios logueados

`is_workspace_member`, `is_workspace_admin`, `is_workspace_owner`,
`can_see_contact`, `can_see_conversation`.

**No se pueden revocar.** Las llaman ~37 expresiones de policy sobre 23 tablas, y
una expresión de policy se evalúa **con el rol de la sesión**, no como definer.
Sin `EXECUTE`, cada `SELECT` sobre contactos, conversaciones, canales o flows
falla con `permission denied for function`. Es decir: la app entera.

`scripts/verify-rls.mjs` tiene un bloque llamado "Canario: la app sigue leyendo"
justamente para detectar esto si alguien lo intenta.

Si algún día el objetivo fuera callar al linter, la única salida correcta sería
mover las funciones a un schema que PostgREST no publique y actualizar las 37
policies. No vale la pena por un warning.

## 3. Tablas con RLS activa y sin policies

`private.system_config`, `public.webhook_events`, `public.scheduled_jobs`.

**Es la configuración correcta**, no un olvido: RLS activa sin policies significa
deny-all para `anon` y `authenticated`, mientras el `service_role` sigue
pasando. Es exactamente lo que corresponde a tablas internas que ninguna
pantalla lee.

`scheduled_jobs` aparece acá desde la migración 00046, que revirtió una apertura
de la 00009. Si alguna vez hace falta exponerla, primero hay que agregarle
`workspace_id`: hoy no tiene con qué filtrar, y su payload lleva variables de
flow y texto de mensajes de los leads.

## 4. `pg_net` instalado en el schema `public`

**No se toca.** Moverla exige `DROP EXTENSION ... CASCADE`, que se lleva puesto
`net.http_get` y con él `private.call_app_cron` — o sea, **los seis crons a la
vez**, en silencio. El riesgo es enorme y el beneficio es un warning menos.

Además la advertencia genérica no aplica: el schema `net` no lo publica
PostgREST (la migración 00036 restringe la publicación a `public` y
`graphql_public`) y no está en el `search_path` por defecto.

## 5. Leaked password protection desactivada

**Es una decisión pendiente, no un bug.** Es un setting del panel de Auth de
Supabase, no SQL: no se puede versionar en una migración, así que un commit
daría la falsa sensación de que el repo lo cubre y un entorno nuevo se
levantaría sin ella.

Y cambia el flujo de registro: alguien con una contraseña que aparece en
HaveIBeenPwned deja de poder registrarse. Eso es una decisión de producto.

**Para activarla**: Supabase → Authentication → Policies → "Leaked password
protection". Va en el checklist de despliegue, no en el código.

---

## Checklist de despliegue (lo que no vive en el repo)

- [ ] `CRON_SECRET` en Railway **y** en `private.system_config` con el mismo valor
- [ ] El secreto del cron viaja solo por header `Authorization: Bearer`. Si hay
      algún monitor externo hecho a mano con `?key=` en la URL, reconfigurarlo
- [ ] Decidir sobre leaked password protection (punto 5)
- [ ] Después de cada migración que toque policies **o grants de funciones**:
      `node scripts/verify-rls.mjs`
