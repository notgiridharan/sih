import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const isExtension = mode === 'extension'

  return {
    plugins: [react()],
    build: isExtension
      ? {
          outDir: 'dist-extension',
          rollupOptions: {
            input: { index: 'index.html', widget: 'widget.html' },
          },
        }
      : {},
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  }
})
