/**
 * Reads text from a bill photo entirely on the device (tesseract.js,
 * self-hosted under /ocr). The photo never leaves the phone for this step.
 */
declare global {
  interface Window {
    Tesseract?: { createWorker: (langs: string[], oem: number, options: object) => Promise<OcrWorker> };
  }
}
interface OcrWorker {
  recognize(image: Blob | HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<void>;
}

let scriptLoad: Promise<void> | undefined;
function loadScript(): Promise<void> {
  scriptLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/ocr/tesseract.min.js';
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoad = undefined;
      reject(new Error('ocr_load_failed'));
    };
    document.head.appendChild(s);
  });
  return scriptLoad;
}

/** App language → Tesseract model. English is always loaded alongside. */
const MODEL: Record<string, string> = { vi: 'vie', fr: 'fra', de: 'deu', nl: 'nld' };

let workerPromise: Promise<OcrWorker> | undefined;
let workerLangs = '';
let progressListener: ((p: number, stage: string) => void) | undefined;

export async function readTextFromImage(file: Blob, locale: string, onProgress?: (p: number, stage: string) => void): Promise<string> {
  progressListener = onProgress;
  onProgress?.(0, 'loading');
  await loadScript();
  const langs = ['eng', ...(MODEL[locale] ? [MODEL[locale]!] : [])];
  if (workerLangs !== langs.join('+')) {
    void workerPromise?.then((w) => w.terminate()).catch(() => {});
    workerPromise = undefined;
    workerLangs = langs.join('+');
  }
  workerPromise ??= window.Tesseract!.createWorker(langs, 1, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      const stage = m.status.includes('recogniz') ? 'reading' : 'loading';
      progressListener?.(m.progress ?? 0, stage);
    },
  }).catch((err) => {
    workerPromise = undefined;
    throw err;
  });
  const worker = await workerPromise;
  const { data } = await worker.recognize(await upscaleForOcr(file));
  return data.text;
}

/** Small photos read badly; make sure text is reasonably large, and greyscale it. */
async function upscaleForOcr(file: Blob): Promise<HTMLCanvasElement | Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest < 1800 ? 1800 / longest : longest > 3000 ? 3000 / longest : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.filter = 'grayscale(1) contrast(1.25)';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  } catch {
    return file;
  }
}
