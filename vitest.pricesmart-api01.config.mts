import { defineConfig } from 'vitest/config';
import s05 from './vitest.s05.config.mjs';
export default defineConfig({ ...s05, test: { ...s05.test, include: [...(s05.test?.include ?? []), 'src/lib/integrations/pricesmart/*.test.ts'] } });
