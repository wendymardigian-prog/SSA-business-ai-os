# Llamadas de WhatsApp de verdad: evaluación de Wavoip

Estado: **solo investigación** (23/10/2026). No se construyó nada de esto.

## Por qué no alcanza con Evolution

Evolution API (la 2.3.7, la que corre en Railway) **no puede hacer ni atender llamadas**:

- `POST /call/offer/{instancia}` existe, pero en el código de la 2.3.7 la llamada real está comentada y el método devuelve un resultado inventado (`{ id: '123', ... }`). No suena ningún teléfono.
- Baileys (la librería que usa Evolution por debajo) entiende la señalización de una llamada (alguien llama, se atendió, se cortó), pero **no maneja el audio**.

Con lo que sí hay ya quedó construido (migración `00258`): cada llamada aparece en el chat, una perdida avisa al responsable, y cada número puede rechazar las llamadas solo y mandar un mensaje (`rejectCall` + `msgCall`).

## Qué es Wavoip

Un servicio brasileño, **pago y no oficial**, que se engancha a una sesión de WhatsApp (por QR o por token) y deja hacer y atender llamadas de voz desde el navegador.

- Evolution ya trae el enganche: el ajuste `wavoipToken` de la instancia y `useVoiceCallsBaileys` en el código de la 2.3.7. Con un token cargado, la instancia le pasa las llamadas a Wavoip.
- Para la pantalla hay un "teléfono web" listo: el paquete npm `@wavoip/wavoip-webphone`.
- Tiene tres módulos: Click To Call (llamar con un clic), una API por websocket para armar un flujo propio, y SIP para conectar una central telefónica.

## Planes (datos de terceros, hay que confirmarlos con Wavoip)

- Hay un plan gratis con tope de llamadas. Las fuentes no coinciden en el tope: una dice 50 por dispositivo y otra, 5 por día.
- Revendedores mencionan un plan "Enterprise" con llamadas ilimitadas desde ~R$ 99,90 por mes.
- Reventa y volumen alto: precio a pedido.

## Riesgos

- **No es oficial.** WhatsApp no habilita esto para cuentas por QR. Llamar desde una herramienta externa puede terminar en un bloqueo del número, y la propia documentación de Wavoip habla de ese riesgo.
- Es un proveedor más: el audio de las llamadas pasa por sus servidores.
- La alternativa oficial es la **WhatsApp Business Calling API** (Cloud API de Meta, por WebRTC). Pide pasar el número a la API oficial, que cobra por minuto atendido. Hoy usamos Evolution por QR.

## Cómo se vería si se hace

- Un botón «Llamar» **solo en los chats de WhatsApp** (la regla iría en un módulo como `lib/channels/stickers.ts`: rama explícita por proveedor).
- El teléfono web de Wavoip en un panel chico. El token del cliente se guarda en Vault como cualquier otra clave, nunca en el código.
- Las llamadas hechas o atendidas desde ahí quedarían en el mismo `whatsapp_calls` que ya existe.

## Antes de decidir, preguntarle a Wavoip

1. ¿Funciona con Evolution 2.3.7 y Baileys por QR, sin cambiar de versión?
2. ¿Cuántas llamadas por mes incluye cada plan, y qué pasa al pasarse?
3. ¿Dónde pasa el audio? ¿Se graba algo?
4. ¿Qué tasa de bloqueos ven en números que llaman a leads nuevos (no contactos)?
5. ¿Se pueden atender en el navegador las llamadas entrantes, o solo hacer salientes?

## Fuentes

- Código de Evolution API 2.3.7: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (`offerCall`, el manejo del evento `call` y `wavoipToken`).
- [Wavoip](https://www.wavoip.com/), [documentación de la API](https://wavoip.gitbook.io/api) y [`@wavoip/wavoip-webphone` en npm](https://www.npmjs.com/package/@wavoip/wavoip-webphone).
- Guías de terceros sobre planes: [ZDG](https://ajuda.zdg.com.br/ferramentas-adicionais-e-integracoes/wavoip-ligacoes-pelo-whatsapp), [Super Zapp](https://ajuda.super-zapp.com.br/wavoip-ligacoes-ilimitadas-no-whatsapp/configure-wavoip).
