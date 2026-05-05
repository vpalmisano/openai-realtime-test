import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const audioDir = resolve(__dirname, 'public/audio');
const questions = readdirSync(audioDir)
  .filter(f => f.endsWith('.mp3'))
  .sort();

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  define: {
    __QUESTIONS__: JSON.stringify(questions),
  },
  base: './',
});
