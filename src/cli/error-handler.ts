/**
 * 错误处理模块
 * 
 * 职责：
 * 1. 定义分级错误类型（USER / SYSTEM / NETWORK）
 * 2. 统一错误输出格式
 * 3. 提供优雅降级建议
 * 4. 捕获 SIGINT 信号（Ctrl+C）
 * 5. 捕获未处理的异常
 * 
 * 扩展方式：
 * - 添加新的错误类型
 * - 添加错误上报（如 Sentry）
 */

// ============ 1. 自定义错误类 ============
export class AgentError extends Error {
    constructor(
        message: string,
        public code: number = 1,
        public type: 'USER' | 'SYSTEM' | 'NETWORK' = 'USER'
    ) {
        super(message);
        this.name = 'AgentError';
    }
}

// ============ 2. 统一错误处理 ============
export function handleError(error: unknown): never {
    if (error instanceof AgentError) {
        console.error(`❌ ${error.message}`);

        // 根据错误类型提供建议
        if (error.type === 'USER' && error.message.includes('API Key')) {
            console.error('💡 运行 "agent config set apiKey <你的Key>" 来配置');
        }
        if (error.type === 'NETWORK') {
            console.error('💡 请检查网络连接或稍后重试');
        }
        if (error.type === 'SYSTEM') {
            console.error(error.stack);
        }

        process.exit(error.code);
    }

    // 未知错误
    console.error('💥 未知错误:', error);
    process.exit(1);
}

// ============ 3. 优雅退出 ============
export function setupGracefulShutdown(): void {
    // Ctrl+C 信号
    process.on('SIGINT', () => {
        console.log('\n👋 收到中断信号，正在清理...');
        // TODO: 清理临时文件、关闭连接等
        console.log('✅ 清理完成，再见！');
        process.exit(0);
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        console.error('💥 未捕获的异常:', error);
        process.exit(1);
    });

    // 未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
        console.error('💥 未处理的 Promise 拒绝:', reason);
        process.exit(1);
    });
}