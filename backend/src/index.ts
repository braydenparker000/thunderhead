// Worker entry: the HTTP app, the cron, and the Durable Object classes (exported by name, as
// wrangler.jsonc's bindings and migrations expect).
import { app } from './app';
import { runCron } from './areas/ops/cron';

export { Auth } from './objects/auth';
export { Core } from './objects/core';
export { Library } from './objects/library';
export { Music } from './objects/music';
export { Senses } from './objects/senses';

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;
