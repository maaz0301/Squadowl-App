import type { ThemeColors } from '@/theme/tokens';

/**
 * Colour maths for team branding. A team's brand colour is an arbitrary
 * "#RRGGBB" a club picked to match its jersey, so nothing about it can be
 * assumed — not its lightness, not its contrast against the app theme. These
 * helpers derive every surface the team screens paint from that one value, so
 * a pale yellow and a near-black navy both stay readable.
 */

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function toHex([r, g, b]: [number, number, number]): string {
  const part = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Theme colours arrive as hex in some slots and rgba() in others (borders).
 * Only hex is blendable, so callers pass a hex base; anything else falls back
 * to the brand colour unmixed rather than rendering as transparent black.
 */
export function mixHex(a: string, b: string, amountOfA: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const t = Math.max(0, Math.min(1, amountOfA));
  return toHex([
    ca[0] * t + cb[0] * (1 - t),
    ca[1] * t + cb[1] * (1 - t),
    ca[2] * t + cb[2] * (1 - t),
  ]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/**
 * Black or white ink, whichever reads better on `hex`. The 0.4 threshold sits
 * above the usual 0.179 midpoint on purpose: these surfaces carry small
 * secondary text as well as headings, and mid-tone brand colours (the mid
 * blues and greens clubs pick most often) are more legible with dark ink.
 */
export function readableInkOn(hex: string): string {
  return luminance(hex) > 0.4 ? '#0d1629' : '#ffffff';
}

export interface TeamBrandSurfaces {
  /** Whether the team actually set a colour. False = every field is the plain theme. */
  branded: boolean;
  /** Fills the entire team screen behind everything else. */
  screenBg: string;
  /** The identity banner — the strongest statement of the colour. */
  bannerBg: string;
  /** Cards and tiles sitting on screenBg; tinted enough to belong, light enough to read. */
  cardBg: string;
  /** Row/tile fills one step up from cardBg. */
  tileBg: string;
  ink: string;
  inkMuted: string;
  border: string;
  /** Ink that reads on bannerBg specifically, which is far more saturated than screenBg. */
  bannerInk: string;
  bannerInkMuted: string;
}

/**
 * Every surface a team-branded screen needs, derived from the team's colour and
 * the active theme. Unbranded teams get the theme back unchanged, so callers
 * can use this unconditionally instead of branching at each call site.
 */
export function teamBrandSurfaces(brandColor: string | undefined | null, colors: ThemeColors): TeamBrandSurfaces {
  if (!brandColor || !parseHex(brandColor)) {
    return {
      branded: false,
      screenBg: colors.bg,
      bannerBg: colors.tile,
      cardBg: colors.bgSecondary,
      tileBg: colors.tile,
      ink: colors.ink,
      inkMuted: colors.inkMuted,
      border: colors.border,
      bannerInk: colors.ink,
      bannerInkMuted: colors.inkMuted,
    };
  }

  // The background carries the colour across the whole screen while staying a
  // background — a light, transparent-reading tint of the theme rather than a
  // heavy wash that competes with it. 0.34 read as a near-solid dark maroon on
  // saturated colours; 0.14 keeps the same colour identifiable while the dark
  // theme still dominates, so the header, banner, and body all read as one
  // consistent surface instead of the tint standing out as its own block.
  // Cards/tiles get an even lighter touch so they separate from the wash
  // instead of dissolving into it.
  const screenBg = mixHex(brandColor, colors.bg, 0.14);
  const cardBg = mixHex(brandColor, colors.bgSecondary, 0.06);
  const tileBg = mixHex(brandColor, colors.tile, 0.09);
  const ink = readableInkOn(screenBg);
  const bannerInk = readableInkOn(brandColor);

  return {
    branded: true,
    screenBg,
    bannerBg: brandColor,
    cardBg,
    tileBg,
    ink,
    // Derived from the resolved ink rather than a theme token: the theme's muted
    // colour is tuned for the theme's background, not for an arbitrary wash.
    inkMuted: `${ink}b0`,
    border: `${ink}24`,
    bannerInk,
    bannerInkMuted: `${bannerInk}b3`,
  };
}
