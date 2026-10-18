import { build } from 'esbuild';
await build({entryPoints:['src/client-upload.js'],bundle:true,format:'esm',platform:'browser',minify:true,outfile:'public/blob-upload.js'});
