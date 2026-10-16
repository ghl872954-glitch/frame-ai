import type { Metadata, Viewport } from 'next';

import './globals.css';

const DESCRIPTION =
  '实时语音陪伴 + 能执行任务的 AI 智能体。BYOK，本地优先，自带人格与记忆。';

export const metadata: Metadata = {
  title: 'frame',
  description: DESCRIPTION,
  applicationName: 'frame',
  keywords: [
    'AI agent',
    'voice assistant',
    'BYOK',
    'OpenAI compatible',
    '本地优先',
    '语音助手',
    '智能体',
  ],
  openGraph: {
    title: 'frame',
    description: DESCRIPTION,
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06070a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
