import type { Metadata } from 'next';
import './globals.css';
import './intake.css';

export const metadata: Metadata = {
  title: 'AlgoStudio · 算法互动课堂',
  description: '输入新算法题，解析并确认题意；通过两道示例课件逐步学习 JavaScript 算法。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
      </body>
    </html>
  );
}
