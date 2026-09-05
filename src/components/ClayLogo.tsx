import type { CSSProperties } from "react";

/**
 * The Clay wordmark, black on light themes and white on dark. Both images are
 * in the DOM; globals.css shows the one matching <html data-theme>.
 */
export function ClayLogo({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/Clay_Logo_3D_Blk.png" alt="Clay" className={`${className} theme-light-only`} style={style} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/Clay_Logo_3D_Wht.png" alt="Clay" className={`${className} theme-dark-only`} style={style} />
    </>
  );
}
