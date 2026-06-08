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
