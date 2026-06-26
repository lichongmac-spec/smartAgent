/**
 * 环境检测模块
 *
 * 职责：
 * 1. Node.js 版本检查（硬拦截，< v18 直接退出，支持 silent/skip）
 * 2. CI 环境探测（禁用颜色和 Spinner 的关键依据）
 * 3. 全局安装检测（区分开发/生产环境，使用 fileURLToPath 转换）
 * 4. 容器环境检测（Docker/K8s 等多维度判断）
 * 5. 启动时打印环境摘要（调试用）
 */

import pc from 'picocolors';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

// ============================================================
//  1. Node 版本检查（硬拦截）
// ============================================================

export interface NodeVersionCheckOptions {
    /** 静默模式，不输出成功信息（兼容 --json 等非交互场景） */
    silent?: boolean;
    /** 跳过版本检查（测试或批量执行加速） */
    skip?: boolean;
}

/**
 * 检查 Node.js 版本 >= 18，不满足时打印升级指引并退出进程
 *
 * @example
 *   checkNodeVersion();                    // 默认：打印成功日志
 *   checkNodeVersion({ silent: true });    // 静默：只在失败时输出
 *   checkNodeVersion({ skip: true });      // 跳过：完全不做检查
 */
export function checkNodeVersion(options: NodeVersionCheckOptions = {}): void {
    const { silent = false, skip = false } = options;

    if (skip) {
        if (!silent) {
            console.log(pc.gray('⏭️ 跳过 Node.js 版本检查'));
        }
        return;
    }

    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);

    if (major < 18) {
        console.error(pc.red(`❌ SmartAgent 需要 Node.js v18+，当前版本: ${version}`));
        console.error(pc.gray('💡 请升级 Node.js: https://nodejs.org/'));
        process.exit(1);
    }

    if (!silent) {
        console.log(pc.green(`✅ Node.js 版本: ${version}`));
    }
}

// ============================================================
//  2. CI 环境探测
// ============================================================

/**
 * 检测是否在 CI 环境中运行
 *
 * 覆盖主流 CI 平台：
 * - GitHub Actions  → GITHUB_ACTIONS
 * - GitLab CI       → GITLAB_CI
 * - Jenkins         → JENKINS_HOME / BUILD_NUMBER
 * - 其他           → CI（各平台通用约定）
 */
export function isCI(): boolean {
    return !!(
        process.env.CI ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.JENKINS_HOME ||
        process.env.BUILD_NUMBER
    );
}

// ============================================================
//  3. 全局安装检测
// ============================================================

/** 检测当前进程是否从全局 npm 安装目录运行 */
export function isGlobalInstall(): boolean {
    let modulePath: string;
    try {
        modulePath = fileURLToPath(import.meta.url);
    } catch {
        // 降级：直接使用 URL 字符串（file:// 协议的 path 部分也能命中）
        modulePath = import.meta.url;
    }

    return (
        modulePath.includes('/node_modules/.pnpm/') ||
        modulePath.includes('/node_modules/@smartagent') ||
        modulePath.includes('.pnpm/node_modules/@smartagent')
    );
}

// ============================================================
//  4. 容器环境检测
// ============================================================

/**
 * 检测是否在容器（Docker/K8s）中运行
 *
 * 判断依据（满足任一即视为容器环境）：
 * - CONTAINER_ID 环境变量（K8s / 部分运行时）
 * - /.dockerenv 文件存在（Docker 经典标志）
 */
export function isContainer(): boolean {
    if (process.env.CONTAINER_ID) return true;

    try {
        return existsSync('/.dockerenv');
    } catch {
        return false;
    }
}

// ============================================================
//  5. 启动时环境摘要（调试用）
// ============================================================

/** 打印环境信息摘要，适合在启动日志中展示 */
export function printEnvInfo(): void {
    console.log(pc.gray(`📂 运行路径: ${process.cwd()}`));
    console.log(pc.gray(`🖥️  平台: ${process.platform} ${process.arch}`));
    console.log(pc.gray(`🐳 容器: ${isContainer() ? '是' : '否'}`));
    console.log(pc.gray(`🤖 CI 环境: ${isCI() ? '是' : '否'}`));
    console.log(pc.gray(`📦 全局安装: ${isGlobalInstall() ? '是' : '否'}`));
}
