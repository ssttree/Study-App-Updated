/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    // The service worker caches every file the app needs, so after the first
    // visit the app opens and works with no internet (flashcards on the bus).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      // Lets phones (and Chrome on the laptop) install it as an app with its own icon and window.
      manifest: {
        id: '/',
        name: 'Study App',
        short_name: 'Study',
        description: 'Flashcards and study planning built on spaced repetition.',
        start_url: '/',
        scope: '/',
        theme_color: '#121316',
        background_color: '#121316',
        display: 'standalone',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          // Full bleed, so Android can crop it to any shape.
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm}'],
        navigateFallback: 'index.html',
        // These go to the server: the Google sign-in, the API and the phone page.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/add/, /^\/privacy/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  // Two pages: the app, and the phone's quick add page.
  build: {
    rollupOptions: {
      input: { main: 'index.html', add: 'add.html' },
    },
  },
  // The PDF.js worker is an ES module.
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
