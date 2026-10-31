import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({root:resolve(__dirname),base:'./',plugins:[react()],resolve:{alias:{'@shared':resolve(__dirname,'../src/shared')}},build:{target:'chrome68',outDir:'dist',emptyOutDir:true},server:{host:'127.0.0.1',port:4178,strictPort:true}});
