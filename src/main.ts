import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import 'katex/dist/katex.min.css';
import './theme.css';

import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// Cache the app's files so it opens with no internet.
registerSW({ immediate: true });

// Ask the browser not to clear our data when the disk gets full.
navigator.storage?.persist?.().catch(() => {});

export default app;
