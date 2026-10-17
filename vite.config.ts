import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const demo = process.env.VITE_DEMO === "true";

// Only in the demo build: src/store/index.ts lazily imports the DynamoDB and SQLite stores for the Lambda and the container.
// The browser never needs them, so they are replaced by a stub and never reach the bundle.
function stubServerStores(): Plugin {
  const stub = path.resolve("src/demo/unavailableStore.ts");
  return {
    name: "demo-stub-server-stores",
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
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), ...(demo ? [stubServerStores()] : [])],
  server: {
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..']
    }
  },
});
