import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/workbench/providers'

export const metadata: Metadata = {
  title: '开源文档本地化翻译工作台',
  description: '面向开源文档维护者的 Markdown 翻译、术语检查与协作审校工作台',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><Providers>{children}</Providers></body>
    </html>
  )
}
