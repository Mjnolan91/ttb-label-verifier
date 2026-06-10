/**
 * icons.tsx — small inline status/UI icons. Crisper and more consistent than Unicode glyphs, with
 * no icon-library dependency. All are DECORATIVE: aria-hidden + focusable=false, stroke=currentColor
 * so they inherit the surrounding text color. The adjacent text label is always the accessible name
 * (WCAG 1.4.1 is satisfied by the text, never the icon alone).
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconPass(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8.5" />
    </Svg>
  );
}

export function IconFail(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l8 8M14 6l-8 8" />
    </Svg>
  );
}

export function IconReview(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 3.2l7 12.3H3z" />
      <path d="M10 8.2v3.4" />
      <path d="M10 14.1h.01" strokeWidth={2.5} />
    </Svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 13.5V4M6.5 7.5L10 4l3.5 3.5" />
      <path d="M4 13v2.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V13" />
    </Svg>
  );
}

export function IconSpinner(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10 2.5a7.5 7.5 0 107.5 7.5" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  );
}

export function IconZoom(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.5 12.5L17 17" />
    </Svg>
  );
}

/**
 * IconPhoto — a camera glyph for the "values match, just confirm the photo read" field state. Calm and
 * distinct from the IconReview hazard triangle, so a confidence-gated match never wears the alarm icon.
 */
export function IconPhoto(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5l1.2-2h3l1.3-1.6h2l1.3 1.6h3l1.2 2v7.5a1 1 0 01-1 1H4.5a1 1 0 01-1-1V7.5z" />
      <circle cx="10" cy="11.2" r="2.6" />
    </Svg>
  );
}

/**
 * IconUsFlag — a small US flag for the "TTB compliance" eyebrow (TTB is a U.S. federal agency). Drawn
 * with explicit fills (not currentColor) since a flag is multicolor; decorative (aria-hidden), the
 * adjacent text carries the meaning.
 */
export function IconUsFlag({ className = "" }: { className?: string }) {
  const h = 20 / 13; // 13 stripes across a 38x20 (1.9:1) field
  const redStripes = [0, 2, 4, 6, 8, 10, 12];
  const starCols = [2.4, 5.5, 8.6, 11.7];
  const starRows = [1.5, 3.9, 6.3];
  return (
    <svg
      viewBox="0 0 38 20"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect width="38" height="20" fill="#ffffff" />
      {redStripes.map((i) => (
        <rect key={i} y={i * h} width="38" height={h} fill="#b22234" />
      ))}
      <rect width="15.2" height={7 * h} fill="#3c3b6e" />
      {starRows.map((cy) => starCols.map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.62" fill="#ffffff" />))}
    </svg>
  );
}

/** IconSun / IconMoon — the light/dark theme toggle glyphs. */
export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6L14 6M6 14l-1.4 1.4" />
    </Svg>
  );
}
export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M16 11.6A6.4 6.4 0 118.4 4a5 5 0 007.6 7.6z" />
    </Svg>
  );
}

/** IconHelp — the header help-panel trigger glyph (question mark in a circle). */
export function IconHelp(props: IconProps) {
  return (
    <Svg strokeWidth={1.8} {...props}>
      <circle cx="10" cy="10" r="7.6" />
      <path d="M7.9 7.7a2.1 2.1 0 113.3 1.8c-.7.5-1.2.9-1.2 1.9" />
      <path d="M10 14.3h.01" strokeWidth={2.6} />
    </Svg>
  );
}
