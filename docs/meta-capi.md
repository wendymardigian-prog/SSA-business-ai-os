# API de Conversiones de Meta (CAPI)

SSA le manda a Meta, **desde el servidor**, los eventos que valen: un lead, una reunión agendada, un pago cobrado. Van con
todos los datos de la persona juntos: email, teléfono con código de país, nombre, país, el id del contacto, la IP, el
navegador y las cookies de Meta (`fbp`/`fbc`).

El Pixel del navegador pierde eventos: bloqueadores de anuncios, Safari, un límite de lo que puede mandar. Desde el
servidor llegan igual. Si la web también mandó el evento por Pixel **con el mismo código** (`event_id`), Meta junta los dos
envíos, no cuenta doble y se queda con los datos de los dos.

Migración `00328_meta_capi`, **aplicada y registrada** el 8/11/2026 UTC (versión `20261108060946`). Código en `lib/meta/capi/`. Verificación contra la base: `node scripts/verify-meta-capi.mjs` (con el candado `/private/tmp/ssa-verify.lock`).

## Cómo se configura

1. **Ajustes → Integraciones → «Meta: API de Conversiones»**: el ID del Pixel y el token de acceso. El token se genera en
   Events Manager → el Pixel → Configuración → API de Conversiones → «Generar token de acceso», y no pide revisión de la
   app. «Probar y guardar» pide el Pixel con ese token antes de guardar: un token sin acceso a ese Pixel no se guarda.
   Cambiar el Pixel pide volver a escribir el token, así se vuelve a probar.
   - El **código de prueba** (opcional) sale de Events Manager → Probar eventos. Mientras esté cargado, los eventos solo se
     ven en esa pestaña: se borra al terminar de probar.
   - Es una tarjeta **aparte** de «Meta (anuncios e Instagram)»: otro token, que solo manda eventos a ese Pixel.
     Desconectar una no toca la otra.
2. **Leads y reuniones**: con el paso **«Enviar evento a Meta»**. En un formulario o en un evento de la Agenda, se suma en
   Automatizaciones como un paso más. También está en el lienzo, para cualquier disparador con contacto. Ahí se elige:
   - el evento: Lead, Schedule, CompleteRegistration, SubmitApplication, Contact o un nombre propio;
   - el valor, opcional y con variables (`{{answer.presupuesto}}`), y la moneda;
   - el nombre del contenido (por defecto, el del formulario o el de la reunión);
   - en una reunión, **«Solo reuniones que agendó el lead»**, prendido por defecto. Las que arma el equipo o el agente no
     vinieron de un anuncio.
3. **Compras**: el interruptor **«Mandar cada pago cobrado como compra»** de la tarjeta. Manda un evento por pago, con su
   monto en dólares. No se mandan los reembolsos ni los pagos cobrados antes de prenderlo. Purchase no se ofrece en el
   paso, así no hay dos caminos que cuenten la misma plata.

La tarjeta muestra los **últimos envíos**: qué se mandó, qué no y por qué.

## Lo que decide el sistema, no la persona

- **El código del evento** (`capiEventId`, `lib/meta/capi/build-event.ts`) es siempre el mismo para lo mismo:
  - un formulario usa el `meta_event_id` que mandó la web (el mismo que usó su Pixel); si no vino, `form.<respuesta>`;
  - una reunión, `booking.<id>`. Nunca el código público, que es una credencial. La página pública lo devuelve como
    `metaEventId` y el embed lo pasa en `agenda:bookingSuccessful`, para que la web dispare su Pixel con él;
  - un pago, `payment.<id>`;
  - cualquier otro disparador, `flow.<ejecución>.<paso>`.
- **La hora** es la de lo que pasó, nunca la de cuando corre el flujo. Meta rechaza un evento de más de 7 días, y con él el
  lote entero: se saltea con su motivo.
- **`action_source`**: `website` si hubo una persona en una web y están la URL y el navegador, que Meta exige para eso. Si
  no, `system_generated`. Un pago es siempre `system_generated`.

## Lo que no se puede romper

- **Un evento se manda una sola vez**: índice único `(workspace_id, event_name, event_id)` en `meta_capi_events`. Un
  reintento del paso, del job o del flujo choca con el índice y se anota como salteado.
- **Nada de esto tumba lo que lo origina.** El paso no manda en línea: anota y encola (`enqueueCapiEvent`), y el flujo
  sigue. El trigger de pagos va envuelto en `EXCEPTION WHEN OTHERS`. Guardar la IP y el navegador nunca lanza.
- **El job `meta_capi_send` no lanza por un fallo de Meta**: reagenda a 1, 5 y 15 minutos (límite de uso, 5xx, la red) y
  después queda `failed` con el motivo. Un error que no se arregla esperando (un dato inválido, un token vencido) falla
  de una.
- **Los datos de la persona se leen al mandar** (frescos, ya fusionados) y **nunca se guardan ni se loguean**:
  `meta_capi_events` no tiene `contact_id`, hashes ni IP. Sin `contact_id`, a propósito: `merge_contacts` no cambia.
- **El token viaja en el cuerpo del pedido, no en la URL** (`sendCapiEvents`), y el cuerpo nunca se loguea.
- **La IP y el navegador** (`meta_capi_request_context`) se guardan solo si el negocio configuró la API de Conversiones.
  Los lee y escribe solo `service_role`, y se borran a los 8 días (cron `meta-capi-cleanup`). El registro de envíos se
  borra a los 180.
- **Normalizar antes de hashear** (`lib/meta/capi/normalize.ts`): un dato que no pasa la normalización no se manda. Un
  hash de basura no coincide con nadie y baja la calidad del evento. Un nombre de relleno (un id o un @usuario) no es un
  nombre. Sin email, teléfono, cookies de Meta, ni IP más navegador, el evento no se manda (`no_match_data`): el
  `external_id` solo no alcanza.
- **La versión de la Graph API es propia** (`CAPI_GRAPH_VERSION`, `lib/meta/capi/send.ts`), no la de los insights
  (`lib/meta/graph.ts`).
- **Lo que se ve en el navegador** (`lib/meta/capi/events.ts`) no importa nada de servidor: el editor de pasos y la
  tarjeta lo usan. `normalize.ts` usa `node:crypto` y no puede llegar a un Client Component.

## Probar

1. Cargar el código de prueba en la tarjeta.
2. Armar el paso en un formulario y en un evento de la Agenda. Responder el formulario, agendar y marcar un pago como
   cobrado.
3. En Events Manager → Probar eventos tienen que aparecer los tres en uno o dos minutos, con su calidad de coincidencia
   (EMQ). Para un Lead de una web con Pixel, aparece como deduplicado.
4. Borrar el código de prueba.

## Pendiente

- La calidad de coincidencia depende de lo que haya en el contacto. Para un Lead de un formulario conviene pedir email y
  teléfono.
- Una cuenta de una categoría sensible (salud, finanzas) puede ver descartada parte de los datos. Se ve en Events
  Manager.
- `GRAPH_VERSION = "v21.0"` en `lib/meta/graph.ts` (los insights) es vieja. La API de Conversiones usa la suya (`v26.0`).
  La de los insights se revisa aparte.
