import { renderRr3Template, type Rr3TokenData } from "@/lib/rr3Template";
import { htmlToPngDataUrl } from "@/lib/htmlToPng";

/**
 * What happens to a ร.ร.๓ card the moment its guest signs at the kiosk:
 * it is frozen as it stood, and attached to that guest's own Mews profile.
 *
 * Both matter for the same reason. RR3 is rebuilt LIVE from MEWS every time
 * anyone views or prints it, so a guest profile edited days later reprints a
 * DIFFERENT document from the one the guest signed - and the signature is
 * still on it. Freezing keeps the facts the signature actually attests to;
 * attaching puts the signed copy where the hotel's own staff look, on the
 * guest record in Mews (`customers/addFile`).
 *
 * Deliberately best-effort, and deliberately after the signature is already
 * stored. Everything here is a bonus on top of a check-in that has already
 * succeeded; a guest standing at a terminal must never be told their
 * check-in failed because a card could not be rasterised or MEWS was slow.
 * The caller logs what came back and moves on.
 */

interface Rr3Card extends Rr3TokenData {
  CardId: string;
  CustomerId?: string;
}

export type Rr3CaptureOutcome =
  | "attached"              // frozen here and filed on the Mews profile
  | "frozen-only"           // frozen here; MEWS has no profile for this guest
  | "no-card"               // MEWS lists no RR3 card for them
  | "failed";               // something went wrong - already logged

async function getJson(url: string): Promise<{ status?: string; data?: unknown; [k: string]: unknown }> {
  const response = await fetch(url);
  return response.json();
}

export async function captureRr3Card(args: {
  propertyName: string;
  reservationId: string;
  reservationNumber: string;
  /** For a guest MEWS already knows this IS their CustomerId, which is what
   * the card is keyed by; a guest added at the terminal has our own
   * `kiosk:<uuid>` instead and has no card to find. */
  guestKey: string;
}): Promise<Rr3CaptureOutcome> {
  const { propertyName, reservationId, reservationNumber, guestKey } = args;
  try {
    // One card list for the booking just signed against, and the shared
    // template. Fetched together - neither is useful without the other.
    const params = new URLSearchParams({ property_name: propertyName, reservation_id: reservationId });
    const [cardsRes, templateRes] = await Promise.all([
      getJson(`/api/rr3/cards?${params}`),
      getJson(`/api/rr3/template`),
    ]);
    if (cardsRes.status !== "success" || templateRes.status !== "success") return "failed";

    const cards = (cardsRes.data as Rr3Card[]) || [];
    const card = cards.find((c) => c.CustomerId === guestKey);
    // No card is an ordinary outcome, not a fault: a guest added at this
    // terminal isn't on the MEWS booking, so MEWS builds no card for them.
    if (!card) return "no-card";

    const template = (templateRes.data as { html_template?: string })?.html_template;
    if (!template) return "failed";

    // The signature is already on the card: get_rr3_cards merges it from
    // kiosk_reg_cards, and this runs after that row is stored.
    const png = await htmlToPngDataUrl(renderRr3Template(template, card));

    const response = await fetch("/api/kiosks/registration/attach-rr3", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        property_name: propertyName,
        reservation_number: reservationNumber,
        guest_key: guestKey,
        card,
        image_data_url: png,
      }),
    });
    const res = await response.json();
    if (!response.ok || res.status !== "success") return "failed";
    return res.mews_file === "attached" ? "attached" : "frozen-only";
  } catch {
    return "failed";
  }
}
