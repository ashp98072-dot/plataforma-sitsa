import { defineConfig } from 'vitest/config';
import s04 from './vitest.s04.config.mjs';
export default defineConfig({ ...s04, test: { ...s04.test, include: [...(s04.test?.include ?? []), 'scripts/sandbox-s05/*.test.mjs'] } });
