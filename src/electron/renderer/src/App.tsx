import React from 'react';

const App: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="max-w-2xl w-full space-y-6">
        {/* Header */}
        <header className="text-center space-y-3">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            SmartAgent
          </h1>
          <p className="text-gray-400 text-lg">
            AI-Powered CLI Agent — Desktop Edition
          </p>
        </header>

        {/* Status Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-2xl font-mono text-green-400">v1.0</div>
            <div className="text-gray-500 text-sm mt-1">Version</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-2xl font-mono text-blue-400">11</div>
            <div className="text-gray-500 text-sm mt-1">IPC Channels</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-2xl font-mono text-purple-400">4</div>
            <div className="text-gray-500 text-sm mt-1">Built-in Tools</div>
          </div>
        </div>

        {/* Placeholder Chat Area */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 min-h-[200px] flex items-center justify-center">
          <p className="text-gray-500 text-center">
            🚀 Electron 桌面环境已就绪
            <br />
            <span className="text-sm mt-2 block">
              ChatPanel 即将在此渲染，开始构建你的 AI 对话界面
            </span>
          </p>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-600 text-sm">
          React + Vite + Electron + Tailwind CSS
        </footer>
      </div>
    </div>
  );
};

export default App;
