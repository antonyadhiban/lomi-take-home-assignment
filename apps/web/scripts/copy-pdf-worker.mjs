// pdf.js renders off the main thread; serve its worker as a plain static file so it
// works the same under webpack, Turbopack and on Vercel.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
const require = createRequire(import.meta.url);
mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
copyFileSync(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"), new URL("../public/pdf.worker.min.mjs", import.meta.url));
