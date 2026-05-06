import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Chrome MV3 の content script は ES module を読めないため、shared chunk が
// import される ESM 出力ではロードに失敗する。MV3 + IIFE では rollup の
// codeSplitting が無効化されるため multi-entry も使えず、サービスごとに
// 個別の vite config (vite.content.<service>.config.ts) で 1 エントリずつ
// build する構成になっている。
//
// 本ファイルは共通設定のファクトリーで、サービス別 config から呼び出される。
export interface ContentBuildOptions {
  entry: string;
  fileName: string;
}

export const buildContentConfig = (opts: ContentBuildOptions) =>
  defineConfig({
    resolve: {
      extensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(__dirname, opts.entry),
        output: {
          entryFileNames: opts.fileName,
          // IIFE は単一エントリ + codeSplitting 無効が前提。MV3 content script の
          // 自己完結バンドルとしてはこれが必須。
          format: 'iife',
        },
      },
    },
  });
