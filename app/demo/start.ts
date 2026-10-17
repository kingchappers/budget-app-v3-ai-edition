import { DEMO_MARKER, createSeededDemoApi, installDemoFetch } from '../../src/demo';
import { demoControls } from './controls';

// Runs before the first render of the demo build: the whole backend is created and fetch is taken over, so no request ever
// reaches the network.
export async function startDemo(): Promise<void> {
  const api = await createSeededDemoApi();
  installDemoFetch(api, window);
  demoControls.reset = () => api.reset();
  document.documentElement.setAttribute('data-demo-build', DEMO_MARKER);
}
