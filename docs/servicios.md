# Servicios

El módulo de Servicios (Corrida A1 de la v12) sigue lo que pasa con cada cliente **después** de la venta: el
servicio que compró, su camino (fases y pasos), su semáforo, sus accesos al portal y todo lo que el equipo hace
con él. Es un módulo que se **prende por negocio** (`workspaces.services_enabled`, nace apagado) y vive en sus
propios esquemas: `app_servicio` (lo que lee SSA, expuesto en la API con RLS de solo lectura) y
`app_servicio_portal` (lo del portal, cerrado: sin USAGE para `anon` ni `authenticated`).

Plano: `claude/v12/requerimientos-v12-servicios.md`. Avance: `docs/PROGRESS-servicios.md`. Decisiones y pendientes:
`docs/PENDIENTE-servicios.md`. El portal desde SSA: [portal-admin.md](portal-admin.md). Afiliados:
[afiliados.md](afiliados.md).

## Cómo prenderlo

Solo el servidor: `select app_servicio.set_module_enabled('<workspace>', true)` con `service_role`. No hay
pantalla. Con el módulo apagado nada cambia: los triggers del módulo salen al principio, el menú no muestra
Clientes ni Portal, y Productos, Ventas, las fichas y Automatizaciones se ven como siempre.

## La pantalla no decide

Todas las reglas viven en la base (funciones `app_servicio.*`, `SECURITY DEFINER`, `search_path = ''`) y cada
una tiene su gemela pura en TypeScript con un `*.cases.json` que corre contra las dos (vitest para TS, los
`verify-*` para SQL). La pantalla solo compone. Lo que se escribe pasa por una función del módulo que vuelve a
pedir la clave con la sesión; las tablas no tienen políticas de escritura.

## Cómo nace un servicio

- **Al cobrarse**: el trigger de `payments` (00334) llama a `svc_evaluate_auto_creation` según la configuración
  de la variante (Productos › variante › Servicio): crear, extender el que ya tiene o renovar. Un producto sin
  configurar vende igual (`verify-services --bloque sv1` lo compara con una venta de siempre).
- **A mano**: «+ Servicio» (en Clientes, la ficha del contacto o la de la venta), con la regla de la venta en rojo
  si se sale de ella (motivo obligatorio).
- **Importar**: `/dashboard/clientes/importar` (CSV).
- La única entrada es `app_servicio.svc_create_service`. Dos pagos a la vez crean uno solo.

## El camino

La plantilla vive en `product_variants.journey_template` (fases y pasos con su clave `ph_xxxxxx` / `it_xxxxxx`) y
se **copia** al servicio al crearlo (`service_phases`, `service_items`): cambiar la plantilla no toca los
servicios que ya existen. Un paso se completa a mano (tildar, con su permiso), solo (un formulario firmado, una
reunión, una tarea del equipo, una evaluación aprobada, una clase o un módulo vistos, un certificado emitido) o
por una automatización. El avance (`progress_pct`) y el paso de fase (`auto`, `auto_all`, `manual`) los calcula la
base. Lo automático **nunca tumba lo que lo origina**: cada trigger va en `EXCEPTION WHEN OTHERS` y deja
`svc.hook_failed` en el historial.

## El botón de cada paso (Servicios A2, F125)

Cada paso del camino puede mostrar en el portal un botón (drawer del paso › «Mostrar el botón en el portal»). Vive
dentro de `ref` (sin columnas): `ref.button = { label?, url? }` y `ref.show_response` (ausente = sí). Lo arma el portal;
el panel solo lo configura, lo valida (gemelas `refProblems` / `app_servicio.journey_item_ref_problems`, 00363, con
`journey-template.cases.json`) y lo muestra. El botón se ve solo mientras el paso está pendiente.

| Tipo de paso | A dónde lleva | Texto por defecto |
|---|---|---|
| `form` | El formulario, con su link firmado | «Completar el formulario» |
| `survey` | La encuesta, con su link firmado | «Responder la encuesta» |
| `contract` | El contrato, con su link firmado | «Firmar el contrato» |
| `activity` | La actividad, con su link firmado | «Entregar la actividad» |
| `quiz` | La evaluación, con su link firmado | «Hacer la evaluación» |
| `booking` (al agendar) | La agenda de ese tipo de reunión, con `svc_item` | «Agendar la llamada» |
| `booking` (cuando asistió) | Lo mismo mientras no agendó; con una reunión agendada, la reunión («Entrar a la llamada») | «Agendar la llamada» |
| `program_item` / `open_module` | La clase o el módulo en el portal | «Ver la clase» / «Ver el módulo» |
| `certificate` | El certificado | «Ver mi certificado» |
| `open_section` | La sección del portal | «Ir a la sección» |
| `team_task` / `student_task` / `checkbox` | El link pegado (pestaña nueva) | «Abrir» |

- **El texto**: hasta 40 caracteres, en una línea; vacío = el de por defecto (`defaultButtonLabel`).
- **El link pegado** solo en las tareas y la casilla (https://, sin espacios, hasta 2000) y ahí es obligatorio. Los
  pasos con formulario o agenda no aceptan uno: el link automático es el que hace que el paso se complete solo.
- **Para mostrar el botón, el cliente tiene que ver el paso**: apagar «Lo ve el cliente» apaga el botón.
- **«El cliente puede ver su respuesta»** (formulario, encuesta, actividad, evaluación y contrato; en el contrato, el
  firmado y su PDF). Lo usa el portal.
- **`svc_item`**: la agenda pública (y el embed) lee `?svc_item=` y lo guarda en `bookings.utm.svc_item` solo si es un
  uuid (`pickUtm`); `booking_hook` completa ESE paso (si es del mismo contacto), no el primero del mismo tipo de
  reunión. `create_booking` no cambió.

## El semáforo

`svc_compute_light` (gemela `lib/services/light.ts`, ≥ 28 casos): verde, amarillo o rojo según los pasos
vencidos, la fase que se demora y la mora. Lo recalcula cada cambio y el barrido diario.

## Los accesos

Cada servicio da accesos a las secciones del portal según la variante (programa, calendario, Reto, certificado,
asistente IA, comunidad, afiliados). El motor y sus reglas están en [portal-admin.md](portal-admin.md).

## El barrido diario (F88)

`private.enqueue_svc_daily()` (cron `svc-daily`, `23 * * * *`, por SQL directo: no pasa por `call_app_cron`)
encola un job `svc_daily` por negocio con el módulo prendido, desde las 02:00 de su zona, una vez por día. El job
corre `app_servicio.svc_daily_run(negocio)`, cada paso en su bloque: repeticiones y Retos de fecha fija, pasos
vencidos (`service_item_overdue`), semáforo, accesos que se abren y mora, renovados que llegan a su fin (pasan a
`renewed`), accesos por vencer y vencidos, «faltó» a una clase en vivo, «reanudar sola», servicios que empiezan
(`service_started`), «está por terminar» (N días, los N de los disparadores activos) y la purga de la comunidad.
Si un paso falla, el job lanza al final. Dos veces el mismo día no duplica nada.

## Certificados

Un certificado es una generación del **Diseñador IA** desde una plantilla de tipo Certificado, con el servicio
como sujeto (`subjectRef = {module: "service", type: "service", id}`). El módulo registra en el Diseñador el
grupo de variables «Servicio» (`service.product`, `service.variant`, `service.start_on`, `service.end_on`,
`service.completed_on`, `service.owner`) y se suscribe a `onDesignGenerated` (`lib/services/certificate-extension.ts`,
cargado por `lib/designer/module-extensions.ts`): al quedar lista una generación de certificado, completa el paso
Certificado pendiente y emite `certificate_issued`, venga de donde venga. Uno vigente por servicio. «Emitirlo solo»
lo encola la base al abrirse la fase (`svc_certificate_issue`).

## Automatizaciones

26 disparadores de contacto (`lib/flow-engine/registry/service-triggers.ts`) y 6 acciones
(`lib/flow-engine/nodes/service-actions.ts`: completar un paso, cambiar de fase, empezar el Reto, extender,
pausar, emitir certificado). Ver [flow-registry.md](flow-registry.md).

## Fusión de contactos

`public.merge_contacts` llama al final, en la misma transacción, a `app_servicio.merge_contacts_hook` si existe
(00353): mueve servicios, cuenta y accesos del portal, avance (queda la fecha más vieja), asistencia (una por
fecha), clics, comunidad y las conversaciones con el tutor. Dos cuentas del portal: queda la del principal y la
otra se suspende con sus sesiones revocadas. Dos servicios activos del mismo producto: quedan los dos y se avisa.

## Scripts de verificación

```
node scripts/verify-servicios-migracion.mjs --todas   # cada migración S01-S16: objetos, RLS, permisos, CHECK y triggers
node scripts/verify-services.mjs                      # sv1, sv2, prd, ac
node scripts/verify-program.mjs                       # pr, ev, ca, ce (vite-node, render simulado), co, ia, x
node scripts/verify-affiliates.mjs
node scripts/verify-portal-schema.mjs                 # el esquema del portal cerrado
node scripts/verify-auth-settings.mjs                 # el registro público (panel de Supabase)
```

Mismas reglas que los demás: crean y limpian sus datos (`zz-test-`), de a uno y con el candado
`/private/tmp/ssa-verify.lock`.
