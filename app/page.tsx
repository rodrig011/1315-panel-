"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Cpu, GaugeCircle, HardDrive, MemoryStick, Network, ServerCog, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { MetricsChart, type MetricsChartPoint } from "@/components/dashboard/metrics-chart";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page";
import { apiRequest, wsUrl } from "@/lib/api/client";
import { backupsApi, type BackupDto } from "@/lib/api/backups";
import { useServerStore } from "@/lib/stores/server-store";

interface CurrentMetric { cpuPercent:number;memoryUsedBytes:number;memoryLimitBytes:number;networkRxBytes:number;networkTxBytes:number;diskUsedBytes:number;tps:number|null;mspt?:number|null;playersOnline:number|null;uptimeSeconds?:number;timestamp:string; }
interface HistoryMetric { cpuPercent:number;ramUsedBytes:number;ramLimitBytes:number;playersOnline:number|null;createdAt:string; }

export default function OverviewPage(){
  const server=useServerStore((state)=>state.server);
  const [current,setCurrent]=useState<CurrentMetric|null>(null);
  const [history,setHistory]=useState<HistoryMetric[]>([]);
  const [backups,setBackups]=useState<BackupDto[]>([]);
  const [error,setError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    if(!server)return;
    try{
      const [metrics,backupResponse]=await Promise.all([
        apiRequest<{current:CurrentMetric;history:HistoryMetric[]}>(`/api/servers/${encodeURIComponent(server.id)}/metrics?minutes=60&limit=240`),
        backupsApi.list(server.id),
      ]);
      setCurrent(metrics.current);setHistory(metrics.history);setBackups(backupResponse.backups);setError(null);
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to load overview");}
  },[server]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!server)return;
    const socket=new WebSocket(wsUrl(`/ws/servers/${encodeURIComponent(server.id)}/metrics`));
    socket.onmessage=(event)=>{try{const message=JSON.parse(String(event.data)) as {type?:string;data?:CurrentMetric};if(message.type==="metrics"&&message.data)setCurrent(message.data);}catch{}};
    socket.onerror=()=>setError("Live metrics connection interrupted; persisted metrics remain available.");
    return()=>socket.close();
  },[server]);

  const chart=useMemo<MetricsChartPoint[]>(()=>history.map((item)=>({time:new Date(item.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),cpu:Number(item.cpuPercent.toFixed(1)),ram:item.ramLimitBytes>0?Number(((item.ramUsedBytes/item.ramLimitBytes)*100).toFixed(1)):0,players:item.playersOnline??0})),[history]);
  const lastBackup=backups[0]??null;

  if(!server)return <div className="space-y-4"><PageHeader title="Overview" description="Create your first Minecraft server to begin."/><Card className="p-10 text-center"><p className="text-sm text-muted-foreground">No servers exist yet.</p><Button asChild className="mt-4"><Link href="/servers/new">Create 1315 SMP</Link></Button></Card></div>;
  const ramPercent=current&&current.memoryLimitBytes>0?(current.memoryUsedBytes/current.memoryLimitBytes)*100:0;

  return <>
    <PageHeader eyebrow={server.name} title="Overview" description="Live Docker and Minecraft health for the selected server." actions={<Button asChild variant="outline" size="sm"><Link href="/settings"><ServerCog className="size-3.5"/>Manage server</Link></Button>}/>
    {error?<Card className="mb-4 border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">{error}</Card>:null}
    <div className="mb-5 grid gap-3 lg:grid-cols-2">{server.status==="online"?<StatusBanner icon={CheckCircle2} title="Server online" text="Docker reports the managed Minecraft container is running." tone="success"/>:<StatusBanner icon={AlertTriangle} title={`Server ${server.status}`} text="Start the server to collect live Minecraft metrics and accept players." tone="warning"/>}{ramPercent>=90?<StatusBanner icon={AlertTriangle} title="Memory pressure" text={`The container is using ${ramPercent.toFixed(1)}% of its configured memory limit.`} tone="warning"/>:<StatusBanner icon={MemoryStick} title="Memory headroom" text={current?`${formatBytes(current.memoryUsedBytes)} of ${formatBytes(current.memoryLimitBytes)} currently used.`:"Waiting for the first metrics sample."} tone="neutral"/>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="CPU usage" value={current?`${current.cpuPercent.toFixed(1)}%`:"—"} meta="Docker container CPU" percent={current?.cpuPercent} icon={Cpu}/><MetricCard label="RAM usage" value={current?`${formatBytes(current.memoryUsedBytes)} / ${formatBytes(current.memoryLimitBytes)}`:"—"} meta="Container memory" percent={ramPercent} icon={MemoryStick}/><MetricCard label="Disk used" value={current?formatBytes(current.diskUsedBytes):"—"} meta="Persistent server directory" icon={HardDrive}/><MetricCard label="TPS" value={current?.tps==null?"—":current.tps.toFixed(2)} meta={current?.tps==null?"Unavailable for this runtime":"Minecraft tick rate"} percent={current?.tps==null?undefined:(current.tps/20)*100} icon={GaugeCircle}/><MetricCard label="MSPT" value={current?.mspt==null?"—":`${current.mspt.toFixed(2)} ms`} meta={current?.mspt==null?"Loader does not expose MSPT":"Measured from server command"} icon={Activity}/><MetricCard label="Players online" value={`${current?.playersOnline??0} / ${server.maxPlayers}`} meta="Real server list" icon={Users}/><MetricCard label="Uptime" value={current?.uptimeSeconds==null?"—":formatDuration(current.uptimeSeconds)} meta="Docker container uptime" icon={Clock3}/><MetricCard label="Network" value={current?`${formatBytes(current.networkRxBytes)} ↓`:"—"} meta={current?`${formatBytes(current.networkTxBytes)} uploaded since start`:"Cumulative container traffic"} icon={Network}/></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-3"><MetricsChart data={chart}/><Card><CardHeader><CardTitle>Operations</CardTitle><p className="text-xs text-muted-foreground">Real server state and backup context.</p></CardHeader><CardContent className="space-y-4"><Fact label="Join address" value={server.address}/><Fact label="Runtime" value={`${server.loader} · Minecraft ${server.version}`}/><Fact label="Memory profile" value={`${server.memoryMb} MB container limit`}/><Fact label="Last backup" value={lastBackup?new Date(lastBackup.createdAt).toLocaleString():"No backups yet"}/><Button asChild variant="outline" className="w-full"><Link href="/backups">Manage backups</Link></Button></CardContent></Card></div>
  </>;
}

function StatusBanner({icon:Icon,title,text,tone}:{icon:typeof CheckCircle2;title:string;text:string;tone:"success"|"warning"|"neutral"}){const style={success:"border-emerald-500/15 bg-emerald-500/[.045] text-emerald-400",warning:"border-amber-500/15 bg-amber-500/[.045] text-amber-400",neutral:"border-white/[.065] bg-white/[.022] text-muted-foreground"}[tone];return <div className={`rounded-2xl border p-4 ${style}`}><div className="flex items-start gap-3"><Icon className="mt-0.5 size-4 shrink-0"/><div><p className="text-[12px] font-semibold text-foreground">{title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{text}</p></div></div></div>}
function Fact({label,value}:{label:string;value:string}){return <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-3 text-sm last:border-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>}
function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;const units=["KB","MB","GB","TB"];let value=bytes/1024;let unit=units[0]!;for(let i=0;i<units.length;i+=1){unit=units[i]!;if(value<1024||i===units.length-1)break;value/=1024}return `${value.toFixed(value>=10?1:2)} ${unit}`}
function formatDuration(seconds:number){const days=Math.floor(seconds/86400);const hours=Math.floor((seconds%86400)/3600);const minutes=Math.floor((seconds%3600)/60);return days>0?`${days}d ${hours}h`:hours>0?`${hours}h ${minutes}m`:`${minutes}m`;}
