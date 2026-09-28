# Agendamiento (Etapa 4)

Lo que hay, dónde está, y las decisiones que no se ven leyendo el código.

## De qué se trata

Un lead entra por un link, elige un horario que existe de verdad, y queda una
reunión en el Google Calendar de quien la va a tomar. Alrededor de eso: quién
puede recibir agendas, con qué horarios, qué pasa cuando cambian de fecha o
cancelan, y qué mensajes salen solos.

## Las piezas

| Qué | Dónde |
|---|---|
| Motor de horarios (puro) | `lib/scheduling/slots/` |
| Reglas puras del módulo | `lib/scheduling/*.ts`, cada una con su test |
| Lectura de la base | `lib/scheduling/data/` |
| Crear, cancelar, reagendar | `lib/scheduling/booking/` |
| Google Calendar | `lib/google-calendar/` |
| Páginas públicas | `app/calendario/` |
| API pública | `app/api/public/scheduling/` |
| Pantallas internas | `app/(dashboard)/dashboard/agenda/` |
| Automatizaciones | `lib/scheduling/automation/`, `lib/flow-engine/registry/booking-*.ts` |
| Habilidad del agente | `lib/agent/tools/scheduling/` |
| Embed | `lib/embed/`, `public/embed/embed.js` |

## Lo que hay que saber antes de tocar

**Los horarios salen de una sola función.** La página pública, el agendar a
mano y el agente llaman a `getPublicSlots`. Si alguno usara otra, podría
ofrecer un horario que los demás no muestran, y la reunión se caería al
confirmarla. El motor es puro: recibe el horario, el tiempo fuera, las agendas
del anfitrión, los conteos y el ocupado de Google, y devuelve huecos.

**El servidor nunca confía en el horario que manda el cliente.** Antes de
crear, `createBooking` vuelve a preguntar, con Google sin caché. Es la
diferencia entre "el botón decía que estaba libre" y "estaba libre".

**La doble reserva no la evita el código, la evita la base.** `bookings` tiene
una restricción de exclusión por anfitrión y rango. Dos pedidos simultáneos
terminan en una reunión y un 23P01, y eso está probado contra la base real con
diez llamadas a la vez (`scripts/verify-booking-concurrency.mjs`). Un `SELECT`
antes de un `INSERT` no alcanzaría.

**UTC en la base, hora local en las reglas.** Las agendas se guardan en UTC.
Las reglas de disponibilidad son hora de pared más zona IANA: "los martes de 9
a 17 en Costa Rica" sigue siendo de 9 a 17 cuando cambia el horario de verano,
y eso es lo que la persona quiso decir.

**Cancelar es definitivo.** No hay vuelta a activa. Para volver a verse se
agenda de nuevo. Eso hace que el historial se lea sin ambigüedad.

**La categoría queda congelada.** Cada reunión guarda el nombre del área y del
tipo que tenía al agendarse (`category_snapshot`). Si después renombran o
archivan la categoría, los informes viejos no cambian de significado. La única
forma de tocarlo es a mano, desde el detalle, y queda en el historial.

**Un metric que no vino queda en null**, igual que en la Etapa 2. Acá el
equivalente es el link de Meet: hasta que Google contesta, no está, y la
página lo dice en vez de mostrar un hueco.

## Zonas horarias

Tres zonas conviven:

- La del **anfitrión** (su perfil de agenda): define su disponibilidad.
- La del **invitado**: define cómo ve los horarios y qué dice el email.
- La del **negocio** (`workspaces.timezone`): el último recurso.

El booker toma la del navegador. El agente la deduce del teléfono
(`lib/agent/tools/scheduling/timezone.ts`); si solo le queda la del negocio,
pregunta antes de proponer: una hora en la zona equivocada es una reunión
perdida.

## Google Calendar

- La conexión es **por persona**, no por negocio: cada quien conecta su cuenta.
  Por eso `oauth_connections` tiene dos únicos parciales (uno por workspace
  para los proveedores de negocio, otro por persona y cuenta para Calendar).
- El token se renueva **a demanda**, no con el cron semanal de la Etapa 2.
- Un `invalid_grant` marca la conexión revocada y avisa **a la persona**, no a
  los admins: es su cuenta la que hay que reconectar.
- La invitación la manda Google (`sendUpdates=all`). Los emails de marca son
  flujos, apagados, que se prenden si se quieren.
- Un 403 por cuota es temporal y se reintenta; un 403 por permisos es
  permanente y no. Eso sale de la documentación, no del plano.

## Los reintentos de sincronización

Los agenda **el handler**, no la cola: 1, 5 y 15 minutos. La cola reintenta a
los 10 segundos y lo haría encima del reintento propio. Es la misma decisión
que tomó el despachador de contenido en la Etapa 2.

## Automatizaciones

Nueve tipos de trigger. Seis nacen de un evento (`booking_created`,
`booking_rescheduled`, `booking_cancelled`, `booking_updated`,
`booking_ended`, `booking_status_changed`) y tres son relativos a la hora de
la reunión (`booking_before_start`, `booking_after_end`,
`booking_after_created`).

Los relativos **se agendan**, no se evalúan: cuando una reunión nace o se
mueve, `syncRelativeJobs` anula los avisos viejos y planifica los nuevos. La
clave de idempotencia lleva el número de reagendas, así mover una reunión
vuelve a habilitar el recordatorio para la fecha nueva.

Sumar un trigger nuevo es declararlo en el registro con sus `eventTypes`: el
cron de `automation_events` enruta por el registro y no se toca.

Las variables `booking.*` viajan en `variables` de la sesión, que es lo único
que sobrevive a un Delay. Si un flujo espera dos horas y después manda el
email, las variables tienen que seguir ahí.

## Cómo agregar

**Un trigger de agenda:** declararlo en `lib/flow-engine/registry/booking-triggers.ts`
con sus `eventTypes`, y sumarlo al CHECK de `triggers` con una migración. El
cron y el editor lo toman solos.

**Una acción de flujo:** un archivo en `lib/flow-engine/nodes/`, su alta en
`registry/nodes.ts`, y su caso en el simulador y en el panel. Hay tests que
comparan las tres listas.

**Una herramienta del agente:** un archivo en `lib/agent/tools/scheduling/` y
su nombre en la lista de la habilidad. Con la habilidad apagada no se ofrece.

**Una red o un proveedor de calendario:** `lib/google-calendar/` está escrito
contra `fetch`, no contra un SDK. Otro proveedor sería otro archivo con la
misma interfaz.

## Los guardias

Lo que no se puede romper sin que algo avise:

- `scripts/verify-scheduling.mjs` — RLS, únicos, la RPC y la purga, contra la base.
- `scripts/verify-booking-concurrency.mjs` — diez pedidos a la vez, una reunión.
- `lib/scheduling/booking-status-parity.test.ts` — los once estados del código y los del CHECK.
- `lib/embed/build.test.ts` — el script compilado está commiteado y no creció.
- `lib/flow-engine/registry/consistency.test.ts` — el editor, el simulador y el registro dicen lo mismo.
- `lib/vault-boundary.test.ts` — ningún componente de navegador llega a Vault.
