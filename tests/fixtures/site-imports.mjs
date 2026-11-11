// The site's root-absolute imports (`/th/...`, as the browser resolves them) answered from
// frontend/, so a module that uses them can be loaded in Node: import this file first, then
// `await import()` the module (a static import would be resolved before this runs).
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = fileURLToPath(new URL('../../frontend', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    return /^\/(th|music|config\.js)/.test(specifier) ? next(pathToFileURL(FRONTEND + specifier).href, context) : next(specifier, context);
  },
});
