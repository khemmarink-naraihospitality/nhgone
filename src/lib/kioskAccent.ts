/**
 * The kiosk's button colour: reading it, deriving it from a property's logo,
 * and turning it into the CSS variables the check-in screens paint with.
 *
 * Shared by Admin Console > Kiosks (which previews and stores it) and the
 * /kiosk screens (which apply it), so the swatch an admin picks and the
 * button a guest taps can never be computed differently.
 *
 * DEFAULT = THE PROPERTY'S OWN LOGO COLOUR. A kiosk with no colour saved
 * doesn't fall back to a generic indigo - it takes the dominant colour out
 * of that property's logo, so a terminal that nobody has configured still
 * looks like it belongs to the hotel it is standing in.
 */

/** The built-in indigo, used only when there is no colour AND no logo to
 * read one from. Matches `--kiosk-accent` in globals.css. */
export const FALLBACK_ACCENT = "#4f46e5";

/** `#abc`, `abcdef`, `#ABCDEF` -> `#abcdef`. Null for anything else.
 * Everything that reaches a `style` attribute goes through this first: an
 * unvalidated string from the database in a CSS value is an injection. */
export function normalizeHex(input: string | null | undefined): string | null {
  const text = (input || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

function toRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex) || FALLBACK_ACCENT;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** WCAG relative luminance - what decides whether text on this colour should
 * be white or near-black. A mid-green button with white text is unreadable;
 * guessing by "is it a dark colour" is what gets that wrong. */
export function luminance(hex: string): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const NEAR_BLACK = "#0b0b0f";
const WHITE = "#ffffff";

/** WCAG contrast ratio between two colours, 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Black or white on this background - whichever actually has more contrast,
 * measured, not guessed from "is it a dark colour".
 *
 * A fixed luminance cutoff was tried first and got two of the eight real
 * property logos wrong: Marasca Samui's gold (#bd9a5d) came out white-on-gold
 * at 2.64:1, below AA even for large text, where black gives 7.95:1. Picking
 * the better of the two is also self-limiting - the worst case is the
 * crossover point, and that is still 4.58:1, i.e. AA for text of any size
 * whatever colour someone chooses.
 */
export function readableTextOn(hex: string): string {
  return contrastRatio(hex, NEAR_BLACK) >= contrastRatio(hex, WHITE) ? NEAR_BLACK : WHITE;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Same hue, nudged toward black or white - the hover state of a button. */
function shift(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const move = (v: number) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${move(r)}, ${move(g)}, ${move(b)})`;
}

/**
 * The CSS custom properties one accent colour produces.
 *
 * It drives BOTH `--kiosk-inverse-bg` (the filled buttons - Check In, Next,
 * Use address) and `--kiosk-accent` (focus rings, links), because "the
 * button colour" is what was asked for and the two would look unrelated if
 * only one moved. Applied as an inline style on the kiosk root, so it
 * overrides globals.css for these screens without touching the rest of the
 * app.
 */
export function accentCssVars(accent: string, isDark: boolean): Record<string, string> {
  const hex = normalizeHex(accent) || FALLBACK_ACCENT;
  const text = readableTextOn(hex);
  return {
    "--kiosk-accent": hex,
    "--kiosk-accent-soft": withAlpha(hex, isDark ? 0.2 : 0.12),
    "--kiosk-inverse-bg": hex,
    // Toward white on a dark theme, toward black on light - so the hover is
    // visibly different whatever colour was chosen.
    "--kiosk-inverse-bg-hover": shift(hex, isDark ? 0.08 : -0.08),
    "--kiosk-inverse-bg-disabled": withAlpha(hex, 0.25),
    "--kiosk-inverse-text": text,
  } as Record<string, string>;
}

/**
 * The dominant BRAND colour of a logo, read off the image itself.
 *
 * Not simply the most common pixel: a logo is mostly its background, so
 * near-white, near-black, transparent and washed-out pixels are dropped and
 * the most common of what is LEFT wins - which is the ink, not the paper.
 * Colours are bucketed coarsely (16 levels per channel) so anti-aliased
 * edges group with the solid colour they are fringing instead of splitting
 * the vote between a hundred near-identical shades.
 *
 * Resolves to null rather than throwing on anything that can go wrong (the
 * image not loading, a cross-origin read tainting the canvas, a logo that is
 * genuinely all greyscale) - the caller falls back.
 */
export async function dominantLogoColor(imageUrl: string): Promise<string | null> {
  if (typeof window === "undefined" || !imageUrl) return null;
  try {
    const image = new Image();
    // Supabase's public buckets send Access-Control-Allow-Origin, so the
    // canvas stays readable. Without this the read throws a SecurityError.
    image.crossOrigin = "anonymous";
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = imageUrl;
    });
    if (!loaded || !image.naturalWidth) return null;

    // Downscaled first: a logo's colour doesn't need a million samples, and
    // this keeps it to a couple of milliseconds.
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;                                   // transparent
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 240 && min > 240) continue;                    // paper
      if (max < 32) continue;                                  // near-black
      if (max - min < 28 && !(max < 200 && max > 60)) continue; // grey, unless a solid mid-grey mark
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const bucket = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      counts.set(key, bucket);
    }
    if (!counts.size) return null;

    let best = { n: 0, r: 0, g: 0, b: 0 };
    for (const bucket of counts.values()) if (bucket.n > best.n) best = bucket;
    // The bucket's own average, not the bucket's corner - closer to the real ink.
    const hex = (v: number) => Math.round(v / best.n).toString(16).padStart(2, "0");
    return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
  } catch {
    return null;
  }
}
