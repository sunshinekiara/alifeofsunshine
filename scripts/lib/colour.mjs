/**
 * Display P3 -> sRGB conversion for the web-masters pipeline (DESIGN-SYSTEM.md §9.1).
 *
 * Why this file exists at all: 45 of Sunshine's 55 PNGs carry a Display P3 profile
 * (Procreate on iPad). §9.1 says the pipeline must convert to sRGB or "a Display-P3 PNG
 * from Procreate will render dull in Chrome on Android".
 *
 * §9.1 names `sharp().toColorspace('srgb')` for this, but that call only sets the output
 * interpretation — it does not transform pixels. Measured on Inner_Child.png against a
 * ground-truth matrix transform: `toColourspace('srgb')` and `withIccProfile('srgb')` both
 * changed 0 pixels, and `pipelineColourspace('rgb16').withIccProfile('srgb')` changed them
 * by a mean of 0.55/255 (16-bit rounding) where a real conversion moves them 2.69/255 with
 * a max of 22. `withIccProfile('srgb')` alone is actively harmful: it stamps an sRGB tag
 * onto untransformed P3 pixels, so a viewer stops compensating and the file renders wrong.
 *
 * So the transform is done here, explicitly, in linear light:
 *   pipelineColourspace('scrgb')  linearise using the sRGB TRC, which Display P3 shares
 *   recomb(M)                     P3 linear -> sRGB linear
 *   toColourspace('srgb')         re-apply the sRGB TRC
 * Display P3 is a matrix/TRC profile (536 bytes, no lookup tables), so a matrix applied in
 * linear light is exactly what a CMM does for relative-colorimetric intent, not an
 * approximation. Out-of-gamut values clip at 8-bit, which is the standard behaviour.
 *
 * The matrix is derived from the primaries below rather than pasted, and asserted at import.
 */

/** xy chromaticities. Both spaces are D65, so no chromatic adaptation is needed. */
const D65 = { x: 0.3127, y: 0.3290 };
const DISPLAY_P3 = {
  r: { x: 0.680, y: 0.320 },
  g: { x: 0.265, y: 0.690 },
  b: { x: 0.150, y: 0.060 },
  w: D65,
};
const SRGB = {
  r: { x: 0.640, y: 0.330 },
  g: { x: 0.300, y: 0.600 },
  b: { x: 0.150, y: 0.060 },
  w: D65,
};

const mul = (A, B) =>
  A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));

function inverse3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('singular matrix');
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/** Linear RGB -> XYZ for a space defined by xy primaries and white point. */
function rgbToXyz({ r, g, b, w }) {
  const xyz = ({ x, y }) => [x / y, 1, (1 - x - y) / y];
  const M = [xyz(r), xyz(g), xyz(b)];      // rows are per-primary
  const Mt = [0, 1, 2].map((i) => M.map((row) => row[i])); // columns
  const W = xyz(w);
  const S = mul(inverse3(Mt), [[W[0]], [W[1]], [W[2]]]).map((row) => row[0]);
  return Mt.map((row) => row.map((v, j) => v * S[j]));
}

/** Display P3 linear -> sRGB linear. */
export const P3_TO_SRGB = mul(inverse3(rgbToXyz(SRGB)), rgbToXyz(DISPLAY_P3));

// White must map to white or her cream paper would shift. Assert it at import time.
for (const [i, row] of P3_TO_SRGB.entries()) {
  const sum = row.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`P3_TO_SRGB row ${i} sums to ${sum}, not 1 — white would not stay white`);
  }
}

/** ICC `desc` tag, so the pipeline can tell a P3 file from an sRGB one. */
export function iccDescription(buf) {
  if (!buf || buf.length < 132) return null;
  const count = buf.readUInt32BE(128);
  for (let i = 0; i < count; i++) {
    const off = 132 + i * 12;
    if (off + 12 > buf.length) break;
    if (buf.toString('ascii', off, off + 4) !== 'desc') continue;
    const o = buf.readUInt32BE(off + 4);
    const size = buf.readUInt32BE(off + 8);
    const type = buf.toString('ascii', o, o + 4);
    if (type === 'mluc') {
      const n = buf.readUInt32BE(o + 20);
      const so = buf.readUInt32BE(o + 24);
      const be = Buffer.from(buf.subarray(o + so, o + so + n));
      be.swap16(); // ICC stores UTF-16BE
      return be.toString('utf16le').replace(/\0/g, '').trim();
    }
    return buf.toString('ascii', o + 12, o + size).replace(/\0/g, '').trim();
  }
  return null;
}

/** How a given input profile should be handled. */
export function colourPlan(iccBuffer) {
  const desc = iccDescription(iccBuffer);
  if (!iccBuffer) return { action: 'assume-srgb', profile: 'none' };
  if (/display p3|dci.?p3|^p3$/i.test(desc ?? '')) return { action: 'p3-to-srgb', profile: desc };
  if (/srgb/i.test(desc ?? '')) return { action: 'already-srgb', profile: desc };
  return { action: 'unknown', profile: desc ?? `unnamed ${iccBuffer.length}B profile` };
}
