import type { Metadata } from "next"; import "./globals.css"; import { RootShell } from "@/components/layout/root-shell";
export const metadata:Metadata={title:"Nodecraft — Minecraft Server Control",description:"Premium self-hosted Minecraft server management panel"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className="dark"><body><RootShell>{children}</RootShell></body></html>}
