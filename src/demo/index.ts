import { createDemoApi, type DemoApi } from './api';
import { seedHousehold } from './seed';

export { DEMO_MARKER } from './marker';
export { installDemoFetch } from './installFetch';
export type { DemoApi } from './api';

// The demo's whole backend: an in-memory store, the real handlers, and the invented household.
export function createSeededDemoApi(): Promise<DemoApi> {
  return createDemoApi({ seed: send => seedHousehold(send) });
}
