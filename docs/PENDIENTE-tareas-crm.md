# Pendientes: Tareas × CRM y calendario

Formato: **qué quedó** · **por qué** · **qué se decidió**.

## Abiertos

- **Verificación en vivo del arrastre (tareas y agendas)** · el navegador del entorno puede no soportar arrastre HTML5 · si no se puede probar acá, queda para verificar en vivo; la lógica está cubierta con funciones puras y tests.
- **Zona del seguimiento** · el valor de `next_followup_date` no guarda la zona de quien lo cargó · se decodifica con la zona del workspace; si quien cargó la fecha está a 12 h o más de esa zona, el día puede correrse (decisión de Wendy, 13/10/2026).
- **`create_task` / `complete_task` en los editores simples** (Formularios, Agenda, Fin de día) · Ventas no usa ninguno y el catálogo `lib/automations/step-catalog.ts` es compartido · no se tocan; siguen solo en el lienzo.

## Decisiones tomadas

- Fusión (R9): la atribución del principal se recalcula con todos los toques.
- `{{contact.first_name}}` y `{{contact.display_name}}` se suman a las variables de Ventas (arregla de paso el saludo de los flujos de cobranza existentes).
- «Persona asignada al contacto» = vendedor → setter → persona de la conversación más reciente → nadie.

- **Migraciones 00206/00207 en vez de 00200/00201** · la sesión «Regla única de contactos» reservó la 00200–00205 en paralelo · se numeran 00206 y 00207 (acordado entre sesiones).
