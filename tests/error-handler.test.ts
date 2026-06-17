#!/usr/bin/env node
/**
 * 错误处理模块测试
 * 运行: pnpm tsx tests/error-handler.test.ts
 */

import pc from 'picocolors';

console.log(pc.cyan('\n🧪 错误处理模块测试\n'));
console.log(pc.gray('━'.repeat(50)));

// ============================================================
//  导入被测试模块
// ============================================================
import {
    AgentError,
    configError,
    fromError,
    handleError,
    networkError,
    systemError,
    userError
} from '../src/cli/error-handler.js';

// ============================================================
//  测试辅助
// ============================================================
let testCount = 0;
let passCount = 0;

function test(name: string, fn: () => void | Promise<void>) {
    testCount++;
    console.log(pc.yellow(`\n📝 测试 ${testCount}: ${name}`));
    try {
        fn();
        passCount++;
        console.log(pc.green('  ✅ 通过'));
    } catch (error) {
        console.log(pc.red('  ❌ 失败:'), error);
    }
}

function expectError(fn: () => void, expectedMessage: string): boolean {
    try {
        fn();
        console.log(pc.red('  ❌ 预期抛出错误，但没有抛出'));
        return false;
    } catch (error) {
        if (error instanceof Error && error.message.includes(expectedMessage)) {
            console.log(pc.green(`  ✅ 正确抛出: ${error.message}`));
            return true;
        }
        console.log(pc.red(`  ❌ 错误消息不匹配: ${error}`));
        return false;
    }
}

// ============================================================
//  测试用例
// ============================================================

// 测试 1: 创建用户错误
test('创建用户错误', () => {
    const error = userError('API Key 无效，请检查');
    if (error.type === 'USER' && error.message === 'API Key 无效，请检查') {
        // 测试通过
    } else {
        throw new Error('用户错误创建失败');
    }
});

// 测试 2: 创建网络错误
test('创建网络错误', () => {
    const error = networkError('连接超时');
    if (error.type === 'NETWORK') {
        // 测试通过
    } else {
        throw new Error('网络错误创建失败');
    }
});

// 测试 3: 创建系统错误（带原因）
test('创建系统错误（带原因）', () => {
    const cause = new Error('原始错误: 文件不存在');
    const error = systemError('读取配置文件失败', { cause });
    if (error.cause === cause && error.type === 'SYSTEM') {
        // 测试通过
    } else {
        throw new Error('系统错误创建失败');
    }
});

// 测试 4: 创建配置错误
test('创建配置错误', () => {
    const error = configError('缺少 apiKey 配置');
    if (error.type === 'CONFIG' && error.code === 1) {
        // 测试通过
    } else {
        throw new Error('配置错误创建失败');
    }
});

// 测试 5: 从原生错误转换
test('从原生错误转换', () => {
    const nativeError = new Error('ECONNREFUSED');
    const error = fromError(nativeError, 'NETWORK');
    if (error.type === 'NETWORK' && error.cause === nativeError) {
        // 测试通过
    } else {
        throw new Error('错误转换失败');
    }
});

// 测试 6: 错误链消息
test('错误链消息', () => {
    const cause = new Error('连接被拒绝');
    const error = new AgentError('API 调用失败', { type: 'NETWORK', cause });
    const fullMsg = error.getFullMessage();
    if (fullMsg.includes('API 调用失败') && fullMsg.includes('连接被拒绝')) {
        // 测试通过
    } else {
        throw new Error('错误链消息拼接失败');
    }
});

// ============================================================
//  测试 handleError 输出（捕获输出）
// ============================================================

test('handleError 输出格式（用户错误）', () => {
    const error = userError('API Key 无效');
    let output = '';
    const originalConsoleError = console.error;
    console.error = (msg: string) => { output += msg + '\n'; };

    try {
        handleError(error);
    } catch {
        // handleError 会 process.exit，这里用 try-catch 捕获
    } finally {
        console.error = originalConsoleError;
    }

    if (output.includes('API Key 无效')) {
        // 测试通过
    } else {
        throw new Error('handleError 输出格式错误');
    }
});

// ============================================================
//  测试总结
// ============================================================

console.log(pc.gray('\n━'.repeat(50)));
console.log(pc.cyan(`\n📊 测试结果: ${passCount}/${testCount} 通过`));

if (passCount === testCount) {
    console.log(pc.green('🎉 所有测试通过！\n'));
    process.exit(0);
} else {
    console.log(pc.red(`❌ ${testCount - passCount} 个测试失败\n`));
    process.exit(1);
}