import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    testTimeout: 90_000,
    hookTimeout: 30_000,
    // Las pruebas de API usan la base real: una a una, para no saturar MySQL
    fileParallelism: false,
  },
});
