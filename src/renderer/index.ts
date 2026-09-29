import { DEFAULT_LAYOUT } from '../domain/workspace/layout.js';
import type { MultiTermApi } from '../shared/contract.js';
import { App } from './app.js';

declare global {
  interface Window {
    multiterm: MultiTermApi;
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app nao encontrado');
  const app = new App(root, window.multiterm, DEFAULT_LAYOUT);
  await app.start();
}

void main();
