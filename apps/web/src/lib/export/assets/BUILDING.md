# Export assets — how they're built

Server-read PNGs embedded into the Word/PDF export (`build-docx.ts`). Not web-served.

## `bits-header.png` — letterhead logo

The multi-campus BITS banner, extracted from a real corpus `.docx` header
(`word/media/image1.png`). Used full-opacity at the top of the document header.

## `bits-watermark.png` — per-page watermark (⚠ pre-faded to 12% alpha)

**This asset is NOT a plain copy of the logo — its alpha is baked to 12%.** `docx`
has no image-opacity option, so the faintness must live in the PNG itself. If you
re-export the watermark from a full-opacity source, **the alpha is lost** and the
watermark will render as a solid crest that obscures text. Re-bake it.

### How it was baked

No image library (sharp/jimp/pngjs) is installed, so the fade is done once via
Playwright/Chromium's canvas `globalAlpha` (Playwright is already a devDep):

```ts
// run with the dev server up (serves /bits-logo.png); see git history for the script
const dataUrl = await page.evaluate(async () => {
  const img = new Image();
  await new Promise<void>((r) => {
    img.onload = () => r();
    img.src = '/bits-logo.png';
  });
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.globalAlpha = 0.12; // ← the bake
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
});
// write Buffer.from(base64, 'base64') → bits-watermark.png
```

Verify the bake numerically (don't eyeball — a black-matte viewer exaggerates
alpha): decode + `getImageData`, the **max alpha across all pixels must be ≈ 31**
(= 0.12 × 255). If it's ~255, the fade didn't apply.

### Tuning

Screen alpha and print alpha don't always agree — print can render lighter. If a
downloaded PDF reads as _too faint_ on paper, re-bake at **0.14–0.15** and
re-verify (max alpha ≈ 36–38). This is the EC2 print-check follow-up.
