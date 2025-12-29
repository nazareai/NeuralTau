import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NeuralTau - Autonomous AI Live",
  description: "Watch NeuralTau learn and evolve in real-time",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
