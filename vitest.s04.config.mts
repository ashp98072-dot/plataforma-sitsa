import { defineConfig } from 'vitest/config';
import s03 from './vitest.s03.config.mjs';
export default defineConfig({ ...s03, test: { ...s03.test, include: [...(s03.test?.include ?? []), 'scripts/sandbox-s04/*.test.mjs', 'scripts/sandbox-s04/*.test.ts'] } });
