import { shareImageResponse } from "@/lib/og/share";
import { findPublicEvent } from "@/lib/scheduling/data/slots-input";
import { loadEventShare } from "@/lib/scheduling/share-preview";

/** La imagen de la tarjeta de un link de agenda. Un evento inactivo o inexistente es 404, igual que su página. */
export async function GET(request: Request, { params }: { params: Promise<{ usuario: string; evento: string }> }) {
  const { usuario, evento } = await params;
  return shareImageResponse(request, async (service) => {
    const found = await findPublicEvent(service, usuario, evento);
    return found ? loadEventShare(service, found) : null;
  });
}
