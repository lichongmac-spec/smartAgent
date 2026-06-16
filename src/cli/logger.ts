// src/cli/logger.ts
import pc from 'picocolors';

export const logger = {
    info: (msg: string) => console.log(pc.blue('ℹ') + ' ' + msg),
    success: (msg: string) => console.log(pc.green('✅') + ' ' + msg),
    warn: (msg: string) => console.log(pc.yellow('⚠️') + ' ' + msg),
    error: (msg: string) => console.log(pc.red('❌') + ' ' + msg),
};

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
    console.log(`⏳ ${text}...`);
    const result = await fn();
    console.log(`✅ ${text} 完成`);
    return result;
}