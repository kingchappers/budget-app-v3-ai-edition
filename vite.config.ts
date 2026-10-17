import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Runs in every build, not only the demo one. src/store/index.ts lazily imports the DynamoDB and SQLite stores for the Lambda
// and the container. Rollup resolves the guarded demo import in app/entry.client.tsx even in normal builds, so the server stores
// must be stubbed for that resolution to succeed (otherwise node:sqlite fails the build). Nothing outside src/demo reaches
// src/store/index.ts in browser code, so the stub never ends up in a normal bundle.
function stubServerStores(): Plugin {
  const stub = path.resolve("src/demo/unavailableStore.ts");
  return {
    name: "stub-server-stores",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;
      const fromStoreIndex = /src[\\/]store[\\/]index\.ts$/.test(importer);
      if (fromStoreIndex && (source === "./dynamo" || source === "./sqlite")) return stub;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), stubServerStores()],
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..']
    }
  },
});
