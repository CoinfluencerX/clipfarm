/** Output frame for every platform's vertical feed. */
export const OUT_WIDTH = 1080;
export const OUT_HEIGHT = 1920;

export interface Crop {
  w: number;
  h: number;
  x: number;
  y: number;
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * The 9:16 window to cut out of the source frame.
 * `focusX` is where the subject sits horizontally, 0 (left) to 1 (right). 0.5 is a centre crop;
 * face tracking (M4) feeds a per-clip value in.
 */
export function cropFor916(srcW: number, srcH: number, focusX = 0.5): Crop {
  if (srcW * OUT_HEIGHT > srcH * OUT_WIDTH) {
    // Wider than 9:16 (the normal case, 16:9 footage): keep full height, cut the sides.
    const w = Math.min(even((srcH * OUT_WIDTH) / OUT_HEIGHT), even(srcW));
    const x = Math.round(Math.min(Math.max(focusX * srcW - w / 2, 0), srcW - w));
    return { w, h: even(srcH), x, y: 0 };
  }
  // Already 9:16 or taller: keep full width, trim top and bottom evenly.
  const h = Math.min(even((srcW * OUT_HEIGHT) / OUT_WIDTH), even(srcH));
  return { w: even(srcW), h, x: 0, y: Math.round((srcH - h) / 2) };
}
