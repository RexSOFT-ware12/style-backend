// AI background removal (salient-object segmentation) with ONNX Runtime.
//
// Default model: ISNet "general use" (DIS project, Apache-2.0), the same weights rembg uses. It handles photos of
// people, garments on mannequins and flat-lays on busy surfaces. The first request downloads the model once
// (~170 MB) into BG_MODEL_DIR; run `npm run fetch-bg-model` to do it ahead of time.
//
// Env: BG_MODEL=isnet-general-use | u2netp (small, lower quality)   BG_MODEL_DIR=/path/to/models
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const sharp = require('sharp');

const BASE = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';
const MODELS = {
  'isnet-general-use': { size: 1024, std: [1, 1, 1] },
  u2netp: { size: 320, std: [0.229, 0.224, 0.225] },
};
const MEAN = [0.485, 0.456, 0.406];
const MAX_SIDE = 3000;                               // larger photos are scaled down before processing
const EDGES = { soft: [0, 1], balanced: [0.08, 0.92], crisp: [0.25, 0.75] };

const name = MODELS[process.env.BG_MODEL] ? process.env.BG_MODEL : 'isnet-general-use';
const cfg = MODELS[name];
const dir = process.env.BG_MODEL_DIR || path.join(__dirname, '..', '..', 'models');
const file = path.join(dir, `${name}.onnx`);

let ort = null; let session = null; let loading = null; let downloading = null;
const unavailable = (message, code) => Object.assign(new Error(message), { status: 503, code });

async function download() {
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(`${BASE}/${name}.onnx`, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status}).`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
}

function startDownload() {
  if (!downloading) {
    downloading = download().catch((e) => { console.error('[bg-remove] model download failed:', e.message); }).finally(() => { downloading = null; });
  }
  return downloading;
}

async function getSession() {
  if (session) return session;
  if (!fs.existsSync(file)) {
    startDownload();
    throw unavailable('The cut-out model is being downloaded for the first time. Please try again in a few minutes.', 'MODEL_DOWNLOADING');
  }
  if (!loading) {
    loading = (async () => {
      try { ort = require('onnxruntime-node'); } catch { throw unavailable('Background removal is not installed on the server (onnxruntime-node).', 'MODEL_RUNTIME_MISSING'); }
      session = await ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all' });
      return session;
    })().finally(() => { loading = null; });
  }
  return loading;
}

let chain = Promise.resolve();                       // one inference at a time keeps memory predictable
const queued = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

const smooth = (t) => t * t * (3 - 2 * t);

async function removeBackground(inputPath, { edges = 'balanced' } = {}) {
  const s = await getSession();
  return queued(async () => {
    const { data: rgb, info } = await sharp(inputPath).rotate().removeAlpha()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
    const S = cfg.size;
    const small = await sharp(rgb, { raw: { width: info.width, height: info.height, channels: 3 } }).resize(S, S, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();

    let max = 1e-6; for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
    const plane = S * S; const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) input[c * plane + i] = (small[i * 3 + c] / max - MEAN[c]) / cfg.std[c];

    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
    const pred = out[s.outputNames[0]].data;
    let lo = Infinity; let hi = -Infinity; for (let i = 0; i < plane; i++) { if (pred[i] < lo) lo = pred[i]; if (pred[i] > hi) hi = pred[i]; }
    const mask = Buffer.alloc(plane); const span = hi - lo || 1;
    for (let i = 0; i < plane; i++) mask[i] = Math.round(((pred[i] - lo) / span) * 255);

    const grown = await sharp(mask, { raw: { width: S, height: S, channels: 1 } }).resize(info.width, info.height, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    const stride = grown.info.channels; const alpha = new Uint8Array(info.width * info.height);   // sharp may hand back more than one channel
    for (let i = 0; i < alpha.length; i++) alpha[i] = grown.data[i * stride];
    const [a0, a1] = EDGES[edges] || EDGES.balanced; const rgba = Buffer.alloc(info.width * info.height * 4);
    for (let i = 0; i < alpha.length; i++) {
      const t = Math.min(1, Math.max(0, (alpha[i] / 255 - a0) / (a1 - a0)));
      rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = Math.round(smooth(t) * 255);
    }
    return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 6 }).toBuffer();
  });
}

module.exports = { removeBackground, startDownload, modelName: name, modelFile: file };
