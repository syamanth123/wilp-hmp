/**
 * The app's global stylesheet sets every h1–h3 to the serif display font. A
 * handout shown INSIDE the app (editor page, Preview) must look like the
 * published PDF, which uses Arial throughout, so headings inside a handout get
 * the handout's own font back. Host-side only: the renderer's output is not
 * touched (handout-editor-ux D1).
 */
export const HANDOUT_HOST_CSS = `
.bits-handout h1, .bits-handout h2, .bits-handout h3 { font-family: Arial, Helvetica, sans-serif; letter-spacing: normal; }
`;
