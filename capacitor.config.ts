import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.movemateapp.app',
  appName: 'MoveMate',
  webDir: 'www',
  backgroundColor: '#f4f6fb',
  android: {
    // Keep the bundled web app; all API traffic goes to Supabase over HTTPS.
    allowMixedContent: false,
  },
  ios: {
    contentInset: 'automatic',
    // Auth redirects return to the app via the production URL allow-list.
  },
};

export default config;
