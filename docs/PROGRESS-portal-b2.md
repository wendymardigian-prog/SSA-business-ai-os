# PROGRESS — Portal de estudiantes, Corrida B2 (la conexión)

Plano: `~/Documents/portal/docs/requerimientos-v12-portal.md` §2 (migraciones P01–P16), §3 (arquitectura), §4 (seguridad), §5 (el contrato) y §6 (criterios). Rama del panel: `feat/portal-b2` (desde main con A3 mergeado, #238). Repo del portal: `~/Documents/portal` (`wendymardigian-prog/portal`).

**Para retomar:** esta página. Después de cada migración: ensayo en una transacción que se deshace sola, archivo para pegar en `claude/v12/`, Leonardo la aplica en el SQL Editor, verificación por el conector y commit.

## Decisiones (15/11/2026)
- **A3 mergeado** (#238) antes de empezar: requisito del plano (decisión 474).
- **Migraciones del §2 aprobadas** (Leonardo, 15/11: «ya están aprobadas»). Mismas condiciones que A3: ensayo previo, número confirmado con `list_migrations`, nada se borra.
- **El rol `portal_app_login` nace SIN contraseña.** Leonardo la genera y la carga él (SQL Editor + variables de Railway del portal). Nunca pasa por Claude ni queda en el repo.
- **El email del código para entrar lo manda SSA** (no la base ni el portal): el portal llama a un endpoint interno de SSA firmado con un secreto compartido (`PORTAL_SHARED_SECRET`, en las variables de Railway de los dos servicios). SSA genera el código con `portal_login_code_issue` (solo `service_role`) y lo manda con `sendTransactionalEmail` (marca, «Enviar desde», registro de emails, rebotes). El código nunca queda en claro en la base.
- **Funciones del contrato en `app_servicio_portal`** (el único esquema en el que `portal_app` tiene `USAGE`), `SECURITY DEFINER`, con `EXECUTE` solo para `portal_app` y `service_role`.
- **Contraseñas filtradas:** la revisión contra filtradas (k-anonimato) la hace el servidor del portal antes de llamar a `portal_set_password`; la base revisa largo y guarda `crypt(…, gen_salt('bf'))`.

## Migraciones (números desde 00384)
| Migración | Qué | Estado |
|---|---|---|
| 00384 | P01 rol `portal_app` + `portal_app_login` (sin contraseña) · P02 sesión: host → negocio, código (emisión solo servidor), verificar, contraseña, invitación (ver sin gastar / canjear), vista previa, salir, salir de todos · P16 días activos y `last_seen_at` por hora · topes | Ensayada en producción en una transacción que se deshizo sola: dirección → negocio (mayúsculas y puerto), código (6 dígitos, mal → `ok:false` y suma intento; reusar → PO401), sesión sin token en claro, contraseña (corta PO400, no permitida PO401, mala PO401, sin «Recordarme» 12 h), salir de todos (cierra 2, la otra da PO401), invitación (ver dos veces no la gasta, canjear dos veces PO410), vista previa (escribir PO403, pase usado PO410), suspendida PO402, sexto código en la hora rechazado, días activos (uno por día), renovación a 30 días, `last_seen_at`, tope de 60 por minuto (PO429); el rol no lee tablas ni funciones internas ni la emisión del código. **Aplicada y registrada** el 15/11/2026 UTC (versión `20261115175103`) por Leonardo. Después: `portal_app_login` puede entrar (sin contraseña todavía) y hereda de `portal_app`; `USAGE` solo en `app_servicio_portal`; no lee tablas; ejecuta las 9 funciones; la emisión del código es solo de `service_role` |
| 00385 | P03 `portal_context` (marca, programas, menú con estado por sección, términos, pausa, momento, puntos, avisos) y `portal_public_brand(host)` (Entrar sin sesión) | Ensayada en producción en una transacción que se deshizo sola: sin portal → 0 programas y `ended`; con portal: Contenido abierto, Reto con candado y motivo, Comunidad «Pronto» con fecha, Calendario oculto no viene, Asistente (apagado en el programa) y Mis referidos (no incluido) en `excluded`; pausa con fecha y momento `pausa`; otra dirección PO401; dirección desconocida sin nombres. **Aplicada y registrada** el 15/11/2026 UTC (versión `20261115175707`) por Leonardo. Después: el portal ejecuta `portal_context` y `portal_public_brand`, no las internas; `anon` no |
| 00386 | P04 `portal_home`, `portal_journey`, `portal_step_response`, `portal_profile_get/save`, `portal_certificate` + ayudante `program_for` (PO404 ajeno, PO451 términos, PO423 pausa) | Ensayada en producción en una transacción que se deshizo sola: sin portal PO404; camino con 4 fases y sus pasos visibles; Inicio con pendientes y cifras; perfil guarda nombre, zona, tema y «no aparecer»; zona inválida PO400; producto ajeno PO404; vista previa lee y no guarda (PO403); en pausa con corte el camino da PO423 y el Inicio se ve. **Aplicada y registrada** el 15/11/2026 UTC (versión `20261115180434`). Después: el portal ejecuta las 6 funciones nuevas (17 `portal_*` en total), no el ayudante `program_for` |
| 00387… | P05 a P09, P14, P15 | Pendiente |
| último | P12 `contract_version()` = 2 | Pendiente |

## Portal (repo `~/Documents/portal`)
- `lib/portal-api/`: cambiar los datos de ejemplo por la conexión Postgres (`portal_app_login`), función por función, sin tocar componentes.
- Login, cookie `__Host-portal`, middleware de dirección, `/api/salud`.

## SSA
- **Hecho:** `POST /api/portal/login-code` (firma HMAC con `PORTAL_SHARED_SECRET`, 5 minutos; `lib/portal-admin/portal-signature.ts` con test): emite el código con `app_servicio.portal_login_code_issue` y lo manda con `sendTransactionalEmail` y la plantilla `portalLoginCodeEmail` (código + link mágico `/entrar/codigo?e=&c=`). Respuesta siempre igual salvo el tope. La emisión del código pasó a `app_servicio` (la API no ve `app_servicio_portal`), antes de aplicar la 00384.
