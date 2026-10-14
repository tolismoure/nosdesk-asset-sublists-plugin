// Resolve inputs from this file, so build results do not depend on shell cwd.
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('.', import.meta.url));
import {build} from 'esbuild';
await build({absWorkingDir:project,entryPoints:['./src/plugin.mjs'],outfile:'payload/bundle.js',bundle:true,format:'esm',platform:'browser',target:'es2020',minify:true});
