import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  let apiKey = (process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || "").trim();
  
  // Filter out common placeholders that might be in .env.example or pre-filled
  if (apiKey === "MY_GEMINI_API_KEY" || apiKey === "\"MY_GEMINI_API_KEY\"" || apiKey === "YOUR_API_KEY") {
    apiKey = "";
  }
  
  if (!apiKey || apiKey === "undefined") {
    console.warn('WARNING: GEMINI_API_KEY is missing or "undefined" during build.');
  } else {
    console.log(`GEMINI_API_KEY detected (Length: ${apiKey.length})`);
  }
  
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(apiKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
