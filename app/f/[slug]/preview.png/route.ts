import { isAvailable } from "@/lib/forms/public-client";
import { loadPublicFormData } from "@/lib/forms/public-load";
import { loadFormShare } from "@/lib/forms/share-preview";
import { shareImageResponse } from "@/lib/og/share";

/** La imagen de la tarjeta de un formulario. Uno en borrador, pausado, archivado o inexistente es 404. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return shareImageResponse(request, async (service) => {
    const form = await loadPublicFormData(service, slug);
    return isAvailable(form) ? loadFormShare(service, form) : null;
  });
}
