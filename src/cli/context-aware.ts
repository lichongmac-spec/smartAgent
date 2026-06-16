// src/cli/context-aware.ts
export class ContextManager {
    private messages: any[] = [];

    addUserMessage(content: string) {
        this.messages.push({ role: 'user', content });
    }

    getMessages() {
        return this.messages;
    }
}

export async function* streamResponse(text: string): AsyncGenerator<string> {
    for (const char of text) {
        await new Promise(r => setTimeout(r, 30));
        yield char;
    }
}

export async function printStream(stream: AsyncGenerator<string>) {
    for await (const char of stream) {
        process.stdout.write(char);
    }
    process.stdout.write('\n');
}

export async function readFromStdin(): Promise<string> {
    return new Promise((resolve) => {
        let data = '';
        if (process.stdin.isTTY) {
            resolve('');
            return;
        }
        process.stdin.on('data', (chunk) => (data += chunk.toString()));
        process.stdin.on('end', () => resolve(data.trim()));
    });
}