import "./globals.css";

export const metadata = {
  title: "Nodus",
  icons: {
    icon: "/icons/logo-nodus.png",
    apple: "/icons/logo-nodus.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
