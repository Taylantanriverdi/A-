import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts', 'migration/test/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' },
});
