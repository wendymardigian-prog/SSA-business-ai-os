/**
 * El link para volver a agendar de una reunion reasignada. El anfitrion ya no es
 * el dueño del evento, y el evento solo se abre con el usuario de su dueño: con el
 * del anfitrion daba 404.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HOST, EVENT, WS, schedulingWorld } from "@/lib/scheduling/testing/world";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { bookingContextVariables } from "@/lib/scheduling/automation/context";
import { findBookingByUid, toPublicBooking } from "./public-booking";

let db: ReturnType<typeof schedulingWorld>;

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));

const { GET: getEvent } = await import("@/app/api/public/scheduling/event/route");

const OTRO = "user-2";
const UID = "uid-de-veintidos-letras";

const eventStatus = (username: string, slug: string) =>
  getEvent(new NextRequest(`http://localhost/api/public/scheduling/event?user=${username}&event=${slug}`)).then((res) => res.status);

function world(hostUserId: string, event: Record<string, unknown> = {}) {
  db = schedulingWorld({
    event,
    bookings: [
      {
        id: "bk-1",
        uid: UID,
        workspace_id: WS,
        event_type_id: EVENT,
        host_user_id: hostUserId,
        title: "Llamada de triaje",
        start_at: "2026-10-01T16:00:00.000Z",
        end_at: "2026-10-01T16:30:00.000Z",
        status: "cancelled_other",
        responses: {},
      },
    ],
  });
  db.rows("workspaces")[0].scheduling_public_base_url = "https://agenda.ejemplo.com";
  db.rows("scheduling_profiles").push({
    id: "prof-2",
    workspace_id: WS,
    user_id: OTRO,
    username: "lucia",
    display_name: "Lucía",
    is_active: true,
    avatar_url: "https://x/lucia.png",
  });
}

async function publicBooking() {
  const found = await findBookingByUid(db.client as never, UID);
  return toPublicBooking(found!);
}

const contextVariables = () => bookingContextVariables(db.client as never, db.rows("bookings")[0]);

describe("volver a agendar una reunion reasignada", () => {
  beforeEach(() => world(OTRO));

  it("la pagina de la reunion lleva al dueño del evento, y ese link abre el evento", async () => {
    const booking = await publicBooking();
    expect(booking.rebookPath).toBe("/calendario/ana/llamada-de-triaje");
    const [, , username, slug] = booking.rebookPath!.split("/");
    expect(await eventStatus(username, slug)).toBe(200);
  });

  it("la reunion sigue mostrando a su anfitrion, cuyo usuario no abre el evento", async () => {
    const booking = await publicBooking();
    expect(booking.hostName).toBe("Lucía");
    expect(booking.hostAvatarUrl).toBe("https://x/lucia.png");
    expect(booking.username).toBe("lucia");
    expect(await eventStatus(booking.username!, booking.eventSlug)).toBe(404);
  });

  it("{{scheduling.link}} lleva al dueño del evento y {{booking.host_name}} al anfitrion", async () => {
    expect(interpolateVariables("{{scheduling.link}} con {{booking.host_name}}", await contextVariables())).toBe(
      "https://agenda.ejemplo.com/calendario/ana/llamada-de-triaje con Lucía",
    );
  });
});

describe("el link para volver a agendar, en los demas casos", () => {
  it("sin reasignar, es el del anfitrion, que es el dueño", async () => {
    world(HOST);
    expect((await publicBooking()).rebookPath).toBe("/calendario/ana/llamada-de-triaje");
    expect((await contextVariables()).scheduling).toEqual({ link: "https://agenda.ejemplo.com/calendario/ana/llamada-de-triaje" });
  });

  it("una reunion sin evento no tiene link", async () => {
    world(HOST, { is_internal: true });
    expect((await publicBooking()).rebookPath).toBeNull();
    expect((await contextVariables()).scheduling).toEqual({ link: "" });
  });

  it("si el dueño no tiene perfil, no hay link", async () => {
    world(OTRO);
    db.rows("scheduling_profiles").splice(0, 1);
    expect((await publicBooking()).rebookPath).toBeNull();
    expect((await contextVariables()).scheduling).toEqual({ link: "" });
  });
});
