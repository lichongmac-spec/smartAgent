import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'SmartAgent',
    executableName: 'smartagent',
    asar: true,
  },
  // Makers 暂不配置，后续 Phase 打包阶段添加
  // makers: [],
  // plugins: [],
};

export default config;
