import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// 详见 https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'Orinui',
    description: '设计精致、轻量、本地优先的新标签页',
    version: '0.0.0',
    optional_host_permissions: ['https://*/*', 'http://localhost/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
  },
});
