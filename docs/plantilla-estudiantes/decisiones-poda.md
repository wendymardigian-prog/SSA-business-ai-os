# Plantilla de estudiantes: qué se saca de la base y por qué

Este documento explica, sin tecnicismos, qué cambia en la base de datos de la plantilla de estudiantes respecto del sistema completo. Todo lo que figura acá lo hace un solo archivo: `scripts/plantilla/poda.sql` (la "poda"). Se aplica sobre una base con todas las migraciones del proyecto y la deja como tiene que quedar la plantilla.

Los puntos marcados con **PREGUNTA** necesitan tu decisión. Todo lo demás es consecuencia directa de sacar los módulos.

## Qué módulos se sacan

- **Llamadas** (Fathom y el analizador de llamadas con IA).
- **Formularios**, incluidos las encuestas, el **reporte de fin de día** y los **contratos** firmados.
- **Ventas** (ventas y pagos).
- **Tareas**.
- **Finanzas** (gastos, gastos que se repiten y proveedores).
- **Comisiones**.
- **Webhooks entrantes** (recibir datos de otra herramienta y arrancar una automatización).

## Qué se queda aunque nació junto con esos módulos

- **El catálogo de productos** (productos y sus variantes, con precio y su historial). Lo usa el "producto de interés" del contacto.
- **La asignación automática de leads** (Ajustes → Asignación): las reglas para elegir setter, vendedor y referido, el aviso que se dispara cuando un contacto cambia su atribución, y las reglas de la bandeja por cuenta. Algunos nombres internos todavía dicen "sales" (ventas) porque nacieron dentro de Ventas: se dejan así a propósito, porque cambiarles el nombre no aporta nada y obliga a tocar más código.

## 1. Tablas que se borran (16)

| Módulo | Tablas |
|---|---|
| Llamadas | `calls` |
| Formularios | `forms`, `form_versions`, `form_submissions`, `contract_signatures`, `eod_reports` |
| Ventas | `sales`, `payments` |
| Tareas | `tasks` |
| Finanzas | `expenses`, `recurring_expenses`, `vendors` |
| Comisiones | `commissions`, `commission_rules` |
| Webhooks entrantes | `webhook_endpoints`, `inbound_webhooks` |

Con cada tabla se van sus reglas de acceso, sus índices y sus automatismos internos.

## 2. Datos (columnas) que se sacan de tablas que se quedan (18)

| Dónde | Dato | Por qué |
|---|---|---|
| Ideas de contenido | `call_id` | Era la llamada de la que salía la idea. |
| Automatizaciones | `form_id` | Era el formulario desde el que se creó la automatización. |
| Sesiones de automatización | `inbound_webhook_id` | Era el envío de webhook que la arrancó. |
| Contactos | `payment_health` | La "salud de pago" la calculaban los pagos. |
| Equipo | `is_closer`, `closer_emails` | Marcaban quién graba llamadas en Fathom y con qué correos. No los usa la Asignación. |
| Conexiones (Google, etc.) | `last_synced_at`, `sync_watermark`, `sync_cursor`, `sync_last_error`, `refresh_locked_until` | Eran solo de la sincronización de Fathom. Google Calendar no los usa. |
| Negocio | `enabled_payment_methods`, `payment_methods`, `max_discount_percent`, `overdue_grace_days`, `sales_auto_create_flows` | Ajustes de Ventas y Pagos (métodos de pago, descuento máximo, días de gracia, flujos de cobranza). |
| Negocio | `finance_settings` | Ajustes de Finanzas (categorías de gastos y gastos automáticos). |
| Negocio | `commission_settings` | Roles de comisión. |

Además se borran dos índices (atajos de búsqueda) que solo servían a los módulos: el de las vistas de formularios en las analíticas y el de los trabajos programados de un pago.

## 3. Listas de valores permitidos que se achican

Algunas columnas solo aceptan valores de una lista. Se sacan de esas listas los valores de los módulos:

- **Disparadores de automatizaciones**: se van llamada analizada, llamada vinculada, formulario enviado, encuesta respondida, contrato firmado, venta creada, cambio de estado de una venta, pago creado, cambio de estado de un pago, antes y después del vencimiento de un pago, reporte de fin de día enviado, webhook recibido, tarea completada y tarea vencida. Quedan los de mensajes, contactos, CRM, inactividad, email y Agenda.
- **Origen de una corrida de IA** y **tareas de IA con instrucciones propias**: se van las cinco de Llamadas (clasificar, analizar, corregir, resumir y probar instrucciones). Quedan clasificación de mensajes, resumen, clasificación al cierre, descripción de imágenes, análisis de anuncios, transcripción, copywriter, etc.
- **De dónde sale una idea de contenido**: queda "a mano" o "agente" (se va "llamada").
- **Proveedores de conexión**: se va Fathom.
- **Origen de un toque de atribución**: se van "formulario" y "webhook". Quedan mensaje, comentario, agenda, a mano, importación y clic en un link.
- **Qué disparó una automatización**: quedan contacto, persona del equipo, agenda y sistema (se van webhook, tarea, formulario, venta y llamada).
- **Una automatización sin contacto** tiene que decir de dónde salió. Antes había una excepción para los eventos de una persona del equipo (fin de día y tareas); como esos eventos ya no existen, la excepción se saca.

## 4. Funciones del sistema que cambian (se quedan, sin las partes de los módulos)

- **Permisos del Member**: la lista de lo que puede un Member de sistema pierde las claves de Llamadas, Formularios, Ventas, Pagos, Tareas y Comisiones. Queda: ver el dashboard de chat, ver/editar/asignar contactos, ver/editar/publicar automatizaciones, ver secuencias y agentes, ver y crear contenido, usar la agenda y ver/gestionar reuniones.
- **Fusionar contactos**: hace lo mismo que en el sistema completo, pero ya no mueve tareas, respuestas de formularios, firmas, llamadas, envíos de webhook ni ventas (no existen). Sigue moviendo conversaciones, etiquetas, campos, secuencias, automatizaciones, atribución, estados, reuniones, notas, referidos y producto de interés.
- **Purga diaria de lo borrado**: antes un contacto borrado con ventas no se purgaba nunca. Ahora todo contacto borrado se purga a los 30 días, como el resto.
- **De dónde salió una automatización**: se saca el caso "webhook".
- **Tabla de anuncios contra el CRM** (Dashboards → Anuncios): sigue contando leads nuevos, leads totales, agendas y asistencias por campaña, conjunto y anuncio. Las columnas de **ventas, ingresos, cobrado y cobrado del primer pago** vuelven vacías, porque no hay ventas de dónde sacarlas. Se conservó la forma de las funciones para que la pantalla no se rompa; esas columnas se esconden del lado de la pantalla.
- La versión vieja de esa tabla (`ads_crm_metrics`, reemplazada hace tiempo por la v2) se borra: nada la usa.

## 5. Reglas de acceso (políticas) que cambian

- **Instrucciones de las tareas de IA**: antes las podía ver y versionar quien tuviera "Agentes IA: administrar tareas" **o** "Llamadas: configurar". Ahora solo la primera.
- **Historial (registro de actividad)**: se borran los permisos extra para ver el historial de llamadas, ventas y pagos, tareas, finanzas y comisiones. El de ventas también dejaba ver el historial del **catálogo de productos**: esa parte se conserva en una regla nueva, `audit_log_select_catalog` (cualquier miembro del negocio ve el historial de productos y variantes, como antes).

## 6. Automatismos, tareas programadas y archivos

- **Automatismos que se sacan de tablas que se quedan**: limpiar las tareas de una persona que sale del equipo, y validar los roles de comisión del negocio.
- **Tareas programadas (cron) que se sacan**: sincronizar Fathom, revisar pagos vencidos, recordar el fin de día, revisar tareas vencidas y el trabajo diario de Finanzas. Quedan las otras 25.
- **Carpetas de archivos (buckets) que se borran**: archivos subidos en formularios, contratos, comprobantes de pago y comprobantes de gastos (con la regla de acceso de esta última). Quedan las 7 restantes (contenido, chat, avatares, conocimiento, adjuntos de email, creatividades de anuncios y marca).

## 7. Funciones que se borran (85)

Todas las funciones que solo existían para los módulos: las de ventas y pagos (crear y cancelar una venta, calcular su estado, los eventos de pagos, el método de pago), las de formularios y contratos (publicar, mostrar el formulario público, recibir una respuesta, firmar, comprobar el texto firmado, las métricas), las del fin de día, las de tareas (borrar, dependencias, mover fechas), las de finanzas (gastos automáticos, vencidos), las de comisiones (reglas, cálculo, liquidación), las de llamadas, la de recibir un webhook entrante, y las reglas de "quién puede ver" de cada una de esas tablas.

Tres que vale la pena nombrar:

- **`find_contact_by_phone_or_email`**: buscaba un contacto por teléfono o email; solo la usaba Ventas. La búsqueda de contactos del resto del sistema (`find_or_create_contact`) no cambia.
- **`find_contact_for_form`**: el buscador de contactos de los formularios y los webhooks entrantes.
- **`claim_oauth_refresh` / `release_oauth_refresh`**: el candado para renovar la conexión de Fathom. Google Calendar no lo usa.

## 8. Lo que se deja a propósito, aunque suene a un módulo

- **Resultado "venta" de una reunión** en la Agenda (el estado "sale" de una reunión, junto a "no se presentó", "seguimiento", etc.): es el resultado de la reunión, no una venta registrada. Se queda.
- **Llamadas de WhatsApp** (la Bandeja registra las llamadas que avisa WhatsApp): no tienen nada que ver con Fathom. Se quedan.
- **"Webhook" como autor de una acción en el historial**: es genérico (un aviso que llega de un proveedor). Se queda en la lista de autores posibles.
- **Estado de vendedor (closer) del contacto** y el pipeline de estados: son del CRM, no de Ventas. Se quedan.
- **Una función de atribución** (`meta_touch_utm_counts`) todavía nombra los orígenes "formulario" y "webhook". Es la gemela exacta de una regla del código; tocarla rompería la comprobación de que las dos dicen lo mismo, y como esos orígenes ya no pueden aparecer, no hace ningún efecto.

## PREGUNTAS para vos

1. **PREGUNTA — Tabla de anuncios sin ventas.** Sin el módulo Ventas, la tabla "Meta vs CRM" pierde las columnas de ventas, ingresos, cobrado y costo por venta. Quedan leads, agendas y asistencias. ¿Te sirve así para los estudiantes, o preferís que esa sección explique que "ventas" se suma con el módulo de Ventas?
2. **PREGUNTA — Purga de contactos borrados.** En tu sistema, un contacto borrado que tenía ventas nunca se purga. En la plantilla, como no hay ventas, todo contacto borrado se elimina de verdad a los 30 días. ¿Está bien?
3. **PREGUNTA — Asignación con nombres viejos.** La asignación automática se queda con nombres internos que dicen "sales" (ventas). No se ven en pantalla. ¿Preferís dejarlos así (recomendado: menos riesgo y más fácil de comparar con tu sistema) o renombrarlos?
4. **PREGUNTA — Resultado "venta" en la Agenda.** Una reunión puede terminar con el resultado "venta". Sin el módulo de Ventas, ese resultado queda como una etiqueta más (no crea nada). ¿Lo dejamos (recomendado) o lo sacamos de la lista de resultados?
