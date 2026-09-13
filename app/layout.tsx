import type { Metadata } from "next";
import "./globals.css";
import { RootShell } from "@/components/layout/root-shell";

export const metadata:Metadata={title:"1315 Panel — Minecraft Server Control",description:"Private self-hosted Minecraft server management panel"};

export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="en" className="dark"><body><RootShell>{children}</RootShell></body></html>;
}
