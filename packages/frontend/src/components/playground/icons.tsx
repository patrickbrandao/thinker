import type { SVGProps } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className,
  };
}

/**
 * Small set of inline SVG icons for the Playground page (self-hosted: the CSP
 * disallows icon CDNs). Kept for their props contract; new code can use
 * lucide-react directly.
 */

export const XIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

export const PlusIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

export const TrashIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export const HistoryIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 3v5h5" />
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export const CodeIcon = ({ size = 16, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M16 18l6-6-6-6" />
    <path d="M8 6l-6 6 6 6" />
  </svg>
);
