// Entry point for the reminder scheduler Lambda. The build script compiles this file to
// build/push/index.js, the same way api-handler.ts becomes the API Lambda.
export { handler } from './src/push/scheduler';
