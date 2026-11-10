// Bundle the app with esbuild: node scripts/build.mjs [--watch]
import { build, context } from 'esbuild';
const options = { entryPoints: ['src/main.js'], bundle: true, format: 'esm', outfile: 'dist/app.js', loader: { '.stlib': 'json' }, sourcemap: true, minify: process.argv.includes('--min'), logLevel: 'info', target: 'es2022', define: { 'process.env.NODE_ENV': '"production"' } };
if (process.argv.includes('--watch')) { const ctx = await context(options); await ctx.watch(); console.log('watching…'); } else await build(options);
