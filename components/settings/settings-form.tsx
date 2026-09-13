"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { apiRequest } from "@/lib/api/client";
import { useServerStore } from "@/lib/stores/server-store";

interface SettingsDto {
  general:{serverName:string;motd:string;maxPlayers:number;gamemode:string;difficulty:string;pvp:boolean;whitelist:boolean;onlineMode:boolean};
  performance:{viewDistance:number;simulationDistance:number;ramMb:number;javaVersion:number;restartPolicy:string;jvmFlags:string|null;autoRestartSchedule:string|null};
  version:{minecraftVersion:string;loader:string;loaderVersion:string|null};
  networking:{port:number;customDomain:string|null};
  restartRequired?:boolean;
}

function Field({label,children,hint}:{label:string;children:React.ReactNode;hint?:string}){return <label className="space-y-2"><span className="text-xs font-medium">{label}</span>{children}{hint?<span className="block text-[11px] text-muted-foreground">{hint}</span>:null}</label>}
function Select({value,onChange,children}:{value:string;onChange:(value:string)=>void;children:React.ReactNode}){return <select value={value} onChange={(event)=>onChange(event.target.value)} className="h-9 w-full rounded-lg border bg-black/20 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">{children}</select>}
function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(value:boolean)=>void}){return <button type="button" onClick={()=>onChange(!value)} className="flex w-full items-center justify-between rounded-lg border bg-white/[.02] px-3 py-2.5 text-sm"><span>{label}</span><span className={`relative h-5 w-9 rounded-full transition ${value?"bg-emerald-500":"bg-zinc-700"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${value?"left-[18px]":"left-0.5"}`}/></span></button>}

export function SettingsForm(){
  const server=useServerStore((state)=>state.server);
  const loadServers=useServerStore((state)=>state.loadServers);
  const refreshCurrent=useServerStore((state)=>state.refreshCurrent);
  const [settings,setSettings]=useState<SettingsDto|null>(null);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [deleteOpen,setDeleteOpen]=useState(false);

  useEffect(()=>{
    if(!server){setSettings(null);return;}
    let cancelled=false;
    void apiRequest<{settings:SettingsDto}>(`/api/servers/${encodeURIComponent(server.id)}/settings`).then((response)=>{if(!cancelled)setSettings(response.settings);}).catch((cause)=>{if(!cancelled)setError(cause instanceof Error?cause.message:"Unable to load settings");});
    return()=>{cancelled=true};
  },[server]);

  const patch=<K extends keyof SettingsDto>(section:K,key:keyof SettingsDto[K],value:unknown)=>setSettings((current)=>current?{...current,[section]:{...current[section],[key]:value}}:current);
  const save=async()=>{
    if(!server||!settings)return;
    setSaving(true);setError(null);
    const body={
      serverName:settings.general.serverName,motd:settings.general.motd,maxPlayers:settings.general.maxPlayers,gamemode:settings.general.gamemode,difficulty:settings.general.difficulty,pvp:settings.general.pvp,whitelist:settings.general.whitelist,onlineMode:settings.general.onlineMode,
      viewDistance:settings.performance.viewDistance,simulationDistance:settings.performance.simulationDistance,ramMb:settings.performance.ramMb,javaVersion:settings.performance.javaVersion,restartPolicy:settings.performance.restartPolicy,jvmFlags:settings.performance.jvmFlags||null,autoRestartSchedule:settings.performance.autoRestartSchedule||null,
      minecraftVersion:settings.version.minecraftVersion,loader:settings.version.loader,loaderVersion:settings.version.loaderVersion||null,port:settings.networking.port,customDomain:settings.networking.customDomain||null,
    };
    try{const response=await apiRequest<{settings:SettingsDto}>(`/api/servers/${encodeURIComponent(server.id)}/settings`,{method:"PATCH",body:JSON.stringify(body)});setSettings(response.settings);await refreshCurrent();window.dispatchEvent(new CustomEvent("mcpanel:toast",{detail:{title:"Settings saved",description:response.settings.restartRequired?"Restart the server to apply property changes.":undefined,tone:"success"}}));}catch(cause){setError(cause instanceof Error?cause.message:"Unable to save settings");}finally{setSaving(false);}
  };
  const remove=async()=>{if(!server)return;setSaving(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}`,{method:"DELETE"});await loadServers();window.dispatchEvent(new CustomEvent("mcpanel:toast",{detail:{title:"Server deleted",tone:"success"}}));}catch(cause){setError(cause instanceof Error?cause.message:"Unable to delete server");}finally{setSaving(false);setDeleteOpen(false);}};

  if(!server)return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Create or select a server to configure settings.</div>;
  if(!settings)return <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">{error??"Loading settings…"}</div>;

  return <div className="space-y-5">{error?<Card className="border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>:null}<Card><CardHeader><CardTitle>General</CardTitle><p className="text-xs text-muted-foreground">Core gameplay and server identity.</p></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Field label="Server name"><Input value={settings.general.serverName} onChange={(e)=>patch("general","serverName",e.target.value)}/></Field><Field label="MOTD"><Input value={settings.general.motd} onChange={(e)=>patch("general","motd",e.target.value)}/></Field><Field label="Max players"><Input type="number" min={1} value={settings.general.maxPlayers} onChange={(e)=>patch("general","maxPlayers",Number(e.target.value))}/></Field><Field label="Gamemode"><Select value={settings.general.gamemode} onChange={(v)=>patch("general","gamemode",v)}><option>survival</option><option>creative</option><option>adventure</option><option>spectator</option></Select></Field><Field label="Difficulty"><Select value={settings.general.difficulty} onChange={(v)=>patch("general","difficulty",v)}><option>peaceful</option><option>easy</option><option>normal</option><option>hard</option></Select></Field><div className="grid gap-2"><Toggle label="PVP" value={settings.general.pvp} onChange={(v)=>patch("general","pvp",v)}/><Toggle label="Whitelist" value={settings.general.whitelist} onChange={(v)=>patch("general","whitelist",v)}/><Toggle label="Online mode" value={settings.general.onlineMode} onChange={(v)=>patch("general","onlineMode",v)}/></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Performance</CardTitle><p className="text-xs text-muted-foreground">The 8 GB VPS profile caps Minecraft at 6144 MB so the operating system and panel keep headroom.</p></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Field label="View distance"><Input type="number" value={settings.performance.viewDistance} onChange={(e)=>patch("performance","viewDistance",Number(e.target.value))}/></Field><Field label="Simulation distance"><Input type="number" value={settings.performance.simulationDistance} onChange={(e)=>patch("performance","simulationDistance",Number(e.target.value))}/></Field><Field label="Container RAM (MB)" hint="Maximum allowed on this host profile: 6144 MB"><Input type="number" min={512} max={6144} value={settings.performance.ramMb} onChange={(e)=>patch("performance","ramMb",Number(e.target.value))}/></Field><Field label="Java"><Select value={String(settings.performance.javaVersion)} onChange={(v)=>patch("performance","javaVersion",Number(v))}><option value="17">Java 17</option><option value="21">Java 21</option><option value="25">Java 25</option></Select></Field><Field label="Restart policy"><Select value={settings.performance.restartPolicy} onChange={(v)=>patch("performance","restartPolicy",v)}><option value="unless-stopped">unless-stopped</option><option value="on-failure">on-failure</option><option value="always">always</option><option value="no">no</option></Select></Field><Field label="Auto restart cron"><Input value={settings.performance.autoRestartSchedule??""} onChange={(e)=>patch("performance","autoRestartSchedule",e.target.value)}/></Field><Field label="JVM flags"><Input value={settings.performance.jvmFlags??""} onChange={(e)=>patch("performance","jvmFlags",e.target.value)}/></Field></CardContent></Card>
    <Card><CardHeader><CardTitle>Version</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><Field label="Minecraft version"><Input value={settings.version.minecraftVersion} onChange={(e)=>patch("version","minecraftVersion",e.target.value)}/></Field><Field label="Loader"><Select value={settings.version.loader} onChange={(v)=>patch("version","loader",v)}><option>Vanilla</option><option>Paper</option><option>Fabric</option><option>Forge</option><option>NeoForge</option></Select></Field><Field label="Loader version"><Input value={settings.version.loaderVersion??""} onChange={(e)=>patch("version","loaderVersion",e.target.value)}/></Field></CardContent></Card>
    <Card><CardHeader><CardTitle>Networking</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><Field label="Port"><Input type="number" value={settings.networking.port} onChange={(e)=>patch("networking","port",Number(e.target.value))}/></Field><Field label="Custom domain" hint={`Leave blank to use ${server.address}`}><Input value={settings.networking.customDomain??""} onChange={(e)=>patch("networking","customDomain",e.target.value)}/></Field></CardContent></Card>
    <div className="flex justify-end"><Button onClick={()=>void save()} disabled={saving}><Save className="size-4"/>{saving?"Saving…":"Save settings"}</Button></div>
    <Card className="border-red-500/20 bg-red-500/[.035]"><CardHeader><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-red-400"/><CardTitle className="text-red-300">Danger Zone</CardTitle></div><p className="text-xs text-muted-foreground">Only operations implemented safely by the backend are shown here.</p></CardHeader><CardContent><Button variant="destructive" onClick={()=>setDeleteOpen(true)}><Trash2 className="size-4"/>Delete server</Button></CardContent></Card>
    <ConfirmationDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={`Delete ${server.name}?`} description="This removes the managed Docker container and the server data directory. This action cannot be undone." confirmLabel="Delete server" destructive onConfirm={remove}/>
  </div>;
}
