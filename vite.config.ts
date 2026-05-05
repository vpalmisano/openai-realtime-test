import { defineConfig } from 'vite';
import { readdirSync } from 'fs';
import { resolve } from 'path';

const audioDir = resolve(__dirname, 'public/audio');
const questions = readdirSync(audioDir)
  .filter(f => f.endsWith('.mp3'))
  .sort();

export default defineConfig({
  define: {
    __QUESTIONS__: JSON.stringify(questions),
  },
  base: './',
});
