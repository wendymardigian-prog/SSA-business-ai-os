# Mis proyectos (Corrida C) · qué está listo, cómo probarlo y qué falta

Actualizado: 17/11/2026. Detalle técnico de cada migración en `docs/PROGRESS-proyectos-c.md`.

## Qué está listo

**En el panel** (publicado en Railway):
- Portal › programa › **Proyectos y facturación**:
  - Pagos reportados: filtros, verificar, pedir comprobante y exportar.
  - Proyectos.
  - Sala de la fama: el ranking y qué cuenta.
  - Mesa de trabajo: los pasos del método con su prompt y su análisis, cada uno con su versión, las tareas y el presupuesto por tamaño.
  - Ideas.
- Ficha del servicio › **Proyectos e ingresos**: cargar un pago, verificar y ajustar el total.
- Ficha del cliente: **Facturación como builder**.
- Permisos nuevos: Sala de la fama, Pagos que reportan los estudiantes y Mesa de trabajo.

**En el portal** (en `main`, todavía no publicado en Railway):
- **Mis proyectos**: los números, la lista y "Nuevo proyecto", con el sorteador de ideas para los de práctica.
- **El proyecto**: la mesa de trabajo con los pasos que cargó el equipo, con estos elementos:
  - "Copiar prompt" y "Ver el prompt";
  - el documento con versiones (pegar, subir texto, editar, ver, restaurar, copiar y descargar);
  - las tareas y el estado;
  - Diseño (links), Roadmap y Construcción.
- La **facturación** del proyecto y la general, con su gráfico, y **Reportar un pago** con el comprobante para pegar, arrastrar o elegir.
- Si se vence el acceso, todo queda en **solo lectura**.
- La **Sala de la fama** muestra la facturación.

**En la base**: aplicadas de la 00395 a la 00398 (la 00398, el análisis con IA, el 17/11).

## Antes de probar (importante)

1. **La extensión de proyectos está apagada.** Mientras esté apagada, ni la pestaña del panel ni la sección del portal aparecen. La prende la plataforma; Wendy no lo puede hacer desde la pantalla. Pedíselo a Leonardo (o a Claude), que la prende con un cambio en la base.
2. **En el programa** (Ajustes del programa y la variante): prender "Mis proyectos" y "Sala de la fama". Si alumnos reales tienen esa variante, conviene dejar las dos secciones **ocultas** hasta terminar de probar, y darle acceso solo al estudiante de prueba desde su ficha (Accesos › Dar acceso extra).
3. **Cargar la Mesa de trabajo**: los pasos, con sus instrucciones de prompt y de análisis. Estas claves de paso activan su pantalla propia en el portal:
   - `proyecto`: los datos del proyecto;
   - `brief1`, `guion`, `brief2`, `invest` y `propuesta`: sus campos propios;
   - `llamada`: la transcripción;
   - `diseno`: los links;
   - `roadmap`: el roadmap;
   - `constr`: la construcción.

   Cualquier otra clave muestra un paso común. Variables que se pueden usar en el prompt:
   - `{{proyecto}}`, `{{datos}}`, `{{montos}}`, `{{rango_presupuesto}}`, `{{parte}}`, `{{modo}}` y `{{requerimientos}}`;
   - `{{clave del paso}}` (por ejemplo `{{brief1}}`), que pone el documento de ese paso.
4. **El portal todavía corre solo en la compu de Leonardo** (localhost:3100). Para que Wendy lo pruebe desde la suya hay que publicarlo en Railway (ver "Lo que falta").

## Lo que falta

**Hecho en la rama `feat/proyectos-c6` del portal (pendiente de mergear a `main`)**
- La tarjeta **Análisis con IA** en los pasos con análisis: créditos del mes, botón Analizar, resultado con la versión analizada, «Analizar de nuevo», aviso de análisis viejo y «Copiar como pedido de mejora».
- **Subir un Word o un PDF** a un paso (el texto se lee en el panel y se guarda como versión; el original queda al lado).
- **Descargar un documento como PDF** (abre la impresión del navegador).
- **«Publicarlo en Victorias»** al reportar un pago (sin monto, salvo que la persona lo muestre en la Sala de la fama).
- «Reportar un pago» de la **Sala de la fama** abre el modal real (antes mostraba «llega con Mis proyectos»).

**Para terminar Mis proyectos**
- **El uso del revisor separado del tutor** en la pestaña Asistente IA del programa. Hoy se descuenta bien del cupo, pero no se muestra por separado (pide una migración nueva).
- **Mirar todas estas pantallas funcionando.** Se probaron con tests y compilan, pero no se vieron en pantalla con la extensión prendida.

**Para abrirlo a estudiantes**
- **Publicar el portal en Railway**: crear el servicio con sus variables (`PORTAL_DATABASE_URL`, `PORTAL_SHARED_SECRET`, `PANEL_INTERNAL_URL`), apuntar `scalingsystems.academy` y cargar `PORTAL_SHARED_SECRET` en el panel. Antes, cambiar la contraseña de `portal_app_login`, porque quedó visible en una captura.
- **La prueba completa con el estudiante de prueba**: proyecto real y de práctica, pasos, prompt, versiones, análisis, Word/PDF, pagos con y sin comprobante, verificar desde el panel, Sala de la fama y acceso vencido.

## Qué mirar al probar

- Que un pago sin comprobante aparezca en el panel con el filtro "Sin comprobante", y que "Pedir comprobante" le llegue al estudiante. El email solo sale si tiene cuenta en el portal.
- Que, con "solo verificados", un pago no sume a la Sala de la fama hasta verificarlo.
- Que el prompt de un paso traiga la última versión de los documentos que usa, y diga "[Todavía no lo pegaste]" si falta alguno.
- Que con el acceso vencido se pueda ver y descargar todo, pero no copiar prompts ni pegar.
