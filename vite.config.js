// `defineConfig` comes from vitest/config rather than vite — it is a superset
// that also accepts the `test` block. Keeping the test settings HERE rather
// than in a separate vitest.config.js is deliberate: a second config file did
// not apply the React plugin's JSX transform, so every component test failed
// with 'React is not defined' while the app build was fine. One config means
// the tests always see exactly what the app sees.
//
// Vitest must also stay on a major that supports this project's Vite. Vitest 3
// bundles Vite 5-7 and silently ignored the Vite 8 React plugin, producing the
// same 'React is not defined' failure; Vitest 4 is the version that matches.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // The scheduling and series suites are standalone Node scripts with their
    // own assertion style and their own npm scripts; Vitest must not collect
    // them as if they were Vitest files.
    exclude: ['node_modules/**', 'dist/**', 'scripts/**'],
  },
})
