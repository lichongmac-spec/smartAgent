// src/cli/env-check.ts
import pc from 'picocolors';

export function checkNodeVersion() {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major < 18) {
        console.error(pc.red(`❌ 需要 Node.js v18+，当前: ${version}`));
        process.exit(1);
    }
}

export function isCI(): boolean {
    return !!(process.env.CI || process.env.GITHUB_ACTIONS);
}

export function printEnvInfo() {
    console.log(pc.gray(`📂 路径: ${process.cwd()}`));
}