import {defineConfig} from 'vitest/config';
export default defineConfig({envDir:false,resolve:{tsconfigPaths:true},test:{environment:'node',include:['scripts/ci/c3c15b/seed.test.ts'],fileParallelism:false,maxWorkers:1,retry:0}});
