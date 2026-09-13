"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/shell";
import { authApi } from "@/lib/api/auth";
import { useServerStore } from "@/lib/stores/server-store";

export function RootShell({children}:{children:React.ReactNode}){
  const pathname=usePathname();
  const router=useRouter();
  const [ready,setReady]=useState(pathname==="/login");
  const loadServers=useServerStore((state)=>state.loadServers);

  useEffect(()=>{
    if(pathname==="/login"){setReady(true);return;}
    let cancelled=false;
    setReady(false);
    void authApi.me().then(async()=>{
      if(cancelled)return;
      await loadServers();
      if(!cancelled)setReady(true);
    }).catch(()=>{
      if(!cancelled)router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
    return()=>{cancelled=true};
  },[pathname,router,loadServers]);

  if(pathname==="/login")return <>{children}</>;
  if(!ready)return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Checking session…</div>;
  return <AppShell>{children}</AppShell>;
}
