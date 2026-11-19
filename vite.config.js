import { defineConfig } from 'vite';
import fs from 'node:fs';

// .task files dropped into public/models/mediapipe/ are used offline; the app only probes for files that exist.
const localTasks = fs.existsSync('public/models/mediapipe') ? fs.readdirSync('public/models/mediapipe').filter((f) => f.endsWith('.task')) : [];

// Relative base so the build works from any GitHub Pages path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  define: { __LOCAL_TASKS__: JSON.stringify(localTasks) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: true },
});
