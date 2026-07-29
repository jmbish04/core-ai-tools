// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { transform as esbuildTransform } from "esbuild";
import { defineConfig, sessionDrivers } from "astro/config";

/**
 * Downlevel decorators before rolldown/oxc sees them. The agents SDK's
 * Durable Objects use decorators (`@callable`); astro 7's oxc build leaves them
 * native, and workerd's V8 rejects the syntax ("Invalid or unexpected token").
 * esbuild transpiles them (as astro 5's build did). Scoped to project `.ts`
 * files that actually use a decorator, so it's a no-op for everything else.
 */
const transpileDecorators = {
  name: "transpile-decorators",
  enforce: "pre" as const,
  async transform(code: string, id: string) {
    if (id.includes("node_modules") || !/\.ts(\?|$)/.test(id)) return null;
    if (!/^\s*@[A-Za-z_]/m.test(code)) return null;
    const out = await esbuildTransform(code, {
      loader: "ts",
      target: "es2022",
      sourcemap: true,
      sourcefile: id,
    });
    return { code: out.code, map: out.map };
  },
};

const site = process.env.SITE ?? "http://localhost:4321";
const base = process.env.BASE || "/";

// https://astro.build/config
export default defineConfig({
  site,
  srcDir: "./src/frontend",
  base,
  output: "server",
  // Use the project's existing `SESSIONS` KV binding for Astro's session store.
  // Astro v6+ replaced the deprecated string `driver` signature with the
  // `sessionDrivers` factory; the old string form made astro inject a default
  // unnamed `SESSION` binding, which `wrangler deploy` then tried to provision
  // (colliding with an existing namespace). Binding by name reuses SESSIONS
  // (declared with an id in wrangler.jsonc) — no new namespace is created.
  session: {
    driver: sessionDrivers.cloudflareKVBinding({ binding: "SESSIONS" }),
  },
  adapter: cloudflare({
    imageService: "cloudflare",
    platformProxy: {
      enabled: true,
    },
    routes: {
      // Extend Cloudflare routes to include backend API routes
      extend: {
        include: ["/api/*"],
        exclude: [],
      },
    },
    // NOTE: @astrojs/cloudflare v14 REMOVED `workerEntryPoint`. The custom entry
    // + Durable Object exports now live in the file named by wrangler.jsonc
    // `main` (./src/_worker.ts): it imports `handle` from
    // "@astrojs/cloudflare/handler" for SSR and exports the DO classes directly.
    // `astro build` compiles that entry (resolving the adapter's virtual config)
    // and emits the deploy config wrangler uses.
  }),
  integrations: [react()],
  vite: {
    plugins: [
      // Downlevel decorators (agents SDK `@callable`) before oxc — see above.
      transpileDecorators as unknown as import("vite").Plugin,
      // Cast through the Vite plugin type to work around the current
      // Vite/@tailwindcss-vite HotUpdateOptions mismatch without dropping
      // type information entirely.
      tailwindcss() as unknown as import("vite").Plugin,
    ],
    // Explicitly externalize node built-in modules and Cloudflare-specific packages for SSR
    ssr: {
      external: [
        "node:fs/promises",
        "node:path",
        "node:url",
        "node:crypto",
        "node:buffer",
        "node:stream",
        "node:util",
        "agents",
        "cloudflare:workers",
      ],
    },
  },
});
