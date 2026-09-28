# Alcance v5: Etapa 4, Agendamiento

**Proyecto:** SSA Business AI OS
**Paso del Método Builder:** 04-Alcance (modo revisión, Etapa 4)
**Fecha:** 26 de septiembre de 2026 (revisión 5.1 el mismo día, después de revisar el prototipo: decisiones #82 a #89)
**Versión:** 5.0. **Este documento complementa a `alcance-v4`:** v5 = v4 + lo que está acá. Reemplaza la fila "Etapa 4" del mapa de etapas y la "decisión pendiente para la Etapa 4" de la sección 7 de v4. Todo lo demás de v4 (Etapa 2) y de `alcance-etapa1-v3` sigue vigente sin cambios.

**Base técnica:** Fork de ZernFlow (MIT) extendido en las Etapas 1 y 2 (Next.js 16, React 19, Tailwind 4, Zod 4, Supabase, Vercel AI SDK v6). El agendamiento se construye **dentro** del sistema **portando piezas de [Cal.diy](https://github.com/calcom/cal.diy) (MIT)**, con atribución.
**Hosting:** Railway + Supabase Pro (sin cambios). **Multi-tenancy:** No (sin cambios).
**Investigación de respaldo:** `claude/investigacion-agendamiento.md`.

---

## Qué se revisó y por qué

La Etapa 4 no tenía detalle ("por definir"). Wendy pidió definir el sistema de agendamiento completo, tipo Calendly o Cal.com. Se hizo lo siguiente:
- Se reconcilió con lo ya construido: contactos con deduplicación, cola de automatizaciones, crons, registro de triggers y zona horaria del workspace.
- Se reconcilió con lo que deja la Etapa 2: OAuth de Google, Vault, roles personalizados y vistas kanban/calendario.
- Se investigó de nuevo. El hallazgo clave: **Cal.com cerró su código y liberó Cal.diy con licencia MIT**, así que ahora se puede portar código.
- Se validaron 5 decisiones con Wendy.

### Changelog v5 (respecto de v4)

1. **Etapa 4 renombrada:** ~~Agendamiento + Ventas + Pipeline (opcional, por definir)~~ → **Etapa 4: Agendamiento**, con dos fases definidas (**Calendarios, disponibilidad y eventos** y **Reservas, embed, automatizaciones y agentes**) y una tercera fase futura (**Eventos de equipo**). **Ventas y pagos** y **Pipeline comercial** pasan a ser la **Etapa 5** (sin cambios de contenido, siguen "por definir").
2. **Decisión pendiente resuelta:** ~~Google Calendar propio o Cal.com~~ → **módulo propio portando piezas de Cal.diy (MIT)**, con Google Calendar como calendario de cada usuario.
3. **Cada usuario conecta sus propias cuentas de Google** (una o varias) y elige en qué calendarios se revisan conflictos y en cuál se crean los eventos.
4. **MVP de eventos 1 a 1, con el modelo de datos listo para equipos.** Round robin y collective quedan para la fase futura.
5. **La confirmación la manda Google** (invitación con Meet). Los emails de marca y los recordatorios van por **flujos precreados** (apagados) en el motor de automatizaciones.
6. **URLs públicas:** `dominio/calendario/{usuario}/{evento}`.
7. **El agendamiento registra sus permisos** en el catálogo de roles personalizados de la Etapa 2.
8. **Orden sugerido:** la Etapa 4 depende solo de la Etapa 2, así que **se puede construir antes que la Etapa 3** (agente integral). Esto es conveniente porque el agente va a usar las herramientas de agenda.
9. **Categorías de agenda (pedido de Wendy, 26/09):** cada evento, y por lo tanto cada agenda, se clasifica en dos niveles: **área** (Ventas, Servicio, y otras que se creen) y **tipo** dentro del área (Ventas: Triaje, Cierre, Seguimiento; Servicio: Onboarding, Uno a uno; se pueden agregar más). La clasificación se usa en filtros, flujos y reportes futuros.
10. **Habilidad "Agendamiento" para los agentes (pedido de Wendy, 26/09):** ~~las herramientas de agenda del agente entran en la Etapa 3~~ → **entran en esta etapa (Fase 2, Bloque 4)**. Es una habilidad que se enciende o apaga por agente, con la lista de eventos que puede usar y **cuándo usar cada uno**. El agente consulta horarios libres (disponibilidad del evento + Google Calendar del anfitrión), propone horarios, agenda, reagenda y cancela.
11. **Respuestas de Wendy (26/09, segunda ronda):**
    - **Estados de agenda propios:** Agendada, Confirmada, Reagenda, No-show, Seguimiento tibio, Seguimiento frío, Venta, No califica, Cancelada – no califica, Cancelada – no contesta y Cancelada – otro. El kanban es por estado.
    - **Asignación del contacto según el área:** Ventas asigna al anfitrión como vendedor; Servicio no asigna.
    - **Cualquiera puede agendar** cualquier evento, también los de Servicio.
    - **No hay límite para cancelar o reagendar.**
    - **Los avisos al anfitrión los arma cada persona con flujos** (la acción "Enviar email" puede ir al anfitrión).
    - **Los flujos de agenda se envían aunque el contacto tenga "no contactar".**
    - **Permisos por área:** más adelante.
12. Se agregan las decisiones #49 a #81.

---

## 0b. Arquitectura y costos (lo que suma la Etapa 4)

| Servicio | Plataforma | Comunicación | Costo | Etapa |
|---|---|---|---|---|
| Google Calendar API + Meet | API directa (mismo cliente OAuth de la Etapa 2) | OAuth 2.0 por usuario | $0 | **4** |
| Páginas públicas de reserva y embed | La misma app en Railway | HTTPS | $0 extra | **4** |
| Emails de recordatorio (flujos) | Resend | API | Comparte cuota (100/día gratis; $20/mes Pro) | **4** |

**Costo fijo adicional: $0/mes.** Solo Resend Pro si el volumen de recordatorios y la bandeja superan 100 emails por día.

**Tope de Google:** con la app "sin verificar" hay un máximo de 100 usuarios. Cada persona que conecta una cuenta de Google cuenta, sumando YouTube de la Etapa 2. Si el sistema se vende a otros negocios, hay que **verificar la app en Google**. Es un trámite gratuito de algunos días, porque los permisos de Calendar son "sensibles" y no "restringidos".

**Storage:** la Etapa 4 no agrega archivos. Los avatares de perfil de agenda usan el bucket existente.

---

## 1. Mapa de la Etapa 4

| Etapa | Fase | Bloques | Duración (medio tiempo) | Qué se entrega |
|---|---|---|---|---|
| **Etapa 4: Agendamiento** | **Fase 1: Calendarios, disponibilidad y eventos** | 4 bloques | ~1,5 semanas | Conexión de Google Calendar por usuario, disponibilidades con excepciones y tiempo fuera, tipos de evento completos, página pública de reserva que crea la agenda, el contacto y el evento con Meet, y cancelar/reagendar por el invitado |
| | **Fase 2: Reservas, embed, automatizaciones y agentes** | 4 bloques | ~2 semanas | Vista de agendas en lista, kanban y calendario con acciones; embed en tu web; triggers, condiciones y acciones en el motor de flujos; flujos precreados por evento; habilidad de agendamiento para los agentes |
| | **Testing final** | — | 2-3 días | Testing integral de la etapa (zonas horarias, doble reserva, permisos, embed en un sitio real) |
| | Fase 3 (futura): Eventos de equipo | Por definir | ~1 semana | Round robin (pesos, prioridad), collective, reasignación. Se activa cuando haya equipo de ventas |
| **Etapa 5: Ventas y Pipeline** (ex Etapa 4 Fases 2-3) | Por definir | Por definir | Por definir | Sin cambios respecto de v4 |

**Prerrequisitos de la Etapa 2:**
- Cliente OAuth de Google (Fase 1, Bloque 2).
- Vault para todos los secretos (Fase 1, Bloque 1).
- Roles personalizados (Fase 3, Bloque 2).
- Componentes de kanban y calendario del pipeline de contenido (Fase 1, Bloque 3).

**Trámite externo el día 1:** en el proyecto de Google Cloud, habilitar la **Google Calendar API** y agregar los permisos de Calendar a la pantalla de consentimiento.

### Etapa 4 > Fase 1: Calendarios, disponibilidad y eventos

| Bloque | Qué se construye | Contexto compartido |
|---|---|---|
| Bloque 1 | Perfil de agenda (usuario, zona horaria, formato de hora) + conexión de cuentas de Google Calendar por usuario + lista de calendarios + calendarios de conflicto y calendario destino por defecto + permisos del módulo | `scheduling_profiles`, `oauth_connections` (de la Etapa 2), `calendars`, Vault, catálogo de permisos |
| Bloque 2 | Disponibilidades: varios horarios, uno por defecto, rangos por día, zona horaria + excepciones por fecha + tiempo fuera + asignación de eventos a cada horario | `availability_schedules` (reglas y excepciones como jsonb), `out_of_office` |
| Bloque 3 | Categorías de agenda + tipos de evento: lista, crear, editar y duplicar; configuración completa (detalles, categoría, ubicación, disponibilidad, calendarios, formulario de reserva, límites y buffers) | `booking_categories`, `event_types` (con el formulario en `booking_fields` y los calendarios de conflicto como lista) |
| Bloque 4 | Motor de horarios libres + página pública de reserva + creación de la agenda (contacto, evento en Google con Meet, invitación) + confirmación + cancelar y reagendar por el invitado + protección contra doble reserva | `bookings` (con la referencia de Google), `audit_log` como historial, `rate_limits`, Google API |
| Testing | Testing de fase (1 día) + colchón | |

### Etapa 4 > Fase 2: Reservas, embed, automatizaciones y agentes

| Bloque | Qué se construye | Contexto compartido |
|---|---|---|
| Bloque 1 | Pantalla de agendas (lista, kanban, calendario) + detalle + acciones del anfitrión (cambiar estado, cancelar, reagendar, editar) + agendar manualmente para un contacto + sección "Agendas" en la ficha del contacto + notificaciones | `bookings`, contactos, notificaciones |
| Bloque 2 | Embed (inline, popup y botón flotante) + tema claro/oscuro/auto + color + generador de código + precarga + UTM + eventos hacia la web + redirección al terminar | Booker, código de embed |
| Bloque 3 | Automatizaciones: triggers por evento y relativos al tiempo, condiciones, acciones (incluida "enviar email"), variables de agenda + sección "Flujos" en cada evento + flujos precreados apagados | Flow registry, `automation_events`, `scheduled_jobs` |
| Bloque 4 | Habilidad "Agendamiento" para agentes: configuración por agente (eventos permitidos y cuándo usar cada uno), herramientas de consultar horarios, agendar, reagendar, cancelar y ver agendas del contacto, reglas y límites | Tool registry del agente, `agents.tools_config`, motor de horarios, creación de agendas |
| Testing final | Testing integral de la etapa (2-3 días) | |

---

## 2. Funcionalidades por bloque

### Etapa 4 > Fase 1 > Bloque 1: Perfil y calendarios conectados

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Perfil de agenda | Cada persona define su **usuario** (va en los links de sus eventos), nombre visible, foto, **zona horaria** (por defecto la del workspace) y formato de hora (12 o 24 h). Vive en **Agenda > ⚙ > Ajustes** | Must-have | Construir nuevo |
| Conectar cuenta de Google Calendar | Botón "Conectar Google Calendar" en **Agenda > ⚙ > Calendarios de Google**. Usa el cliente OAuth del workspace (Etapa 2) y pide solo los permisos de Calendar. El refresh token se guarda en Vault, a nombre de esa persona | Must-have | Construir nuevo (base: `CalendarService` de Cal.diy) |
| Varias cuentas por persona | Una persona puede conectar más de una cuenta de Google (por ejemplo, personal y de trabajo) | Must-have | Construir nuevo |
| Lista de calendarios | Al conectar, se listan todos los calendarios de la cuenta, sin los de sistema (feriados, cumpleaños). Se marca cuáles son de solo lectura | Must-have | Portar de Cal.diy |
| Calendarios para revisar conflictos | Por cada calendario, un switch "Revisar conflictos". Por defecto queda encendido el calendario principal de cada cuenta | Must-have | Portar de Cal.diy |
| Calendario destino por defecto | Se elige en qué calendario se crean las agendas (solo calendarios con permiso de escritura). Cada evento puede cambiarlo | Must-have | Portar de Cal.diy |
| Estado de la conexión | Conectado / Requiere atención (token revocado o permiso faltante) / Error, con "Reconectar" y "Desconectar" | Must-have | Construir nuevo |
| Permisos del módulo | Se registran en el catálogo de roles (ver 4.4) | Must-have | Extender de la Etapa 2 |
| Configurar la agenda de otra persona | Quien tiene `scheduling.manage_others` puede entrar a la agenda de otra persona para editar sus horarios y eventos. **Nunca** puede conectar ni desconectar las cuentas de Google de otra persona | Nice-to-have | Construir nuevo |

### Etapa 4 > Fase 1 > Bloque 2: Disponibilidades

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Varios horarios | Cada persona crea los horarios que quiera (ej: "Horario normal", "Solo tardes", "Llamadas de venta"), cada uno con nombre y **zona horaria propia** | Must-have | Portar de Cal.diy |
| Horario por defecto | Siempre hay **exactamente uno** marcado por defecto. El primero que se crea lo es. Se cambia con "Marcar por defecto" | Must-have | Portar de Cal.diy |
| Horas por día | Por cada día de la semana: activo o no, y **uno o varios rangos** (ej: 9:00–12:00 y 14:00–18:00). Botón "Copiar a todos los días" | Must-have | Portar de Cal.diy |
| Excepciones (por horario) | En el editor del horario, vista "Excepciones". Modal "Nueva excepción": elegir uno o varios días en un calendario → "No disponible todo el día" u "Horario distinto" con rangos → resumen → guardar. Aplica **solo a ese horario** | Must-have | Portar de Cal.diy |
| Tiempo fuera (para todos los horarios) | Tarjeta propia en Disponibilidad, fuera de los horarios, y botón "+ Tiempo fuera" en la barra. Modal: desde y hasta, días completos o con hora, motivo (Vacaciones, Viaje, Enfermedad, Otro) y nota. Bloquea **todos** los horarios y eventos de la persona. No cancela las agendas existentes: antes de guardar avisa cuántas hay en ese rango y las lista con "Reagendar" | Must-have | Portar de Cal.diy (sin reenvío a compañero) |
| Eventos que usan este horario | En cada horario, una sección con los eventos de la persona y un switch por evento para asignarlo. Es la misma información que en la configuración del evento, vista desde el otro lado | Must-have | Construir nuevo |
| Vista previa | Calendario de las próximas 2 semanas con los horarios libres resultantes (sin contar Google) | Nice-to-have | Construir nuevo |
| Feriados por país | Bloquear los feriados de un país elegido | Nice-to-have | Referencia Cal.com |

### Etapa 4 > Fase 1 > Bloque 3: Tipos de evento

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Categorías de agenda | Pantalla **Agenda > Categorías** con dos niveles: **áreas** (vienen creadas Ventas y Servicio) y **tipos** dentro de cada área (vienen creados Triaje, Cierre y Seguimiento en Ventas; Onboarding y Uno a uno en Servicio). Se pueden crear, renombrar, reordenar, ponerles color y archivar. Solo quien tiene `scheduling.manage_categories` | Must-have | Construir nuevo |
| Categoría del evento | Cada evento elige área (obligatoria) y tipo (opcional). La lista de eventos se agrupa y filtra por área y tipo | Must-have | Construir nuevo |
| Categoría de la agenda | Cada agenda copia la categoría de su evento al crearse (queda fija aunque después se cambie la del evento). Se puede corregir a mano desde el detalle de la agenda | Must-have | Construir nuevo |
| Lista de eventos | Tarjetas con título, duración, ubicación, categoría, estado (activo, oculto, inactivo), botón "Copiar link", "Vista previa", "Duplicar", "Embed" (Fase 2) y menú. Filtros por persona (para quien ve a otros), área y tipo | Must-have | Portar UI de Cal.diy |
| Detalles | Título, descripción (texto con formato básico), **slug** (la URL queda `dominio/calendario/{usuario}/{slug}`), duración (lista + personalizada), color | Must-have | Portar de Cal.diy |
| Ubicación | **Google Meet** (se crea el link al agendar) o **Ubicación manual** (texto libre: dirección presencial o instrucción tipo "te enviaremos el link"). Opción "mostrar la ubicación solo después de agendar" | Must-have | Portar de Cal.diy |
| Disponibilidad del evento | Selector del horario (por defecto: el horario por defecto de la persona) | Must-have | Portar de Cal.diy |
| Calendario destino del evento | "Usar el de mi perfil" o un calendario puntual de los conectados | Must-have | Portar de Cal.diy |
| Calendarios de conflicto del evento | "Usar los de mi perfil" o elegir calendarios puntuales para este evento. Las agendas del propio sistema siempre bloquean | Must-have | Portar de Cal.diy |
| Formulario de reserva | Ver "Formulario de reserva" más abajo | Must-have | Portar de Cal.diy (form builder) |
| Límites y buffers | Buffer antes y después, aviso mínimo, intervalo entre horarios, máximo de agendas por día y por semana, ventana futura (N días corridos o hábiles, o rango de fechas) | Must-have | Portar de Cal.diy |
| Asignación del contacto | "Al agendar, asignar al anfitrión como: No asignar / Setter si está vacío / Vendedor si está vacío". **El valor por defecto depende del área: Ventas → Vendedor si está vacío; Servicio y otras → No asignar.** Se puede cambiar en cada evento | Must-have | Construir nuevo |
| Estados del evento | Activo (visible en la página de la persona), Oculto (solo con link directo) o Inactivo (el link muestra "no disponible") | Must-have | Portar de Cal.diy |
| Página después de agendar | Página de confirmación del sistema (por defecto) o redirección a una URL propia, pasando los datos de la agenda | Nice-to-have | Portar de Cal.diy |
| Varias duraciones | El invitado elige 15, 30 o 60 minutos en el mismo evento | Nice-to-have (no entra en los requerimientos de esta etapa) | Portar de Cal.diy |
| Máximo de agendas activas por invitado | Ej: una agenda próxima por email | Nice-to-have (no entra en los requerimientos de esta etapa) | Referencia Cal.com |

**Formulario de reserva** (constructor de formulario):

| Campo | Comportamiento |
|---|---|
| **Nombre** | Siempre visible y obligatorio. No se puede apagar |
| **Email** | Por defecto visible y obligatorio. Se puede poner opcional u ocultar |
| **Teléfono** | Por defecto visible y opcional. Se puede poner obligatorio u ocultar. Con selector de país |
| Preguntas propias | Tipos: **texto corto, texto largo, selección y selección múltiple**. Cada una tiene etiqueta, texto de ayuda, obligatoria sí o no, opciones (para las de selección) e identificador para variables. Se reordenan arrastrando |
| Guardar respuesta en el contacto | Opcional por pregunta: copiar la respuesta a un campo personalizado del contacto (Nice-to-have) |

Regla: **email o teléfono tiene que quedar visible y obligatorio** (hace falta para vincular el contacto). Si el email está apagado, el invitado no recibe invitación de Google.

### Etapa 4 > Fase 1 > Bloque 4: Página de reserva y creación de agendas

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Motor de horarios libres | Calcula los horarios disponibles: horario del evento, menos excepciones y tiempo fuera, menos ocupado en los calendarios de conflicto (Google freebusy), menos agendas del sistema (con buffers), aplicando aviso mínimo, intervalo, ventana futura y topes | Must-have | **Portar de Cal.diy** |
| Página pública de reserva (booker) | **Réplica de Cal.com:** a la izquierda, anfitrión, título, duración, ubicación y selector de zona horaria; en el centro, calendario del mes con los días disponibles marcados; a la derecha, los horarios del día elegido, con selector 12/24 h. Después, el formulario y el botón "Confirmar". Responsive (en el celular, en pasos). Tema claro, oscuro o automático | Must-have | **Portar de Cal.diy** |
| Zona horaria del invitado | Se detecta del navegador y se puede cambiar. Todos los horarios se muestran en esa zona | Must-have | Portar de Cal.diy |
| Crear la agenda | Al confirmar: vuelve a validar el horario, busca o crea el contacto, crea la agenda, crea el evento en el calendario destino con Meet (si aplica) e invita al contacto (Google manda la invitación), aplica la asignación del contacto y dispara los eventos de automatización | Must-have | Construir nuevo |
| Siempre vinculada a un contacto | Toda agenda tiene contacto. Si no existe (por email o teléfono), se crea con los datos del formulario. Si existe, se vincula y solo se completan los campos vacíos | Must-have | Extender de `find_or_link_contact` |
| Protección contra doble reserva | Si dos personas eligen el mismo horario al mismo tiempo, solo una lo consigue. La otra ve "Ese horario se acaba de ocupar" y los horarios actualizados | Must-have | Construir nuevo |
| Página de confirmación | Resumen (fecha y hora en la zona del invitado, anfitrión, ubicación o link de Meet), "Agregar a mi calendario" (Google, Outlook, .ics) y links de **Reagendar** y **Cancelar** | Must-have | Portar de Cal.diy |
| Cancelar (invitado) | Link único `/calendario/agenda/{código}`: muestra la agenda, pide motivo (opcional) y cancela. Se borra el evento de Google (Google avisa al invitado) | Must-have | Portar de Cal.diy |
| Reagendar (invitado) | Link único: abre el booker del mismo evento, elige otro horario y la **misma agenda** cambia de fecha. Se mueve el evento de Google y queda en el historial | Must-have | Portar de Cal.diy |
| Origen y atribución | Cada agenda guarda origen (página pública, embed, manual, agente), UTM, página de referencia y quién la creó. Si el contacto no tenía atribución, se completa | Must-have | Construir nuevo |
| Antispam | Tope de intentos por IP y un campo trampa invisible | Must-have | Construir nuevo |
| ~~Política de cambios~~ | ~~No se puede cancelar ni reagendar con menos de X horas~~ → **Sin límites** (decisión de Wendy): el invitado puede cancelar o reagendar hasta la hora de inicio | — | — |

### Etapa 4 > Fase 2 > Bloque 1: Pantalla de agendas

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Vista lista | **Sin pestañas.** Filtros rápidos en pastillas **Próximas · Sin resultado · Con resultado · Canceladas**. Columnas: fecha y hora, contacto, evento, categoría, anfitrión, estado, origen. El estado se cambia desde la fila. Filtros: **estado, área y tipo**, evento, anfitrión, rango de fechas, búsqueda por contacto. Los filtros aplican también al kanban y al calendario | Must-have | Referencia Cal.com + tabla del fork |
| Vista kanban | **Una columna por estado** (los 11 de la regla de estados), con scroll horizontal y columnas que se pueden contraer (las 3 de cancelación, contraídas por defecto). Arrastrar cambia el estado; soltar en una cancelación pide confirmación y avisa al invitado. Badge "Sin resultado" en las agendas activas cuya hora ya pasó | Must-have | Extender del kanban de la Etapa 2 (ScaleOS) |
| Vista calendario | Mes, semana y día, con las agendas coloreadas por evento. Clic abre el detalle | Must-have | Extender del calendario de la Etapa 2 (ScaleOS) |
| Detalle de la agenda | Panel lateral: contacto (link a la ficha), fecha en tu zona y en la del invitado, evento, anfitrión, ubicación o Meet, respuestas del formulario, origen y UTM, historial (creada, reagendada, cancelada, marcada), estado de sincronización con Google | Must-have | Construir nuevo |
| Acciones del anfitrión | **Cambiar estado**, marcar Confirmada, cancelar (eligiendo el estado de cancelación, avisa al invitado vía Google), reagendar (elige nuevo horario, respeta disponibilidad con opción de forzar), editar ubicación o notas internas (se actualiza el evento en Google), copiar link de reagendar | Must-have | Construir nuevo |
| Agendar manualmente | Desde la ficha del contacto o la pantalla de agendas: "Agendar" abre el booker interno con el contacto precargado. Permite ignorar el aviso mínimo | Must-have | Construir nuevo |
| Agendas en la ficha del contacto | Sección con próximas y pasadas, estado y botón "Agendar" | Must-have | Extender del fork |
| Notificaciones | Aviso en la campana al anfitrión cuando se agenda, reagenda o cancela | Must-have | Extender del fork (`notifications`) |
| Exportar CSV | Exportar la lista filtrada | Nice-to-have (no entra en los requerimientos de esta etapa) | Construir nuevo |

### Etapa 4 > Fase 2 > Bloque 2: Embed

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Tres modos | **Inline** (dentro de la página), **popup** al hacer clic en un botón o link, **botón flotante** | Must-have | **Portar de Cal.diy** (`embed-core`, `embed-snippet`, MIT) |
| Tema | Claro, oscuro o automático (según el sistema del visitante) | Must-have | Portar de Cal.diy |
| Color de marca | Color principal por embed | Must-have | Portar de Cal.diy |
| Ocultar detalles del evento | Mostrar solo el calendario | Must-have | Portar de Cal.diy |
| Generador de código | Modal "Embed" en cada evento: elegir modo, tema, color y diseño, con vista previa en vivo y botón "Copiar código" (HTML o React) | Must-have | Portar de Cal.diy |
| Precarga y UTM | Pasar nombre, email y respuestas por la URL o el código. Los parámetros UTM de la página padre se reenvían solos | Must-have | Portar de Cal.diy |
| Eventos hacia tu web | La web recibe "agenda creada", "reagendada" y "cancelada" (para píxeles de Meta o Google Analytics) | Must-have | Portar de Cal.diy |
| Diseño semana o columna | Además del mes | Nice-to-have | Portar de Cal.diy |
| Dominio propio | Servir las páginas públicas en `agenda.tudominio.com` | Nice-to-have | Construir nuevo |

### Etapa 4 > Fase 2 > Bloque 3: Automatizaciones

**Triggers nuevos en el flow builder** (se registran en el flow registry, con filtro por **área, tipo**, evento, anfitrión y origen):

| Trigger | Cuándo dispara |
|---|---|
| Agenda creada | Al confirmarse una agenda nueva |
| Agenda reagendada | Al cambiar la fecha (invitado o anfitrión) |
| Agenda cancelada | Al cancelarse (filtros: por el invitado, el equipo o el sistema; estado de cancelación) |
| Agenda actualizada | Cambió la ubicación o las notas internas |
| La fecha de la agenda pasó | Al terminar la agenda (hora de fin), si no está cancelada |
| Cambió el estado de la agenda | Al pasar a un estado (filtros "a estado" y "desde estado", con atajos "cualquier resultado" y "cualquier cancelación") |
| **X tiempo antes de la agenda** | X minutos, horas o días antes del inicio (ej: 24 h, 1 h, 10 min) |
| **X tiempo después de la agenda** | X minutos, horas o días después del fin |
| **X tiempo después de agendar** | X minutos, horas o días después de que se creó la agenda |

**Condiciones nuevas** (todas se pueden acotar a un área, un tipo o un evento): ¿tiene una agenda próxima? · estado de la última agenda · resultado de la última agenda · cantidad de no-shows del contacto.

**Acciones nuevas:** **Enviar email** (vía Resend, con asunto y cuerpo con variables; sirve para cualquier flujo, no solo agendas) · Cancelar agenda · Cambiar estado de la agenda. "Enviar email" puede ir al contacto, **al anfitrión** o a un email fijo: así cada persona arma sus propios avisos de "te agendaron" o "cancelaron". Para WhatsApp se usa la acción existente de enviar mensaje por el canal WhatsApp.

**Variables de agenda en los mensajes:**
- Evento, **área y tipo**, fecha y hora en la zona del invitado, fecha y hora en la zona del anfitrión, zona del invitado, duración.
- Ubicación, link de Meet, anfitrión.
- Link de reagendar, link de cancelar.
- Respuestas del formulario (por identificador).
- Link de agenda de cualquier evento, para usar en cualquier flujo.

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Triggers, condiciones, acciones y variables | Todo lo de las tablas de arriba, registrado en el flow registry sin tocar el motor | Must-have | Extender del flow registry |
| Sección "Flujos" en el evento | Lista los flujos cuyo trigger aplica a este evento (los de "todos los eventos" y los filtrados a este), con su estado y un switch para encender o apagar. Botón "Nuevo flujo" abre el flow builder con el trigger ya puesto y filtrado a este evento | Must-have | Construir nuevo |
| Flujos precreados | Al crear un evento, el sistema crea **apagados** estos flujos filtrados a ese evento: (1) Confirmación con tu marca (email al agendar); (2) Recordatorio 24 h antes (email); (3) Recordatorio 1 h antes (email + WhatsApp si hay teléfono y canal); (4) Aviso de reagendamiento (email); (5) Aviso de cancelación con link para volver a agendar (email); (6) Seguimiento de no-show con link de reagendar, al pasar a No-show (email); (7) Agradecimiento 2 h después de cargar cualquier resultado (email). Se pueden encender, editar o borrar. Una opción del workspace desactiva la creación automática | Must-have | Construir nuevo (idea de Calendly) |

### Etapa 4 > Fase 2 > Bloque 4: Habilidad "Agendamiento" para agentes

**Cómo funciona, en simple:** el agente nunca "mira" el Google Calendar de nadie. Cuando necesita horarios, le pide al sistema "horarios libres del evento X entre tal y tal fecha". El sistema usa **el mismo motor que la página pública**: disponibilidad del evento + Google Calendar del anfitrión (con los tokens de esa persona) + agendas del sistema + límites. Le devuelve al agente solo una lista de horarios libres. Así el agente propone exactamente los mismos horarios que vería el lead en el link, y no accede a ningún dato privado del calendario.

| Funcionalidad | Descripción | Prioridad | Origen |
|---|---|---|---|
| Habilidad que se enciende o apaga | En **Agentes > [agente] > Herramientas** aparece "Agendamiento" con su switch. Sirve para cualquier agente del registro (hoy el de chat; mañana los de la Etapa 3) | Must-have | Extender del tool registry (Etapa 1) |
| Eventos permitidos y cuándo usar cada uno | Lista de eventos que el agente puede ofrecer (de cualquier anfitrión). Cada uno lleva un texto **"Cuándo usarlo"** (ej: "Leads nuevos que preguntan por el programa y todavía no tuvieron llamada → Llamada de triaje") y, opcional, **requisitos previos** (ej: "Solo si el lead contó su facturación"). El agente recibe esta lista con las categorías en sus instrucciones | Must-have | Construir nuevo |
| Qué puede hacer | Switches: **agendar**, **reagendar**, **cancelar** (por defecto: agendar y reagendar sí, cancelar no). Siempre puede consultar horarios y ver las agendas del contacto | Must-have | Construir nuevo |
| Modo | **"Agenda directamente"** (por defecto) o **"Solo comparte el link"** (el agente elige el evento y manda el link con los datos precargados, sin agendar él) | Must-have | Construir nuevo |
| Consultar horarios | Herramienta que devuelve horarios libres de un evento en un rango, en la zona horaria del contacto. El agente propone **hasta 3 opciones** (configurable de 2 a 5) de días distintos cuando se puede | Must-have | Construir nuevo (usa el motor del Bloque 4 de la Fase 1) |
| Agendar | Herramienta que crea la agenda para el **contacto de la conversación** (siempre vinculada), con origen "agente". Antes pide los datos obligatorios del formulario que falten (ej: email) y **exige la confirmación explícita del lead** de un horario concreto | Must-have | Construir nuevo (usa la creación de agendas) |
| Reagendar y cancelar | Solo sobre agendas futuras **de ese contacto**, con la confirmación del lead | Must-have | Construir nuevo |
| Ver agendas del contacto | Próximas y pasadas del contacto, para no ofrecer una llamada de triaje a quien ya tiene una | Must-have | Construir nuevo |
| Zona horaria del lead | Usa la zona guardada en el contacto; si no hay, la infiere del país o del prefijo del teléfono y **la confirma con el lead** antes de proponer horarios ("¿Estás en hora de México?"). La que confirma queda guardada en el contacto | Must-have | Construir nuevo |
| Si no hay horarios o falla Google | Ofrece el link del evento o deriva a humano, según la configuración. Nunca inventa horarios | Must-have | Construir nuevo |
| Modo borrador | En los canales donde el agente deja borradores para aprobar, agendar, reagendar y cancelar se desactivan: el agente solo propone horarios o comparte el link, y la persona que aprueba agenda | Must-have | Construir nuevo |
| Trazabilidad | Cada consulta y cada agenda quedan como pasos del run del agente y en el `audit_log`. La agenda muestra "Creada por: [agente]" | Must-have | Extender del fork |

---

## 3. Flujos principales

### 3.1 Primera configuración (Wendy)
1. Entra a **Agenda** y toca el ⚙. El sistema le pide elegir su usuario (el que va en los links) (ej: `wendy`) y confirma su zona horaria.
2. En **Calendarios**, toca "Conectar Google Calendar" y acepta los permisos de Calendar. Ve la lista de calendarios de esa cuenta.
3. Deja encendido "Revisar conflictos" en el principal y en "Personal". Elige "Trabajo" como calendario destino por defecto.
4. En **Disponibilidad** ya existe "Horario normal" (lunes a viernes, 9 a 17, marcado por defecto). Crea "Solo tardes" (14 a 18) y, con **+ Tiempo fuera**, carga sus vacaciones del 20 al 31 de diciembre.
5. En **Eventos**, toca "+ Nuevo evento" y crea "Llamada de descubrimiento" (título, área, 30 minutos, Google Meet): queda inactivo y se abre el editor con el chequeo "Listo para activar". Configura el horario "Solo tardes", buffer de 10 minutos después, aviso mínimo de 12 horas, y agrega la pregunta "¿Cuál es tu facturación mensual?" (selección). Ve en la sección **Flujos** los 7 flujos precreados apagados y enciende "Recordatorio 24 h antes". Toca "Activar evento".
6. Copia el link `dominio/calendario/wendy/llamada-descubrimiento`, o el código de embed para su web.

### 3.2 Un lead agenda
1. El lead abre el link o el embed en la web. Ve el calendario del mes en **su** zona horaria (detectada).
2. Elige un día y un horario. Completa nombre, email, teléfono y la pregunta. Confirma.
3. El sistema vuelve a chequear que el horario siga libre (Google + agendas del sistema).
4. Busca el contacto por email o teléfono: no existe, lo crea con los datos y la atribución (UTM).
5. Crea la agenda, crea el evento en el calendario "Trabajo" de Wendy con Meet e invita al lead. Google le manda la invitación.
6. Como el contacto no tenía vendedor, asigna a Wendy como vendedor.
7. El lead ve la confirmación con "Agregar a mi calendario", "Reagendar" y "Cancelar".
8. Wendy recibe la notificación en la campana. Se dispara el trigger "Agenda creada" y se programa "Recordatorio 24 h antes".

**Casos raros:**
- **Ya existe el contacto:** se vincula sin duplicar y solo se completan los campos vacíos.
- **Horario tomado en el medio:** mensaje "Ese horario se acaba de ocupar" y se refrescan los horarios.
- **Falla Google al crear el evento:** la agenda se guarda igual, se reintenta 3 veces, queda marcada "Sin sincronizar con Google" y Wendy recibe un aviso con "Reintentar".
- **La conexión de Google de Wendy está caída:** la página muestra "Este evento no está disponible por el momento" (no se arriesga una doble reserva) y Wendy recibe un aviso.
- **El contacto tiene "no contactar":** se agenda igual (fue él quien pidió), y la agenda y la ficha muestran la marca.
- **El recordatorio de 24 h ya quedó en el pasado** (agendó con 3 horas de anticipación): ese recordatorio no se manda.

### 3.3 El invitado reagenda o cancela
1. Desde la invitación o el email, toca "Reagendar": ve el booker del mismo evento, elige otro horario y confirma.
2. La misma agenda cambia de fecha y pasa a **Reagenda**, se mueve el evento en Google (Google avisa), queda en el historial y se dispara "Agenda reagendada". Los recordatorios pendientes se reprograman.
3. Si toca "Cancelar", elige un motivo (opcional) y confirma. Se borra el evento de Google, la agenda queda "Cancelada – otro" con su motivo, se dispara "Agenda cancelada" y se anulan los recordatorios pendientes.

**Casos raros:** agenda ya cancelada → el link lo informa. Agenda cuya hora de inicio ya pasó → no se puede reagendar ni cancelar desde el link. No hay otro límite.

### 3.4 Después de la llamada
1. Al terminar, la agenda muestra el badge **"Sin resultado"** y se dispara "La fecha de la agenda pasó".
2. Wendy la arrastra en el kanban a su resultado: Seguimiento tibio, Seguimiento frío, Venta, No califica, o No-show.
3. "No-show" dispara el flujo de seguimiento de no-show (si está encendido) con el link para reagendar. Cualquier cambio de estado puede disparar flujos (ej: Seguimiento tibio → secuencia de nutrición).

### 3.5 Agendar manualmente para un contacto
1. En la ficha del contacto, "Agendar" → elige evento y horario (puede ignorar el aviso mínimo) → confirma.
2. Mismo proceso que 3.2, con origen "manual" y "creada por" la persona del equipo.

### 3.6 Excepciones y vacaciones
1. En **Agenda > ⚙ > Disponibilidad**, con **+ Tiempo fuera**, Wendy carga del 20 al 31 de diciembre, motivo "Vacaciones".
2. El sistema avisa: "Tenés 2 agendas en ese rango" y las lista con acceso directo. No las cancela.
3. Desde ese momento no aparecen horarios en esas fechas en ningún evento.

### 3.7 El agente de chat agenda una llamada
1. Un lead escribe por Instagram: "Me interesa el programa, ¿cómo sigo?". El agente tiene la habilidad Agendamiento encendida con "Llamada de triaje" (Ventas · Triaje), con el texto "Leads nuevos interesados en el programa".
2. El agente revisa las agendas del contacto: no tiene ninguna. El contacto no tiene zona horaria, pero su teléfono es +52: pregunta "¿Estás en hora de Ciudad de México?". El lead confirma.
3. El agente consulta horarios de "Llamada de triaje" para los próximos 7 días en `America/Mexico_City` y propone 3: "martes 14:00, miércoles 10:30 o jueves 17:00 (tu hora)".
4. El lead elige el miércoles. El evento pide email: el agente lo pide. El lead lo da.
5. El agente agenda. El sistema vuelve a validar el horario, crea la agenda (Ventas · Triaje, origen "agente"), el evento en el Google Calendar de Wendy con Meet y la invitación, y dispara los flujos.
6. El agente confirma en el chat con fecha, hora y "te llegó la invitación a tu email".

**Casos raros:**
- **El horario se ocupó entre la propuesta y la confirmación:** el agente avisa y propone otros.
- **El lead ya tiene una llamada de triaje próxima:** el agente se la recuerda y ofrece reagendar, no una nueva.
- **Ningún evento permitido encaja con lo que pide el lead:** deriva a humano.
- **El canal está en modo borrador:** el agente deja como borrador un mensaje con los horarios o el link, y agendar queda en manos de quien aprueba.

---

## 4. Decisiones y reglas de negocio

### 4.1 Decisiones nuevas

| # | Decisión | Opción elegida | Razonamiento |
|---|---|---|---|
| 49 | ¿Cal.com, Cal.diy o todo propio? | **Módulo propio portando piezas de Cal.diy (MIT)** | Cal.diy es MIT desde abril de 2026. El agendamiento queda cosido al CRM sin sincronizar otra base |
| 50 | ¿Eventos de equipo ya? | **No: MVP 1 a 1**, con anfitriones por evento en el modelo de datos | Hoy trabajás sola; round robin se agrega sin rehacer nada |
| 51 | ¿Quién confirma al invitado? | **Invitación de Google** + flujos de marca opcionales | Gratis, confiable, con Meet y botones de sí/no; no consume Resend |
| 52 | URLs públicas | `dominio/calendario/{usuario}/{evento}` | Varios usuarios sin choques de nombres |
| 53 | ¿Cómo se conecta Google Calendar? | **Cada persona conecta sus propias cuentas** (una o varias), con el cliente OAuth del workspace | Cada uno maneja su calendario; el admin no ve credenciales ajenas |
| 54 | ¿Dónde se revisan conflictos? | Calendarios elegidos a nivel persona, con posibilidad de cambiarlos por evento | Lo pediste; es el modelo de Cal.com |
| 55 | ¿Dónde se crean los eventos? | Calendario destino por persona, con posibilidad de cambiarlo por evento | Lo pediste |
| 56 | ¿Excepciones y vacaciones? | Excepciones por fecha **por horario** (vista "Excepciones" del horario) + tiempo fuera **por persona**, que aplica a todos sus horarios (tarjeta "Tiempo fuera" en Disponibilidad) | Igual que Cal.com; cubre "este martes atiendo de 10 a 12" y "me voy de vacaciones" |
| 57 | ¿Reagendar crea una agenda nueva? | **No: la misma agenda cambia de fecha**, con historial | Una sola ficha por reunión en kanban, contacto y reportes |
| 58 | Estados de la agenda | ~~Agendada, Asistió, No asistió, Cancelada~~ → **11 estados definidos por Wendy en 4 grupos:** activos (Agendada, Confirmada, Reagenda), No-show, resultados (Seguimiento tibio, Seguimiento frío, Venta, No califica) y cancelaciones (Cancelada – no califica, Cancelada – no contesta, Cancelada – otro). "Sin resultado" = activa cuya hora ya pasó (se calcula, no es un estado) | Reflejan el proceso comercial real y alimentan el kanban y los flujos |
| 59 | ¿Confirmación manual del anfitrión? | No como bloqueo: la agenda nace Agendada y ocupa el horario. **"Confirmada"** es un estado que se pone a mano (o por flujo o agente) cuando el lead confirma que asiste | Sirve para seguimiento sin frenar la reserva |
| 60 | ¿Toda agenda tiene contacto? | **Sí, obligatorio.** Si no existe, se crea | Regla del negocio pedida por Wendy |
| 61 | ¿Se asigna el contacto al agendar? | Configurable por evento; **por defecto según el área: Ventas → vendedor si está vacío; Servicio y otras → no asignar** | Una llamada de servicio no convierte a quien la da en vendedor |
| 62 | ¿Qué pasa si Google no responde al crear el evento? | Se guarda la agenda, 3 reintentos, marca "sin sincronizar" y aviso | No se pierde la agenda del lead |
| 63 | ¿Y si la conexión de Google de la persona está caída? | **Su página de reserva deja de ofrecer horarios** hasta que reconecte | Evita dobles reservas |
| 64 | ¿Sincronizar cambios hechos en Google? | No en esta etapa (queda para la fase futura, con notificaciones push) | Complejidad; los cambios se hacen desde el sistema |
| 65 | Flujos precreados | 7 flujos apagados por evento, desactivables a nivel workspace | Lo pediste; nada sale sin que lo enciendas |
| 66 | ¿Acción "enviar email" en el flow builder? | **Sí, genérica** (sirve para cualquier flujo) | Hoy el motor solo envía mensajes por canal de conversación |
| 67 | Permisos | Se registran 6 permisos en el catálogo de la Etapa 2 (ver 4.4) | Roles personalizados ya decididos |
| 68 | Zonas horarias | Ver 4.3 | |
| 69 | ¿Orden respecto de la Etapa 3? | **Se puede construir antes que la Etapa 3** | Solo depende de la Etapa 2; el agente de la Etapa 3 va a usar sus herramientas |
| 70 | Atribución de Cal.diy | Archivo `THIRD_PARTY_NOTICES.md` con la licencia MIT de Cal.com, Inc.; no se usa la marca | Única obligación de la licencia |
| 71 | ¿Cómo se clasifican eventos y agendas? | **Dos niveles configurables: área (Ventas, Servicio, …) y tipo dentro del área** (Triaje, Cierre, Seguimiento, Onboarding, Uno a uno, …). El evento tiene la categoría y la agenda la copia al crearse | El sistema va a servir para ventas y servicio. Dos niveles alcanzan para filtrar y reportar sin volverse un árbol difícil |
| 72 | ¿La agenda copia la categoría o la lee del evento? | **La copia**, con corrección manual posible | Si se reclasifica un evento, las agendas pasadas no deberían cambiar solas (los reportes quedarían inconsistentes) |
| 73 | ¿Herramientas del agente en esta etapa o en la 3? | **En esta etapa**, como habilidad del tool registry que ya existe | El agente de chat ya existe y el registro está listo; lo pediste |
| 74 | ¿El agente ve el Google Calendar? | **No.** El sistema calcula los horarios libres con el mismo motor de la página pública y le pasa solo la lista | Privacidad y una sola fuente de verdad: el agente y el link ofrecen exactamente lo mismo |
| 75 | ¿Cómo sabe el agente qué evento usar? | Lista de eventos permitidos, cada uno con **"Cuándo usarlo"** y requisitos previos, más su categoría | Instrucción explícita y editable, en vez de que el agente adivine |
| 76 | ¿Quién puede agendar eventos de Servicio? | **Cualquiera con el link** (igual que Ventas) | Decisión de Wendy |
| 77 | ¿Límite para cancelar o reagendar? | **No hay**: hasta la hora de inicio | Decisión de Wendy |
| 78 | ¿Aviso al anfitrión por email o WhatsApp? | **No automático.** Cada persona lo arma con flujos ("Enviar email" al anfitrión). La campana del sistema sigue avisando | Decisión de Wendy: flexible y configurable |
| 79 | ¿Permisos por área (ej: "ver todas las de Servicio")? | **Más adelante.** El modelo ya guarda la categoría en cada agenda, así que se suma sin migrar datos | Decisión de Wendy |
| 80 | Cancelación por el invitado desde el link | Queda **Cancelada – otro** con el motivo que escribió | El invitado no elige categorías internas |
| 81 | ¿Se puede corregir un resultado? | Sí, sin límite de tiempo, entre No-show y resultados, y volver a Confirmada si el horario sigue libre. Una cancelación es final | Errores de carga frecuentes; cancelar libera el horario |
| 82 | ¿Pestañas en la pantalla de Agendas? | **No.** Agenda abre directo las agendas (Lista, Kanban o Calendario) con filtros rápidos en pastillas. Eventos, Disponibilidad, Calendarios de Google, Categorías y Ajustes pasan a **Configuración de agenda**, detrás de un botón ⚙ en la barra superior, al lado de "+ Agendar" | Decisión de Wendy al revisar el prototipo: la pantalla del día a día queda limpia y la configuración, junta |
| 83 | ¿Página pública del usuario con todos sus eventos? | **No se construye.** Cada evento se comparte por su propio link (`/calendario/usuario/evento`) o embed | Decisión de Wendy: no hace falta. Se quita la funcionalidad nice-to-have |
| 84 | ¿Cómo se crea un evento? | Modal corto (título, link, área y tipo, duración, ubicación) que crea el evento **Inactivo** con lo que la persona ya tiene configurado (horario por defecto, calendarios, formulario base, 7 flujos apagados) y abre el editor con una tarjeta **"Listo para activar"** (chequeo + "Activar evento") | Crear en 30 segundos sin publicar algo a medio configurar |
| 85 | ¿Cómo se agenda a mano? | Modal "Agendar una llamada" en 5 pasos con indicador: evento → contacto (o crear uno) → horario libre → formulario (opcional) → confirmar con "qué va a pasar" | Mismo camino que el booker, sin sorpresas |
| 86 | ¿Excepciones y tiempo fuera, dónde? | Excepción: dentro del horario, modal multi-día, **solo ese horario**. Tiempo fuera: tarjeta propia en Disponibilidad y botón en la barra, **todos los horarios y eventos**; avisa las agendas del período antes de guardar | Que se note a qué aplica cada uno |
| 87 | ¿Cómo se arman los flujos de email o mensaje de un evento? | **Editor lineal** Cuándo / Si / Entonces (+ pasos) con vista previa del mensaje, resumen en una frase y "Enviarme una prueba". Se guarda como un flow normal y se puede abrir en el canvas; si tiene ramas, se edita solo en el canvas | Los flujos de agenda son casi siempre lineales; el canvas queda para lo complejo |
| 88 | ¿Cuántas tablas nuevas? | **8** (no 14): reglas y excepciones de horario como jsonb del horario, calendarios de conflicto como lista en el evento, anfitriones de evento recién en la Fase 3, referencia de Google dentro de la agenda, historial en `audit_log`, `rate_limits` genérica | Decisión de Wendy: menos tablas que mantener, mismo criterio que la Etapa 2 (listas chicas como jsonb) |
| 89 | ¿Qué ve el invitado si no puede agendar? | Cada evento configura **tres mensajes**: sin horarios, no disponible (Google caído o error) y no carga (página o embed). Cada uno con título, texto y un botón opcional a WhatsApp, email o link. En el embed, el mensaje de "no carga" viaja dentro del código, para que aparezca aunque el servidor esté caído | Pedido de Wendy: el lead nunca queda en una pantalla vacía o con un error técnico, siempre tiene una salida |

### 4.2 Reglas de negocio

**Disponibilidad:**
- Cada persona tiene siempre exactamente un horario por defecto. No se puede borrar el horario por defecto.
- Borrar un horario que usan eventos obliga a elegir a qué horario pasan (por defecto, el horario por defecto).
- Los rangos de un mismo día no pueden superponerse. El fin tiene que ser posterior al inicio.
- Las excepciones son de un horario. El tiempo fuera es de la persona y bloquea todos sus horarios.
- Cargar tiempo fuera sobre agendas existentes avisa y las lista, pero no las cancela.

**Eventos:**
- El slug es único por persona: solo letras minúsculas, números y guiones.
- Cambiar el slug o el usuario rompe los links viejos. El sistema lo advierte antes de guardar.
- Cambiar la duración o el horario de un evento no modifica las agendas ya creadas.
- Un evento con agendas futuras no se borra: se desactiva. Borrar pide confirmación y deja las agendas intactas.
- Solo se puede elegir como destino un calendario con permiso de escritura.
- Formulario: nombre siempre obligatorio. Email o teléfono visible y obligatorio. Sin email, no hay invitación de Google al invitado.

**Horarios libres:**
- Se ofrecen solo horarios que cumplen: dentro del horario del evento, fuera de excepciones y del tiempo fuera, libres en todos los calendarios de conflicto, sin choque con agendas del sistema (contando los buffers de las dos), después del aviso mínimo, dentro de la ventana futura y sin superar los topes por día o semana.
- Al confirmar, el servidor vuelve a validar todo. El cliente nunca decide si un horario es válido.
- Una persona no puede tener dos agendas activas que se superpongan (garantizado en la base de datos, no solo en la interfaz).
- Las agendas canceladas liberan el horario.

**Agendas:**
- Toda agenda tiene contacto, evento y anfitrión.
- Reagendar mantiene la agenda y guarda el historial (fecha anterior, fecha nueva, quién lo hizo).
- Una agenda cuya hora ya pasó no se puede cancelar ni reagendar por el invitado. No hay otro límite de tiempo.
- Estados: solo las agendas activas (Agendada, Confirmada, Reagenda) ocupan el horario. Reagendar pasa la agenda a Reagenda. Cancelar desde el link deja Cancelada – otro.
- No-show y los resultados (Seguimiento tibio o frío, Venta, No califica) solo se cargan después de la hora de inicio. Se pueden corregir entre sí sin límite de tiempo. Una cancelación es final.
- Cancelar o reagendar desde el sistema actualiza Google con aviso al invitado.
- Todo cambio de agenda queda en `audit_log`.

**Categorías:**
- Todo evento tiene área; el tipo es opcional.
- Un área o tipo en uso no se borra: se archiva (deja de ofrecerse para eventos nuevos y sigue visible en lo existente).
- Cambiar la categoría de un evento afecta solo a las agendas futuras que se creen después.
- Las áreas Ventas y Servicio vienen precargadas y se pueden renombrar, pero no borrar.

**Agente:**
- El agente solo agenda para el contacto de la conversación, nunca para otro.
- Solo ofrece eventos de su lista permitida y solo horarios devueltos por el sistema en ese momento.
- Nunca agenda sin una confirmación explícita del lead de un horario concreto.
- Antes de agendar, pide los datos obligatorios del formulario que falten. No inventa emails.
- No agenda si el contacto ya tiene una agenda próxima del mismo evento: ofrece reagendar.
- Todas las reglas de la agenda aplican igual (aviso mínimo, ventana, topes, doble reserva).

**Automatizaciones:**
- Los triggers relativos se programan al crear la agenda, se reprograman al reagendar y se anulan al cancelar.
- Si el momento calculado ya pasó cuando se crea la agenda, ese trigger no dispara.
- Cada trigger dispara una sola vez por agenda y por motivo (idempotencia con `dedupe_key`).
- Los flujos precreados nacen apagados.
- Los flujos de agenda se ejecutan aunque el contacto tenga "no contactar", porque son mensajes sobre una reunión que el propio contacto pidió. El flujo puede agregar la condición si se prefiere lo contrario.

### 4.3 Zonas horarias

| Dónde | Regla |
|---|---|
| **Base de datos** | Todo momento concreto (inicio y fin de agenda, creación, cancelación, tiempo fuera con hora) se guarda en **UTC** (`timestamptz`). Las reglas de disponibilidad y las excepciones se guardan en **hora local** (ej: "09:00") + la **zona horaria del horario** (formato IANA, ej: `America/Costa_Rica`). Así el cambio de horario de verano no corre los horarios |
| **Zona de cada persona** | Nuevo campo en su perfil de agenda. Por defecto, la del workspace (`workspaces.timezone`). Es la zona que usa la interfaz interna para esa persona |
| **Zona del invitado** | Se detecta de su navegador en el booker, se puede cambiar y se guarda en la agenda. Si el contacto no tenía zona, se guarda también en el contacto (campo nuevo) |
| **Página de reserva** | Los horarios se calculan en la zona del horario y se muestran en la zona del invitado. Selector de zona y de 12/24 h |
| **Interfaz interna** | Todas las fechas (lista, kanban, calendario, detalle, ficha) se muestran en la **zona del perfil de quien mira**. La zona se ve siempre en el encabezado. En el detalle de una agenda se ve además la hora del invitado ("14:00 tu hora · 15:00 hora del invitado, CDMX") |
| **Filtros** | "Hoy", "Esta semana" y los rangos de fecha se calculan en la zona de quien mira |
| **Reglas y flujos** | "X tiempo antes o después" se calcula sobre el instante en UTC, así que no depende de zonas. Las variables de fecha en los mensajes al invitado se escriben en su zona; hay variables aparte con la hora del anfitrión |
| **Google Calendar** | El evento se crea con inicio y fin en UTC más la zona del anfitrión, para que se vea bien en Google |
| **Resto del sistema** | La regla de la Etapa 1 ("UTC en la base, el frontend convierte") se mantiene. Lo nuevo: la interfaz usa la zona del perfil de agenda cuando existe, en lugar de la del navegador |

### 4.4 Permisos (se suman al catálogo de la Etapa 2)

| Permiso | Qué habilita | Owner | Admin | Member |
|---|---|---|---|---|
| `scheduling.use` | Tener su propia agenda: conectar su Google Calendar, sus disponibilidades y excepciones, sus eventos | ✓ | ✓ | ✓ |
| `bookings.view` (alcance mío/todo) | Ver agendas: "mío" = donde es anfitrión; "todo" = las de todos | todo | todo | mío |
| `bookings.manage` (alcance mío/todo) | Cancelar, reagendar, marcar, editar y agendar manualmente | todo | todo | mío |
| `scheduling.manage_others` | Editar horarios y eventos de otras personas (nunca sus cuentas de Google) | ✓ | ✓ | — |
| `scheduling.team_events` | Crear eventos de equipo (fase futura) | ✓ | ✓ | — |
| `scheduling.manage_categories` | Crear, editar y archivar áreas y tipos | ✓ | ✓ | — |
| Habilidad del agente | Usa el permiso existente `agents.edit` | ✓ | ✓ | según su rol |
| Flujos de un evento | Usa los permisos existentes `flows.view` y `flows.edit` | ✓ | ✓ | ver |

Ejemplo del rol que pediste, "solo su propia agenda": `scheduling.use` + `bookings.view` y `bookings.manage` con alcance "mío", sin `scheduling.manage_others`. Ve y gestiona solo lo suyo y no configura nada de otros. Los contactos que agenda quedan a su nombre como vendedor (regla #61), así que también los ve en el CRM según el scope de leads.

---

## 5. Pantallas de la Etapa 4

| Pantalla | Qué ve el usuario | Acciones | Desde / hacia |
|---|---|---|---|
| Agenda > Agendas | Lista, kanban o calendario de agendas, **sin pestañas** | Filtrar, cambiar vista, abrir detalle, arrastrar estado, agendar (modal de 5 pasos), ⚙ configuración | Menú principal / detalle / configuración |
| Detalle de agenda (panel) | Contacto, horario, evento, respuestas, historial, Meet | Cancelar, reagendar, marcar, editar, copiar links | Agendas, ficha del contacto |
| Configuración de agenda (⚙) | Navegación lateral: Eventos · Disponibilidad · Calendarios de Google · Categorías · Ajustes | Según la sección | Botón ⚙ de Agendas / vuelve a Agendas |
| ⚙ > Eventos | Tarjetas de eventos por área (propios, o de otros con permiso) | Nuevo evento (modal), copiar link, vista previa, duplicar, activar | Configuración / editor de evento |
| Editor de evento | Tarjeta "Listo para activar" + secciones: Detalles · Disponibilidad y calendarios · Formulario · Límites y buffers · Si no se puede agendar · Flujos · Compartir y embed (modo, tema, color, vista previa en vivo, código) | Guardar, vista previa, activar, copiar código | ⚙ > Eventos |
| Editor de flujo del evento | Cuándo / Si / Entonces + pasos, vista previa del mensaje y resumen | Guardar, encender, enviarme una prueba, abrir en el canvas | Sección Flujos del evento |
| ⚙ > Disponibilidad | Tarjetas de horarios → editor del elegido (**Horario semanal · Excepciones**) → tarjeta **Tiempo fuera** (para todos los horarios) | Crear, marcar por defecto, editar, borrar, agregar excepción (modal), agregar tiempo fuera (modal) | Configuración |
| ⚙ > Calendarios de Google | Cuentas de Google conectadas, sus calendarios con switch de conflictos, calendario destino | Conectar, reconectar, desconectar, elegir | Configuración |
| ⚙ > Ajustes | Usuario (va en los links), nombre, foto, zona horaria, formato de hora, opciones del workspace | Guardar | Configuración |
| ⚙ > Categorías | Áreas y sus tipos, con color y cantidad de eventos | Crear, renombrar, reordenar, archivar | Configuración |
| Agentes > [agente] > Herramientas (se extiende) | Habilidad "Agendamiento": switch, modo, acciones permitidas, eventos con "Cuándo usarlo" | Configurar | Pantalla de agentes existente |
| Ficha del contacto (sección Agendas) | Próximas y pasadas | Agendar, abrir detalle | CRM |
| **Pública:** booker | Calendario, horarios, formulario | Elegir, confirmar | Link / embed |
| **Pública:** confirmación | Resumen, agregar a calendario, reagendar, cancelar | | Booker |
| **Pública:** gestionar agenda | Cancelar con motivo / reagendar | | Links de la invitación o de los emails |
| Flow builder (se extiende) | Triggers, condiciones y acciones de agenda | | Sección Flujos del evento |

---

## 6. Fuera de alcance de la Etapa 4

- Round robin, collective, managed events y reasignación entre anfitriones (Fase 3 futura).
- Confirmación manual del anfitrión (agendas "pendientes").
- Sincronizar cambios hechos directamente en Google Calendar (notificaciones push).
- Microsoft Outlook, CalDAV, Zoom y Teams (solo Google Calendar + Meet).
- Cobros al agendar (Stripe o Mercado Pago).
- Eventos recurrentes, cupos por horario (seats) y encuestas de fecha.
- Routing forms (formularios que derivan a distintos eventos según las respuestas).
- SMS.
- Lógica condicional dentro del formulario de reserva.
- Feriados por país (nice-to-have si sobra tiempo).
- Grabaciones y transcripciones de Meet (lo cubre Fathom en la Etapa 3).
- ~~Herramientas del agente IA para agendar (Etapa 3)~~ → **entran en esta etapa** (Fase 2, Bloque 4).
- Reportes y dashboards por categoría de agenda (tasa de asistencia, agendas por área). Los datos quedan listos; el dashboard se define con la Etapa 5 (pipeline comercial).

---

## 7. Consideraciones para crecimiento futuro

- **Equipos:** el evento tiene una lista de anfitriones (hoy, uno solo) y un tipo (`individual`, más adelante `round_robin` o `collective`), para que la Fase 3 sume el reparto sin migrar datos.
- **Agente IA:** las herramientas de agenda ya se registran en esta etapa. El agente integral de la Etapa 3 las activa como una habilidad más, sin reescribir nada.
- **Categorías:** base para los reportes de ventas y servicio (Etapa 5) y para reglas futuras, como "los eventos de Servicio solo para clientes con venta activa".
- **Ventas (Etapa 5):** la agenda guarda contacto y anfitrión. Una venta podrá vincularse a la agenda que la originó.
- **Sincronización con Google:** la tabla de calendarios deja lugar para el canal de notificaciones push y el token de sincronización.
- **Venta del sistema:** antes de sumar negocios externos, hay que verificar la app de Google (tope de 100 usuarios) y activar el dominio propio de las páginas públicas.
- **Confirmación manual y pagos:** el estado de la agenda es una lista extensible (se podrá sumar "pendiente").

---

**Siguiente paso:** el alcance de la Etapa 4 quedó definido (v5). Los requerimientos de la etapa completa están en `claude/requerimientos-agendamiento.md`, anclados a esta versión.
