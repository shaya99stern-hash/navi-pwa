import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('lib/sandbox/generated', { recursive: true });
for (const [name, globalName, contents] of [
  ['react','NaviReact','export * as React from "react"; export * as ReactDOM from "react-dom/client";'],
  ['vue','NaviVue','export * from "vue/dist/vue.esm-bundler.js";'],
  ['mermaid','NaviMermaid','export { default } from "mermaid";'],
  ['katex','NaviKatex','export * from "katex";']
]) await build({ stdin: { contents, resolveDir: process.cwd() }, bundle: true, minify: true, format: 'iife', globalName, platform: 'browser', target: 'es2022', outfile: `lib/sandbox/generated/${name}.js`, alias: { 'vscode-jsonrpc/lib/common/cancellation.js': resolve('node_modules/vscode-jsonrpc/lib/common/cancellation.js'), 'vscode-jsonrpc/lib/common/events.js': resolve('node_modules/vscode-jsonrpc/lib/common/events.js') }, define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } });
