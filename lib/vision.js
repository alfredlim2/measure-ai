// How OpenAI resizes an input image, per model and detail level (from the "Images and vision" guide, 2026-10-11).
// The app renders each sheet straight from the PDF at the size the model will actually use (never above 200 DPI),
// so nothing is wasted on pixels OpenAI would throw away, and fine linework is drawn sharp instead of downsampled.
//   maxDim  : longest side allowed (OpenAI fits the image inside maxDim × maxDim)
//   budget  : patch budget (32 × 32 px patches); larger images are shrunk to fit it
//   reject  : patch count that makes OpenAI refuse the image instead of resizing it
//   tiles   : older tile-based models (fit 2048 × 2048, then shortest side 768)
//   mult    : image tokens = ceil(patches × mult)
//   assumed : not listed in the guide; treated like the closest listed family (the run log says so)
const VISION = [
  { re: /^gpt-6-astra/i, mult: 1.2, original: { maxDim: 65535, reject: 30000 }, high: { maxDim: 65535, budget: 2500 } },
  { re: /^gpt-6/i, mult: 1.2, original: { maxDim: 65535, reject: 30000 }, high: { maxDim: 65535, budget: 2500 }, assumed: 'gpt-6 family (as gpt-6-astra)' },
  { re: /^gpt-5\.6/i, mult: 1.2, original: { maxDim: 65535, reject: 30000 }, high: { maxDim: 2048, budget: 2500 } },
  { re: /^gpt-5\.5/i, mult: 1.2, original: { maxDim: 6000, budget: 10000 }, high: { maxDim: 2048, budget: 2500 } },
  { re: /^gpt-5\.4/i, mult: 1.2, original: { maxDim: 6000, budget: 10000 }, high: { maxDim: 2048, budget: 2500 } },
  { re: /^(gpt-5\.2|gpt-4\.1-mini)/i, mult: 1.2, original: null, high: { maxDim: 2048, budget: 6144 } },
  { re: /^(gpt-5\.1|gpt-4\.1|gpt-4o)/i, tiles: true, original: null, high: { maxDim: 2048, shortSide: 768 } },
];
// Models not in the table: assume the safest common limit (fit 2048, 2,500 patches) so nothing is rejected.
const FALLBACK = { mult: 1.2, original: { maxDim: 6000, budget: 10000 }, high: { maxDim: 2048, budget: 2500 }, assumed: 'unknown model (cautious limits)' };

// Table as plain JSON for the browser (regexes as strings).
const table = () => ({ rows: VISION.map(v => ({ ...v, re: v.re.source })), fallback: FALLBACK });

module.exports = { VISION, FALLBACK, table };
