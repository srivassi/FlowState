import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Study Planner Agent",
  description: "AI-powered study planning",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
