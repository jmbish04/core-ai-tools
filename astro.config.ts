// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, sessionDrivers } from "astro/config";

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
