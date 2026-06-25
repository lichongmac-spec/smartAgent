/**
 * App.tsx 组件测试
 *
 * 测试 electron/renderer/src/App.tsx 的基本渲染：
 * 标题、状态卡片、占位聊天区域、页脚。
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../../electron/renderer/src/App.js';

describe('App Component', () => {
  // ─── 渲染验证 ───────────────────────────────

  it('should render the app title "SmartAgent"', () => {
    render(React.createElement(App));
    const heading = screen.getByText('SmartAgent');
    expect(heading).toBeDefined();
    expect(heading.tagName).toBe('H1');
  });

  it('should render the subtitle', () => {
    render(React.createElement(App));
    const subtitle = screen.getByText('AI-Powered CLI Agent — Desktop Edition');
    expect(subtitle).toBeDefined();
  });

  // ─── 状态卡片 ───────────────────────────────

  it('should render version card with v1.0', () => {
    render(React.createElement(App));
    expect(screen.getByText('v1.0')).toBeDefined();
    expect(screen.getByText('Version')).toBeDefined();
  });

  it('should render IPC channels card with 11', () => {
    render(React.createElement(App));
    expect(screen.getByText('11')).toBeDefined();
    expect(screen.getByText('IPC Channels')).toBeDefined();
  });

  it('should render built-in tools card with 4', () => {
    render(React.createElement(App));
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getByText('Built-in Tools')).toBeDefined();
  });

  // ─── 占位内容 ───────────────────────────────

  it('should render the placeholder chat area', () => {
    render(React.createElement(App));
    const placeholder = screen.getByText(/Electron 桌面环境已就绪/);
    expect(placeholder).toBeDefined();
  });

  it('should render the footer with tech stack', () => {
    render(React.createElement(App));
    const footer = screen.getByText('React + Vite + Electron + Tailwind CSS');
    expect(footer).toBeDefined();
  });

  // ─── 结构验证 ───────────────────────────────

  it('should have 3 status cards', () => {
    const { container } = render(React.createElement(App));
    const cards = container.querySelectorAll('.grid.grid-cols-3 > div');
    expect(cards.length).toBe(3);
  });

  it('should have a header element', () => {
    const { container } = render(React.createElement(App));
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
  });

  it('should have a footer element', () => {
    const { container } = render(React.createElement(App));
    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
  });

  // ─── CSS 类验证 ─────────────────────────────

  it('should apply Tailwind gradient classes to heading', () => {
    render(React.createElement(App));
    const heading = screen.getByText('SmartAgent');
    expect(heading.className).toContain('bg-gradient-to-r');
    expect(heading.className).toContain('from-blue-400');
    expect(heading.className).toContain('to-purple-500');
  });

  it('should apply min-h-screen to root container', () => {
    const { container } = render(React.createElement(App));
    const root = container.firstElementChild;
    expect(root?.className).toContain('min-h-screen');
  });
});
