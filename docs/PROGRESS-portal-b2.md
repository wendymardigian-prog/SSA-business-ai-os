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
| 00384 | P01 rol `portal_app` + `portal_app_login` (sin contraseña) · P02 sesión: host → negocio, código (emisión solo servidor), verificar, contraseña, invitación (ver sin gastar / canjear), vista previa, salir, salir de todos · P16 días activos y `last_seen_at` por hora · topes | Ensayada en producción en una transacción que se deshizo sola: dirección → negocio (mayúsculas y puerto), código (6 dígitos, mal → `ok:false` y suma intento; reusar → PO401), sesión sin token en claro, contraseña (corta PO400, no permitida PO401, mala PO401, sin «Recordarme» 12 h), salir de todos (cierra 2, la otra da PO401), invitación (ver dos veces no la gasta, canjear dos veces PO410), vista previa (escribir PO403, pase usado PO410), suspendida PO402, sexto código en la hora rechazado, días activos (uno por día), renovación a 30 días, `last_seen_at`, tope de 60 por minuto (PO429); el rol no lee tablas ni funciones internas ni la emisión del código. **Para aplicar** (`claude/v12/00384_para_pegar_en_supabase.sql`) |
| 00385 | P03 `portal_context` (marca, programas, menú con estado por sección, términos, pausa) | Pendiente |
| 00386… | P04 a P09, P14, P15 | Pendiente |
| último | P12 `contract_version()` = 2 | Pendiente |

## Portal (repo `~/Documents/portal`)
- `lib/portal-api/`: cambiar los datos de ejemplo por la conexión Postgres (`portal_app_login`), función por función, sin tocar componentes.
- Login, cookie `__Host-portal`, middleware de dirección, `/api/salud`.

## SSA
- Endpoint interno `POST /api/portal/login-code` (firma HMAC con `PORTAL_SHARED_SECRET`): emite el código y manda el email. Respuesta siempre igual.
