import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

async function buildBrowserModules() {
  await mkdir('dist/browser', { recursive: true });
  for (const [name, globalName] of Object.entries({
    markdown: 'ReventoMarkdown', 'component-markdown': 'componentMarkdown',
    'template-document': 'templateDocument', 'template-layout': 'templateLayout'
  })) {
    await build({ entryPoints: [`public/${name}.ts`], outfile: `dist/browser/${name}.js`,
      bundle: true, format: 'iife', globalName, platform: 'browser', target: 'es2022',
      footer: name === 'markdown' ? { js: 'Object.assign(globalThis, ReventoMarkdown);' } : undefined });
  }
}
buildBrowserModules().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
