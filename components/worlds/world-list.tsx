"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Globe2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { apiRequest } from "@/lib/api/client";
import { useServerStore } from "@/lib/stores/server-store";

interface WorldDto { name:string;active:boolean;sizeBytes:number;modifiedAt:string;generated:boolean; }

export function WorldList(){
  const server=useServerStore((state)=>state.server);
  const [items,setItems]=useState<WorldDto[]>([]);
  const [error,setError]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [deleteWorld,setDeleteWorld]=useState<WorldDto|null>(null);

  const load=useCallback(async()=>{if(!server)return;try{const response=await apiRequest<{worlds:WorldDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/worlds`);setItems(response.worlds);setError(null);}catch(cause){setError(cause instanceof Error?cause.message:"Unable to load worlds");}},[server]);
  useEffect(()=>{void load();},[load]);

  const create=async()=>{if(!server)return;const name=window.prompt("World name","1315 SMP");if(!name)return;setBusy(true);try{const response=await apiRequest<{worlds:WorldDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/worlds`,{method:"POST",body:JSON.stringify({name,setActive:false})});setItems(response.worlds);}catch(cause){setError(cause instanceof Error?cause.message:"Unable to create world");}finally{setBusy(false);}};
  const activate=async(world:WorldDto)=>{if(!server)return;setBusy(true);try{const response=await apiRequest<{worlds:WorldDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/worlds/${encodeURIComponent(world.name)}/activate`,{method:"POST"});setItems(response.worlds);}catch(cause){setError(cause instanceof Error?cause.message:"Unable to activate world");}finally{setBusy(false);}};
  const remove=async()=>{if(!server||!deleteWorld)return;setBusy(true);try{const response=await apiRequest<{worlds:WorldDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/worlds/${encodeURIComponent(deleteWorld.name)}`,{method:"DELETE"});setItems(response.worlds);setDeleteWorld(null);}catch(cause){setError(cause instanceof Error?cause.message:"Unable to delete world");}finally{setBusy(false);}};

  if(!server)return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Create or select a server to manage worlds.</div>;
  return <><div className="mb-4 flex flex-wrap items-center gap-2"><p className="mr-auto text-xs text-muted-foreground">World-changing operations require the server to be stopped. Archive upload/download is intentionally unavailable until verified archive handling is implemented.</p><Button variant="outline" onClick={()=>void load()}><RefreshCw className="size-4"/>Refresh</Button><Button disabled={busy||server.status==="online"} onClick={()=>void create()}><Plus className="size-4"/>Create world</Button></div>{error?<Card className="mb-3 border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>:null}<div className="grid gap-3 xl:grid-cols-2">{items.map((world)=><Card key={world.name} className="p-4"><div className="flex items-start gap-4"><div className="grid size-12 place-items-center rounded-xl border bg-white/[.03]"><Globe2 className="size-5 text-blue-400"/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="font-medium">{world.name}</h3>{world.active?<Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-400">Active</Badge>:null}</div><div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"><span>Size: {formatBytes(world.sizeBytes)}</span><span>{world.generated?"Generated world":"Created, not generated yet"}</span><span>Modified: {new Date(world.modifiedAt).toLocaleString()}</span></div></div><div className="flex gap-1">{!world.active?<Button size="icon" variant="ghost" title="Set active" disabled={busy||server.status==="online"} onClick={()=>void activate(world)}><CheckCircle2 className="size-4"/></Button>:null}<Button size="icon" variant="ghost" title="Delete" disabled={busy||world.active||server.status==="online"} onClick={()=>setDeleteWorld(world)}><Trash2 className="size-4"/></Button></div></div></Card>)}</div>{items.length===0?<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">No world directories were found.</div>:null}<ConfirmationDialog open={Boolean(deleteWorld)} onOpenChange={(open)=>{if(!open)setDeleteWorld(null)}} title={`Delete ${deleteWorld?.name??"world"}?`} description="This permanently deletes this inactive world directory. The server must remain stopped." confirmLabel="Delete world" destructive onConfirm={remove}/></>;
}
function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;const units=["KB","MB","GB","TB"];let value=bytes/1024;let unit=units[0]!;for(let i=0;i<units.length;i+=1){unit=units[i]!;if(value<1024||i===units.length-1)break;value/=1024}return `${value.toFixed(value>=10?1:2)} ${unit}`;}
