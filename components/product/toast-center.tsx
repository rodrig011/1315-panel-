"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Info, X } from "lucide-react";

type Toast = { id: number; title: string; description?: string; tone?: "success" | "info" };

export function ToastCenter(){
  const [items,setItems]=useState<Toast[]>([]);
  useEffect(()=>{
    const onToast=(event:Event)=>{
      const detail=(event as CustomEvent<{title:string;description?:string;tone?:"success"|"info"}>).detail;
      if(!detail?.title)return;
      const item={id:Date.now()+Math.random(),...detail};
      setItems((current)=>[...current.slice(-2),item]);
      window.setTimeout(()=>setItems((current)=>current.filter((toast)=>toast.id!==item.id)),3500);
    };
    window.addEventListener("mcpanel:toast",onToast);
    return()=>window.removeEventListener("mcpanel:toast",onToast);
  },[]);
  return <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" aria-live="polite">{items.map((toast)=><div key={toast.id} className="pointer-events-auto animate-in flex items-start gap-3 rounded-2xl border border-white/10 bg-[#0d1016]/98 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl"><div className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">{toast.tone==="info"?<Info className="size-4"/>:<CheckCircle2 className="size-4"/>}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{toast.title}</p>{toast.description?<p className="mt-1 text-xs leading-5 text-muted-foreground">{toast.description}</p>:null}</div><button onClick={()=>setItems((current)=>current.filter((item)=>item.id!==toast.id))} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-white" aria-label="Dismiss notification"><X className="size-3.5"/></button></div>)}</div>
}
