import { defineConfig } from 'vitest/config';
import s02 from './vitest.sandbox.config.mjs';
export default defineConfig({
  ...s02,
  test: { ...s02.test, include: [...(s02.test?.include ?? []), 'scripts/infra/pricesmart-s03.test.mjs'], fileParallelism: false, maxWorkers: 1 },
});
