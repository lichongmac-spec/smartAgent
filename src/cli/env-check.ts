/**
 * 环境检测模块
 * 
 * 职责：
 * 1. 检查 Node.js 版本是否满足要求
 * 2. 检测是否在 CI 环境中运行
 * 3. 检测是否为全局安装
 * 4. 打印环境信息（调试用）
 */

import pc from 'picocolors';

/** 检查 Node.js 版本 >= 18 */
export function checkNodeVersion(): void {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major < 18) {
        console.error(pc.red(`❌ SmartAgent 需要 Node.js v18+，当前: ${version}`));
        console.error(pc.gray('💡 请升级 Node.js: https://nodejs.org/'));
        process.exit(1);
    }
}

/** 检测是否在 CI 环境中运行 */
export function isCI(): boolean {
    return !!(
        process.env.CI ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.JENKINS_HOME
    );
}

/** 检测是否为全局安装 */
export function isGlobalInstall(): boolean {
    const modulePath = import.meta.url || __filename;
    return modulePath.includes('node_modules/.pnpm/') ||
        modulePath.includes('node_modules/@smartagent');
}

/** 打印环境信息（调试用） */
export function printEnvInfo(): void {
    console.log(pc.gray(`📂 运行路径: ${process.cwd()}`));
    console.log(pc.gray(`🖥️  平台: ${process.platform} ${process.arch}`));
    console.log(pc.gray(`📦 全局安装: ${isGlobalInstall() ? '是' : '否'}`));
    console.log(pc.gray(`🤖 CI 环境: ${isCI() ? '是' : '否'}`));
}