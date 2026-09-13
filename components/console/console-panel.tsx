"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, RefreshCw, Send, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, wsUrl } from "@/lib/api/client";
import { useServerStore } from "@/lib/stores/server-store";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";
interface Line { id:string; time:string; level:"INFO"|"WARN"|"ERROR"|"CHAT"; message:string; }

function parseLine(raw:string):Line{
  const timestamp=raw.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+|\[[^\]]+\])/u)?.[0]??"";
  const upper=raw.toUpperCase();
  const level:Line["level"]=upper.includes("ERROR")?"ERROR":upper.includes("WARN")?"WARN":upper.includes("<")&&upper.includes(">")?"CHAT":"INFO";
  return {id:crypto.randomUUID(),time:timestamp||new Date().toLocaleTimeString("en-US",{hour12:false}),level,message:raw};
}

export function ConsolePanel(){
  const server=useServerStore((state)=>state.server);
  const [lines,setLines]=useState<Line[]>([]);
  const [command,setCommand]=useState("");
  const [connection,setConnection]=useState<ConnectionState>("disconnected");
  const [error,setError]=useState<string|null>(null);
  const end=useRef<HTMLDivElement>(null);

  const loadInitial=useCallback(async()=>{
    if(!server)return;
    const response=await apiRequest<{logs:string[]}>(`/api/servers/${encodeURIComponent(server.id)}/logs?tail=200`);
    setLines(response.logs.map(parseLine));
  },[server]);

  useEffect(()=>{void loadInitial().catch((cause)=>setError(cause instanceof Error?cause.message:"Unable to load logs"));},[loadInitial]);
  useEffect(()=>{end.current?.scrollIntoView({behavior:"smooth"});},[lines]);

  useEffect(()=>{
    if(!server)return;
    let socket:WebSocket|undefined;
    let reconnectTimer:ReturnType<typeof setTimeout>|undefined;
    let cancelled=false;
    const connect=()=>{
      if(cancelled)return;
      setConnection("connecting");
      socket=new WebSocket(wsUrl(`/ws/servers/${encodeURIComponent(server.id)}/console`));
      socket.onopen=()=>{setConnection("connected");setError(null);};
      socket.onmessage=(event)=>{
        try{
          const message=JSON.parse(String(event.data)) as {type?:string;line?:string};
          if(message.type==="log"&&message.line)setLines((previous)=>[...previous.slice(-999),parseLine(message.line)]);
        }catch{}
      };
      socket.onerror=()=>setConnection("error");
      socket.onclose=()=>{
        if(cancelled)return;
        setConnection("disconnected");
        reconnectTimer=setTimeout(connect,2000);
      };
    };
    connect();
    return()=>{cancelled=true;if(reconnectTimer)clearTimeout(reconnectTimer);socket?.close();};
  },[server]);

  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();
    if(!server)return;
    const value=command.trim();
    if(!value)return;
    setCommand("");setError(null);
    try{
      const response=await apiRequest<{output:string}>(`/api/servers/${encodeURIComponent(server.id)}/command`,{method:"POST",body:JSON.stringify({command:value})});
      setLines((previous)=>[...previous,parseLine(`> ${value}`),...(response.output?response.output.split(/\r?\n/u).filter(Boolean).map(parseLine):[])]);
    }catch(cause){setError(cause instanceof Error?cause.message:"Command failed");}
  };

  if(!server)return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Create or select a server to use the console.</div>;

  return <div className="overflow-hidden rounded-xl border bg-[#07090d] shadow-soft">
    <div className="flex items-center justify-between border-b bg-white/[.02] px-4 py-3"><div className="flex items-center gap-2 text-sm font-medium"><TerminalSquare className="size-4 text-emerald-400"/>Live console<span className={`ml-1 flex items-center gap-1.5 text-[11px] font-normal ${connection==="connected"?"text-emerald-400":connection==="error"?"text-red-400":"text-amber-400"}`}><span className="size-1.5 rounded-full bg-current"/>{connection}</span></div><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={()=>void loadInitial()}><RefreshCw className="size-3.5"/>Reload</Button><Button size="sm" variant="ghost" onClick={()=>setLines([])}><Eraser className="size-3.5"/>Clear</Button></div></div>
    {error?<div className="border-b border-red-500/20 bg-red-500/[.05] px-4 py-2 text-xs text-red-300">{error}</div>:null}
    <div className="scrollbar-thin h-[560px] overflow-y-auto p-4 font-mono text-[12px] leading-6">{lines.length===0?<div className="grid h-full place-items-center text-muted-foreground">No console output yet.</div>:lines.map((line)=><div key={line.id} className="flex gap-3"><span className="select-none text-zinc-600">{line.time}</span><span className={line.level==="WARN"?"text-amber-400":line.level==="ERROR"?"text-red-400":line.level==="CHAT"?"text-cyan-400":"text-zinc-500"}>[{line.level}]</span><span className="whitespace-pre-wrap break-all text-zinc-300">{line.message}</span></div>)}<div ref={end}/></div>
    <form onSubmit={submit} className="flex gap-2 border-t p-3"><Input value={command} onChange={(event)=>setCommand(event.target.value)} placeholder="Enter a server command…" className="font-mono" disabled={server.status!=="online"}/><Button type="submit" disabled={server.status!=="online"}><Send className="size-3.5"/>Send</Button></form>
  </div>;
}
