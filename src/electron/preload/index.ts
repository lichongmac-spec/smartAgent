/**
 * 预加载脚本 — 安全暴露受限 API 给渲染进程
 *
 * 只通过 contextBridge 暴露封装好的业务函数，禁止直接暴露 ipcRenderer
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agent', {
  /**
   * 流式提问 — 逐字推送 Agent 回复
   * @param prompt 用户输入
   * @param onChunk 每收到一个文字块时调用
   * @param onDone 流结束时调用
   * @param onError 出错时调用
   * @returns cleanup 函数，用于取消监听
   */
  askStream: (
    prompt: string,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (msg: string) => void
  ) => {
    // 注册一次性监听器
    const chunkHandler = (_event: Electron.IpcRendererEvent, data: { chunk: string; done: boolean; error?: string }) => {
      if (data.error) {
        onError(data.error);
        cleanup();
        return;
      }
      if (data.done) {
        onDone();
        cleanup();
        return;
      }
      onChunk(data.chunk);
    };

    const cleanup = () => {
      ipcRenderer.removeListener('agent:chunk', chunkHandler);
    };

    ipcRenderer.on('agent:chunk', chunkHandler);

    // 发送流式请求到主进程
    ipcRenderer.send('agent:ask-stream', { prompt });
  },

  /**
   * 中断正在进行的 Agent 生成
   */
  interrupt: () => {
    ipcRenderer.send('agent:interrupt');
  },

  /** 应用名称 */
  name: 'SmartAgent Desktop',
  /** 平台信息 */
  platform: process.platform,
});
