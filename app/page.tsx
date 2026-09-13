import Link from "next/link";
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock3, Cpu, GaugeCircle, HardDrive, MemoryStick, Network, PackageCheck, ServerCog, ShieldCheck, Sparkles, Users, Wrench } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { MetricsChart } from "@/components/dashboard/metrics-chart";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page";
import { activity,server } from "@/lib/mock/data";

const onboarding = [
  ["Create your first server", true],
  ["Review resource allocation", true],
  ["Configure automatic backups", false],
  ["Enable two-factor authentication", false],
] as const;

export default function OverviewPage(){return <>
  <PageHeader eyebrow="BetterMC Survival" title="Overview" description="Live health, performance, and operational context for your Minecraft server." actions={<Button variant="outline" size="sm"><ServerCog className="size-3.5"/>Manage server</Button>}/>

  <div className="mb-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
    <StatusBanner icon={CheckCircle2} title="Server healthy" text="TPS is stable and the node agent is responding normally." tone="success" />
    <StatusBanner icon={AlertTriangle} title="Memory pressure" text="RAM usage has crossed 95%. Consider adding 2 GB before peak hours." tone="warning" action="Review resources" />
    <StatusBanner icon={PackageCheck} title="3 updates available" text="Compatible mod updates are ready for this server version." tone="info" action="Review updates" />
    <StatusBanner icon={Wrench} title="Maintenance window" text="Automatic restart scheduled Sunday at 04:00 local time." tone="neutral" />
  </div>

  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="CPU usage" value={`${server.cpu}%`} meta="4 vCPU allocated" percent={server.cpu} icon={Cpu}/><MetricCard label="RAM usage" value={`${server.ramUsed} / ${server.ramTotal} GB`} meta="97.5% allocated" percent={(server.ramUsed/server.ramTotal)*100} icon={MemoryStick}/><MetricCard label="Disk usage" value={`${server.diskUsed} / ${server.diskTotal} GB`} meta="62 GB available" percent={(server.diskUsed/server.diskTotal)*100} icon={HardDrive}/><MetricCard label="TPS" value={String(server.tps)} meta="Healthy tick rate" percent={(server.tps/20)*100} icon={GaugeCircle}/><MetricCard label="Players online" value={`${server.players} / ${server.maxPlayers}`} meta="2 players active >1h" icon={Users}/><MetricCard label="Uptime" value={server.uptime} meta="Last restart Sep 9" icon={Clock3}/><MetricCard label="Network" value="4.8 Mbps" meta="1.3 Mbps upload" percent={38} icon={Network}/><MetricCard label="Server state" value="Online" meta="No incidents detected" percent={100} icon={Activity}/></div>

  <div className="mt-5 grid gap-5 xl:grid-cols-3"><MetricsChart/><Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Recent activity</CardTitle><p className="mt-1 text-xs text-muted-foreground">Server and player events</p></div><Badge className="bg-white/[.04] text-muted-foreground">Live</Badge></CardHeader><CardContent className="space-y-0">{activity.map((item,i)=><div key={item} className="group flex gap-3 border-b border-white/[.055] py-3.5 last:border-0"><span className="mt-1.5 size-2 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,.35)]"/><div className="min-w-0"><p className="text-[13px] leading-5">{item}</p><p className="mt-1 text-[10px] text-muted-foreground">{i*11+3} min ago</p></div></div>)}</CardContent></Card></div>

  <div className="mt-5 grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Getting started</CardTitle><p className="mt-1 text-xs text-muted-foreground">Finish the essentials for a resilient production server.</p></div><span className="text-xs font-medium text-emerald-400">2 of 4</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"/></div></CardHeader><CardContent className="space-y-1">{onboarding.map(([label,done])=><button key={label} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-white/[.035]"><span className={`grid size-6 place-items-center rounded-full border ${done?"border-emerald-500/20 bg-emerald-500/10 text-emerald-400":"border-white/[.08] bg-white/[.02] text-muted-foreground"}`}>{done?<CheckCircle2 className="size-3.5"/>:<span className="size-1.5 rounded-full bg-current"/>}</span><span className={`flex-1 text-[13px] ${done?"text-muted-foreground line-through decoration-white/20":"font-medium"}`}>{label}</span><ChevronRight className="size-3.5 text-muted-foreground"/></button>)}</CardContent></Card>
    <Card className="overflow-hidden"><CardContent className="relative p-6"><div className="absolute -right-12 -top-12 size-40 rounded-full bg-emerald-400/[.07] blur-3xl"/><div className="relative"><div className="grid size-10 place-items-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400"><Sparkles className="size-4"/></div><h3 className="mt-4 text-base font-semibold tracking-tight">Launch another server</h3><p className="mt-1.5 text-xs leading-5 text-muted-foreground">Use the guided setup to choose a version, loader, memory profile and world configuration.</p><Button asChild className="mt-5"><Link href="/servers/new">Start setup<ChevronRight className="size-4"/></Link></Button></div></CardContent></Card>
  </div>
</>}

function StatusBanner({icon:Icon,title,text,tone,action}:{icon:typeof ShieldCheck;title:string;text:string;tone:"success"|"warning"|"info"|"neutral";action?:string}){const style={success:"border-emerald-500/15 bg-emerald-500/[.045] text-emerald-400",warning:"border-amber-500/15 bg-amber-500/[.045] text-amber-400",info:"border-sky-500/15 bg-sky-500/[.045] text-sky-400",neutral:"border-white/[.065] bg-white/[.022] text-muted-foreground"}[tone];return <div className={`rounded-2xl border p-4 ${style}`}><div className="flex items-start gap-3"><div className="grid size-8 shrink-0 place-items-center rounded-xl bg-current/5"><Icon className="size-4"/></div><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-foreground">{title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{text}</p>{action?<button className="mt-2 text-[10px] font-semibold text-current hover:underline">{action} →</button>:null}</div></div></div>}
