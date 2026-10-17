import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

async function main(): Promise<void> {
  // The constant is replaced at build time. It is false everywhere except `yarn build:demo`, so this import (and the whole demo
  // backend behind it) is removed from every other build.
  if (import.meta.env.VITE_DEMO === "true") {
    const { startDemo } = await import("./demo/start");
    await startDemo();
  }

  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    );
  });
}

void main();
