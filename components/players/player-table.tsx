"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Crown, LogOut, RefreshCw, ShieldCheck, ShieldOff, UserRoundCheck, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/api/client";
import { useServerStore } from "@/lib/stores/server-store";

interface PlayerDto { username:string; uuid:string|null; ping:number|null; playtimeSeconds:number|null; op:boolean; whitelisted:boolean; online:boolean; }

export function PlayerTable(){
  const server=useServerStore((state)=>state.server);
  const [items,setItems]=useState<PlayerDto[]>([]);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!server)return;
    try{const response=await apiRequest<{players:PlayerDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/players`);setItems(response.players);setError(null);}catch(cause){setError(cause instanceof Error?cause.message:"Unable to load players");}
  },[server]);
  useEffect(()=>{void load();},[load]);

  const action=async(player:PlayerDto,verb:"kick"|"ban"|"op"|"deop"|"whitelist"|"remove-whitelist")=>{
    if(!server)return;
    if((verb==="kick"||verb==="ban")&&!window.confirm(`${verb} ${player.username}?`))return;
    setBusy(`${player.username}:${verb}`);setError(null);
    try{
      const base=`/api/servers/${encodeURIComponent(server.id)}/players/${encodeURIComponent(player.username)}`;
      if(verb==="remove-whitelist")await apiRequest(`${base}/whitelist`,{method:"DELETE"});
      else await apiRequest(`${base}/${verb}`,{method:"POST",body:verb==="kick"||verb==="ban"?JSON.stringify({}):undefined});
      await load();
    }catch(cause){setError(cause instanceof Error?cause.message:`Unable to ${verb} player`);}finally{setBusy(null);}
  };

  if(!server)return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Create or select a server to manage players.</div>;

  return <div className="space-y-3">{error?<Card className="border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>:null}<div className="flex justify-end"><Button size="sm" variant="outline" onClick={()=>void load()}><RefreshCw className="size-3.5"/>Refresh</Button></div><Card className="overflow-hidden"><div className="hidden grid-cols-[1fr_90px_120px_100px_220px] border-b bg-white/[.02] px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground lg:grid"><span>Player</span><span>Ping</span><span>Playtime</span><span>Status</span><span className="text-right">Actions</span></div>{items.length===0?<div className="p-10 text-center text-sm text-muted-foreground">No known players yet.</div>:items.map((player)=><div key={player.uuid??player.username} className="grid gap-3 border-b px-4 py-3 text-sm last:border-0 lg:grid-cols-[1fr_90px_120px_100px_220px] lg:items-center"><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-indigo-500/30 to-emerald-500/20 font-semibold">{player.username.slice(0,2).toUpperCase()}</div><div><div className="flex items-center gap-2"><span>{player.username}</span>{player.op?<Crown className="size-3.5 text-amber-400"/>:null}</div><p className="max-w-[260px] truncate text-[10px] text-muted-foreground">{player.uuid??"UUID unavailable"}</p></div></div><span className={player.ping!==null&&player.ping<70?"text-emerald-400":"text-muted-foreground"}>{player.ping===null?"—":`${player.ping} ms`}</span><span className="text-muted-foreground">{player.playtimeSeconds===null?"—":formatPlaytime(player.playtimeSeconds)}</span><Badge className={player.online?"w-fit border-emerald-500/20 bg-emerald-500/10 text-emerald-400":"w-fit"}>{player.online?"Online":"Offline"}</Badge><div className="flex justify-end gap-1">{player.online?<Button size="icon" variant="ghost" title="Kick" disabled={busy!==null} onClick={()=>void action(player,"kick")}><LogOut className="size-4"/></Button>:null}<Button size="icon" variant="ghost" title="Ban" disabled={busy!==null} onClick={()=>void action(player,"ban")}><Ban className="size-4"/></Button><Button size="icon" variant="ghost" title={player.op?"Deop":"OP"} disabled={busy!==null} onClick={()=>void action(player,player.op?"deop":"op")}>{player.op?<ShieldOff className="size-4"/>:<ShieldCheck className="size-4"/>}</Button><Button size="icon" variant="ghost" title={player.whitelisted?"Remove whitelist":"Whitelist"} disabled={busy!==null} onClick={()=>void action(player,player.whitelisted?"remove-whitelist":"whitelist")}>{player.whitelisted?<UserRoundX className="size-4"/>:<UserRoundCheck className="size-4"/>}</Button></div></div>)}</Card></div>;
}

function formatPlaytime(seconds:number){const hours=Math.floor(seconds/3600);const minutes=Math.floor((seconds%3600)/60);return hours>0?`${hours}h ${minutes}m`:`${minutes}m`;}
