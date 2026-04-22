import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "../index.css"
import Providers from "@/components/providers"
import Sidebar from "@/components/sidebar"
import { ModeToggle } from "@/components/mode-toggle"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Swades Recorder",
  description: "Audio recording and transcription pipeline",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <div className="flex h-svh">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-end border-b border-border px-4 py-1.5">
                <ModeToggle />
              </div>
              <main className="flex-1 overflow-y-auto">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  )
}
