/** Detect yellow background from a PDF.js-rendered page. */
export interface PixelImage { data: Uint8ClampedArray; width: number; height: number }
export interface PixelRect { x: number; y: number; width: number; height: number }
export function hasYellowBackground(image: PixelImage, box: PixelRect): boolean {
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(image.width, Math.ceil(box.x + box.width));
  const y1 = Math.min(image.height, Math.ceil(box.y + box.height));
  if (x1 - x0 < 2 || y1 - y0 < 2) return false;
  let yellow = 0, total = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * image.width + x) * 4;
    const r = image.data[i], g = image.data[i+1], b = image.data[i+2];
    if (r > 180 && g > 170 && b < 135 && r > b * 1.4 && g > b * 1.25) yellow++;
    total++;
  }
  return yellow >= 6 && yellow / total >= 0.018;
}
