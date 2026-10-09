import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 3005,
    host: true, // スマホ等LAN内からのアクセスを許可
    open: true  // サーバー起動完了時にブラウザを自動オープン
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'MiniBookLM Studio PWA',
        short_name: 'MiniBookLM',
        description: 'Personal NotebookLM Next-Gen Studio Ultra with In-Browser Hybrid RAG',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30MB
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}']
      }
    })
  ],
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : []
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'lucide-react'],
          studio: ['mermaid', 'marked'],
          pdf: ['pdfjs-dist']
        }
      }
    }
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@mlc-ai/web-llm']
  }
});
