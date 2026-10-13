# Pendientes: Tareas × CRM y calendario

Formato: **qué quedó** · **por qué** · **qué se decidió**.

## Abiertos

- **Revisión visual (1440 y 390 px, claro y oscuro) sin hacer** · pide una sesión iniciada contra la base de producción (una cuenta nueva ahí no corresponde, y las credenciales no se escriben en el navegador) y el servidor de desarrollo no arranca desde el worktree (Turbopack rechaza el symlink de `node_modules`) · el marcado quedó fijado con pruebas de caracterización (`renderToStaticMarkup`) del campo de seguimiento y de la grilla del calendario; antes de mergear, **recorrer a mano**: ficha y bandeja (sección «Tareas», seguimiento con y sin tarea), panel de «Crear tarea» y «Completar tarea», Ajustes › Ventas (interruptor y los dos flujos), hora en celda y drawer, calendario con «Tareas» apagado y encendido (día, semana, mes, «Sin fecha», solapes), el modal de reprogramar, el aviso de fusión; en claro y oscuro y a 390 px.
- **`npm run build` en el worktree** · Turbopack: «Symlink node_modules is invalid» · se compiló una copia con `node_modules` real (APFS clone) y dio verde; en Railway no aplica.

- **Verificación en vivo del arrastre (tareas y agendas)** · el navegador del entorno puede no soportar arrastre HTML5 · si no se puede probar acá, queda para verificar en vivo; la lógica está cubierta con funciones puras y tests.
- **Zona del seguimiento** · el valor de `next_followup_date` no guarda la zona de quien lo cargó · se decodifica con la zona del workspace; si quien cargó la fecha está a 12 h o más de esa zona, el día puede correrse (decisión de Wendy, 13/10/2026).
- **`create_task` / `complete_task` en los editores simples** (Formularios, Agenda, Fin de día) · Ventas no usa ninguno y el catálogo `lib/automations/step-catalog.ts` es compartido · no se tocan; siguen solo en el lienzo.

- **Arrastre de botones en Firefox** · Firefox no inicia un arrastre HTML5 desde un `<button>` · las tarjetas del calendario son `<div draggable>` con rol de botón, así que no aplica; si se cambiara a `<button>`, revisar · solo nota.
- **Conflicto de `ALL_MIGRATIONS.sql` al mergear** · la sesión de contactos también lo regenera · después del merge correr `node scripts/build-all-migrations.mjs` y resolver tomando el resultado regenerado.
- **Deshacer una fusión de contactos** · el duplicado queda con borrado lógico 30 días, pero lo movido al principal no vuelve solo · queda en el historial qué se movió; no hay botón «deshacer fusión».
- **Un contacto fusionado desde un enlace abierto** · quien tenga abierta la ficha del duplicado verá 404 al recargar; es el comportamiento esperado.
- **Cobranza: el interruptor no tiene columna** · el estado es si el flujo está publicado; si alguien despublica `task_payment_overdue` a mano, la pantalla lo muestra apagado (es coherente).

## Decisiones tomadas

- Tareas: las tareas se arrastran sin confirmar (con «Deshacer»); las agendas siempre con modal (decisión del plano).
- Regla de fechas (R10): revierte la decisión de `PENDIENTE-tareas.md` («las dependientes que no ve no se mueven»).

- Fusión (R9): la atribución del principal se recalcula con todos los toques.
- `{{contact.first_name}}` y `{{contact.display_name}}` se suman a las variables de Ventas (arregla de paso el saludo de los flujos de cobranza existentes).
- «Persona asignada al contacto» = vendedor → setter → persona de la conversación más reciente → nadie.

- **Migraciones 00206/00207 en vez de 00200/00201** · la sesión «Regla única de contactos» reservó la 00200–00205 en paralelo · se numeran 00206 y 00207 (acordado entre sesiones).
