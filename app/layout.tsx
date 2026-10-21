import "./globals.css";
import type { Viewport } from "next";
import PwaInstalar from "./components/PwaInstalar";
import AppNativa from "./components/AppNativa";

export const metadata = {
  title: "Nodus",
  icons: {
    icon: "/icons/logo-nodus.png",
    apple: "/icons/pwa/apple-icon-180.png",
  },
  // Al agregarla a la pantalla de inicio del iPhone se abre como app, sin la barra del navegador.
  appleWebApp: { capable: true, title: "Nodus", statusBarStyle: "black-translucent" as const },
};

// Color de la barra del sistema cuando se usa como app instalada.
export const viewport: Viewport = { themeColor: "#0d1b3e" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>
        {children}
        <PwaInstalar />
        <AppNativa />
      </body>
    </html>
  );
}
