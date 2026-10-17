import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: false,
  // `yarn build:demo` writes to build/demo; every other build keeps the default.
  buildDirectory: process.env.BUILD_DIR ?? "build",
} satisfies Config;
