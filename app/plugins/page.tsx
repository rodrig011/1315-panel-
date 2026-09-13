"use client";

import Link from "next/link";
import { Box, FileBox, Info } from "lucide-react";
import { PageHeader } from "@/components/shared/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useServerStore } from "@/lib/stores/server-store";

export default function PluginsPage(){
  const server=useServerStore((state)=>state.server);
  return <><PageHeader title="Plugins" description="Plugin support is exposed only when the backend can manage it safely."/>{!server?<Card className="p-10 text-center text-sm text-muted-foreground">Create or select a server first.</Card>:server.loader!=="Paper"?<Card className="p-8"><div className="flex items-start gap-4"><div className="grid size-11 place-items-center rounded-xl border bg-white/[.03]"><Info className="size-5 text-blue-400"/></div><div><h2 className="font-medium">Plugins are not applicable to {server.loader}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">1315 Panel will not pretend Paper/Spigot plugins can be installed on this server. Use the Mods page for {server.loader}-compatible Modrinth content.</p><Button asChild variant="outline" className="mt-4"><Link href="/mods"><Box className="size-4"/>Open Mods</Link></Button></div></div></Card>:<Card className="p-8"><div className="flex items-start gap-4"><div className="grid size-11 place-items-center rounded-xl border bg-white/[.03]"><FileBox className="size-5 text-emerald-400"/></div><div><h2 className="font-medium">Paper plugin marketplace is not implemented yet</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">There is currently no backend plugin marketplace/install API, so this page intentionally exposes no fake install buttons. You can manage trusted plugin JARs through the Files page under the server&apos;s plugins directory.</p><Button asChild variant="outline" className="mt-4"><Link href="/files">Open Files</Link></Button></div></div></Card>}</>;
}
