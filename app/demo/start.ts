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

// Hydration must not run after a failed start: fetch was not taken over, so the app's requests would reach the network.
export async function startDemoOrShowError(): Promise<boolean> {
  try {
    await startDemo();
    return true;
  } catch (error) {
    console.error('Could not start the demo:', error instanceof Error ? error.name : 'Error');
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = window.isSecureContext
      ? 'The demo could not start. Reload the page to try again.'
      : 'The demo needs a secure connection (HTTPS). Open this page over HTTPS.';
    document.body.replaceChildren(message);
    return false;
  }
}
