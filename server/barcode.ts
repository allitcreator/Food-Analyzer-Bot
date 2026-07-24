/**
 * Deterministic barcode decoding from photos.
 *
 * Uses the zxing-wasm reader to actually decode EAN/UPC barcodes from image
 * pixels instead of asking a vision model to "read" the digits (which
 * hallucinates and yields wrong products from Open Food Facts).
 *
 * zxing-wasm is ESM-only while the server is bundled to CJS by esbuild, so the
 * import MUST stay dynamic (`await import(...)`) and the package MUST remain
 * external (do NOT add it to the allowlist in script/build.ts).
 */

/**
 * Decode the first EAN-13 / EAN-8 / UPC-A / UPC-E barcode found in an image.
 * Returns the numeric code, or null if none is found / on any error.
 */
export async function decodeBarcodeFromImage(imageBuffer: Buffer): Promise<string | null> {
  try {
    const { readBarcodes } = await import("zxing-wasm/reader");
    const results = await readBarcodes(imageBuffer, {
      formats: ["EAN-13", "EAN-8", "UPC-A", "UPC-E"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });
    for (const result of results) {
      if (result.text && result.text.trim()) return result.text;
    }
    return null;
  } catch (error) {
    console.error("Barcode Decode Error:", error);
    return null;
  }
}

/**
 * Validate the check digit of an EAN-13 / EAN-8 / UPC-A (12-digit) code.
 * Uses the standard GTIN algorithm: from the rightmost data digit, weights
 * alternate 3, 1, 3, 1, … and the check digit closes the sum to a multiple of 10.
 */
export function isValidEanChecksum(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (code.length !== 8 && code.length !== 12 && code.length !== 13) return false;

  const digits = code.split("").map(Number);
  const check = digits[digits.length - 1];

  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight;
  }
  const computed = (10 - (sum % 10)) % 10;

  return computed === check;
}
