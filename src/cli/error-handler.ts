// src/cli/error-handler.ts
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

export function handleError(error: unknown): never {
    if (error instanceof AgentError) {
        console.error(`❌ ${error.message}`);
        process.exit(error.code);
    }
    console.error('💥 未知错误:', error);
    process.exit(1);
}

export function setupGracefulShutdown() {
    process.on('SIGINT', () => {
        console.log('\n👋 再见！');
        process.exit(0);
    });
}