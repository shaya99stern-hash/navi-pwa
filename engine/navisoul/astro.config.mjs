import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
export default defineConfig({ srcDir: '.', output: 'server', adapter: vercel(), vite: { worker: { format: 'es' }, build: { target: 'es2022' } } });
