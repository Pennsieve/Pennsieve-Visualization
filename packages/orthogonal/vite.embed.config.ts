import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { copyFileSync } from "fs";

// App-mode build for the embeddable orthogonal viewer.
// Produces a self-contained static app (HTML + JS/CSS/workers/WASM)
// deployable to S3/CloudFront and loaded inside an iframe.

// Copy sw.js to dist-embed/ after build. The service worker must remain
// a standalone file (not bundled) so the browser can register it.
const copyServiceWorker = () => ({
  name: "copy-sw",
  closeBundle() {
    copyFileSync(
      resolve(__dirname, "src/sw.js"),
      resolve(__dirname, "dist-embed/sw.js")
    );
  },
});

// Dev-only: store CloudFront signing params in memory and provide
// a same-origin proxy to assets.pennsieve.net, avoiding CORS issues.
const assetProxy = () => ({
  name: "asset-proxy",
  configureServer(server: any) {
    let cfParams = "";

    // Receive signing params from EmbedApp via POST
    server.middlewares.use("/cf-params", (req: any, res: any, next: any) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          cfParams = body;
          res.writeHead(200);
          res.end("ok");
        });
      } else {
        next();
      }
    });

    // Proxy /cf-proxy/path → https://assets.pennsieve.net/path?signing-params
    server.middlewares.use("/cf-proxy", async (req: any, res: any, next: any) => {
      const path = (req.url || "/").replace(/^\/cf-proxy/, "");
      if (!path) return next();
      const separator = path.includes("?") ? "&" : "?";
      const target = `https://assets.pennsieve.net${path}${cfParams ? separator + cfParams : ""}`;
      try {
        const upstream = await fetch(target);
        res.writeHead(upstream.status, {
          "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
        });
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.end(buffer);
      } catch (err: any) {
        res.writeHead(502);
        res.end(err.message);
      }
    });
  },
});

export default defineConfig({
  plugins: [vue(), copyServiceWorker(), assetProxy()],
  root: __dirname,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  esbuild: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    entries: [
      "embed.html",
      "node_modules/neuroglancer/lib/main.bundle.js",
      "node_modules/neuroglancer/lib/async_computation.bundle.js",
      "node_modules/neuroglancer/lib/chunk_worker.bundle.js",
    ],
    exclude: ["neuroglancer"],
  },
  build: {
    outDir: resolve(__dirname, "dist-embed"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2 * 1024 * 1024,
    rollupOptions: {
      input: resolve(__dirname, "embed.html"),
    },
  },
});
