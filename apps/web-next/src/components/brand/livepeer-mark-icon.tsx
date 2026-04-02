import type { SVGProps } from 'react';

/**
 * Livepeer logomark (symbol only) — geometry matches app favicon / brand kit.
 * Use fill via currentColor for theme-aware UI.
 */
export function LivepeerMarkIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 332 403"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0.0168457 0.377075L0.0168488 71.4047H71.0445L71.0445 0.377075H0.0168457ZM130.372 83.0974V154.125H201.4L201.4 83.0974H130.372ZM260.972 236.377V165.349H332V236.377H260.972ZM130.372 248.562V319.59H201.4L201.4 248.562H130.372ZM0.0168488 402.31L0.0168457 331.283H71.0445L71.0445 402.31H0.0168488ZM0.0168457 165.818L0.0168488 236.846H71.0445L71.0445 165.818H0.0168457Z"
        fill="currentColor"
      />
    </svg>
  );
}
