import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Chrome MV3 の content script は ES module を読めないため、shared chunk が
// import される ESM 出力ではロードに失敗する。content script だけは単一エントリ
// + IIFE で自己完結ビルドする。popup と background は通常のビルド (vite.config.ts)
// が担当する。
export default defineConfig({
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/index.ts'),
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
