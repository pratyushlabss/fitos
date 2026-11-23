// Static film grain plus the shared 1-bit dither filter. Rendered once, never animated.
export function Texture() {
  return (
    <>
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          <filter id="fitos-dither" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" />
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="noise" />
            <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
            <feComposite in="SourceGraphic" in2="mono" operator="arithmetic" k1="0" k2="1" k3="0.45" k4="-0.22" />
            <feComponentTransfer>
              <feFuncR type="discrete" tableValues="0 1" />
              <feFuncG type="discrete" tableValues="0 1" />
              <feFuncB type="discrete" tableValues="0 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <svg aria-hidden="true" className="grain h-full w-full">
        <filter id="fitos-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#fitos-grain)" />
      </svg>
    </>
  );
}
