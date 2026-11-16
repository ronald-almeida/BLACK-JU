import { cp, mkdir } from 'node:fs/promises';
import { runChecks } from './check-catalog.mjs';
await runChecks();
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/', import.meta.url), { recursive: true });
console.log('Build complete: 20 ofertas, assets locais e checkouts Pix em dist/.');
