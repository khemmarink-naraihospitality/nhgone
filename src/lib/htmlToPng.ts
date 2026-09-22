/**
 * Rasterise a block of HTML to a PNG data URL, in the browser.
 *
 * Why in the browser rather than on the server: a rendered ร.ร.๓ card is
 * mostly Thai, and Thai needs real text shaping (vowels above, tone marks
 * above those, sara-u below). Every server-side option this project tried was
 * ruled out for that or for cost - headless Chromium needed a 3 GB function,
 * WeasyPrint needs native Pango, and xhtml2pdf cannot render Thai at all (see
 * CLAUDE.md). The terminal already has a browser that lays the card out
 * correctly and is already displaying it, so it does the rasterising.
 *
 * How: the HTML is laid out for real in an off-screen node, serialised back
 * out as XHTML, wrapped in an <svg><foreignObject>, and drawn to a canvas.
 * The browser's own layout and text engine do the work - unlike a
 * re-implementation of CSS, which is what most html-to-image libraries are,
 * and is why none is being added as a dependency here.
 *
 * The one real constraint: **everything must be self-contained.** A
 * foreignObject renders in an isolated context with no access to the page's
 * stylesheets, no network fetches, and it taints the canvas if it reaches for
 * a cross-origin image. So the HTML has to carry its own <style>, and images
 * have to be `data:` URLs. The RR3 card is already exactly that - its
 * template inlines its <style>, names only OS fonts, and the signature is a
 * data URL from the signature pad.
 *
 * Fonts are the known fidelity limit: only fonts installed on THIS device
 * apply. The RR3 template asks for "Angsana New"/"TH Sarabun New" and falls
 * back to generic serif, so the same card rasterised on an iPad and on a
 * Windows desktop is the same document in a different Thai typeface.
 */

export interface HtmlToPngOptions {
  /** Layout width in CSS pixels. 794 ~ A4 at 96dpi, which is what the RR3
   * template is built for. */
  width?: number;
  /** Pixel density. 2 keeps the small print legible without the base64
   * running to many megabytes. */
  scale?: number;
  /** Painted behind the content - a PNG is otherwise transparent, which
   * prints as black in some viewers. */
  background?: string;
}

/** Wait for every <img> in the node, so nothing is drawn half-loaded. A
 * broken image resolves rather than rejects: a card missing its signature is
 * still worth having. */
async function imagesSettled(node: HTMLElement): Promise<void> {
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
    ),
  );
}

export async function htmlToPngDataUrl(html: string, options: HtmlToPngOptions = {}): Promise<string> {
  const width = options.width ?? 794;
  const scale = options.scale ?? 2;
  const background = options.background ?? "#ffffff";

  // Laid out off to the side rather than hidden: display:none and
  // visibility:hidden both give back a zero or unreliable height, and the
  // height is what the SVG viewport has to be.
  const host = document.createElement("div");
  host.setAttribute("style", `position:fixed;left:-20000px;top:0;width:${width}px;background:${background};`);
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    await imagesSettled(host);
    // A card is one page; rounding up avoids clipping the last rule off the
    // bottom when the height lands on a fraction.
    const height = Math.ceil(Math.max(host.scrollHeight, host.getBoundingClientRect().height));

    // serializeToString gives well-formed XHTML from the parsed DOM - which
    // is what closes <br> and <img> for us. Hand-written HTML would not be
    // valid XML, and an SVG with invalid XML inside renders as nothing at
    // all rather than as an error.
    const inner = new XMLSerializer().serializeToString(host);
    const xhtml = inner.replace("<div ", '<div xmlns="http://www.w3.org/1999/xhtml" ');

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>` +
      `</svg>`;

    const image = new Image();
    image.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("the card could not be rasterised"));
      // encodeURIComponent, not btoa: the card is full of Thai, and btoa
      // throws on any character above U+00FF.
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas context");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/png");
  } finally {
    host.remove();
  }
}
