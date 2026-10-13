import {build} from 'esbuild';
await build({entryPoints:['src/plugin.mjs'],outfile:'payload/bundle.js',bundle:true,format:'esm',platform:'browser',target:'es2020',minify:true});
