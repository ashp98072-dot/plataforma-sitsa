import {defineConfig} from 'vitest/config';
export default defineConfig({envDir:false,resolve:{tsconfigPaths:true},test:{environment:'node',include:['src/lib/contabilidad/reportes/reportes-periodos.integration.test.ts'],fileParallelism:false,maxWorkers:1,retry:0,bail:1}});
