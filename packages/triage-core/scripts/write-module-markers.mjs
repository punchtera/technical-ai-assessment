// The package ships both ESM (for Vite) and CommonJS (for the NestJS API).
// A nested package.json tells Node which module system each folder uses.
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/esm/package.json', import.meta.url), '{ "type": "module" }\n');
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{ "type": "commonjs" }\n');
