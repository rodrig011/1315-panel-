"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CalendarClock, DatabaseBackup, RefreshCcw, RotateCcw, Save, Trash2 } from "lucide-react";
import { backupsApi, type BackupDto, type BackupProgressEvent, type BackupSettings, type BackupType, type RestoreLog } from "@/lib/api/backups";
import { useServerStore } from "@/lib/stores/server-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

const defaultSettings: BackupSettings = { enabled: false, intervalMinutes: 360, retentionCount: 14, defaultType: "full", lastRunAt: null };

export function BackupList() {
  const serverId = useServerStore((state) => state.server.id);
  const [items, setItems] = useState<BackupDto[]>([]);
  const [settings, setSettings] = useState<BackupSettings>(defaultSettings);
  const [logs, setLogs] = useState<RestoreLog[]>([]);
  const [type, setType] = useState<BackupType>("full");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BackupProgressEvent | null>(null);
  const [confirmAction, setConfirmAction] = useState<{kind:"restore"|"delete"; backup:BackupDto}|null>(null);
  const [confirmAction, setConfirmAction] = useState<{kind:"restore"|"delete"; backup:BackupDto}|null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [backupResponse, settingsResponse, logResponse] = await Promise.all([
        backupsApi.list(serverId),
        backupsApi.settings(serverId),
        backupsApi.restoreLogs(serverId),
      ]);
      setItems(backupResponse.backups);
      setSettings(settingsResponse.settings);
      setLogs(logResponse.logs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load backups");
    }
  }, [serverId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const socket = new WebSocket(backupsApi.progressUrl(serverId));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; data?: BackupProgressEvent };
        if (message.type === "backup-progress" && message.data) {
          setProgress(message.data);
          if (message.data.status === "completed" || message.data.status === "failed") void load();
        }
      } catch {}
    };
    return () => socket.close();
  }, [serverId, load]);

  const scheduledCount = useMemo(() => items.filter((item) => item.source === "scheduled").length, [items]);

  async function createBackup() {
    setBusy(true); setError(null);
    try {
      await backupsApi.create(serverId, { type, notes: notes.trim() || null });
      setNotes("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Backup failed"); }
    finally { setBusy(false); }
  }

  async function restore(backup: BackupDto) {
    setBusy(true); setError(null);
    try { await backupsApi.restore(serverId, backup.id); await load(); window.dispatchEvent(new CustomEvent("mcpanel:toast",{detail:{title:"Restore started",description:"The server will restart automatically when the verified restore completes.",tone:"info"}})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Restore failed"); }
    finally { setBusy(false); }
  }

  async function remove(backup: BackupDto) {
    setBusy(true);
    try { await backupsApi.remove(serverId, backup.id); await load(); window.dispatchEvent(new CustomEvent("mcpanel:toast",{detail:{title:"Backup deleted",tone:"success"}})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed"); }
    finally { setBusy(false); }
  }

  async function saveSettings() {
    setBusy(true); setError(null);
    try { const response = await backupsApi.updateSettings(serverId, settings); setSettings(response.settings); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save backup settings"); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    {error ? <Card className="border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card> : null}
    {progress && progress.status !== "completed" ? <Card className="p-4"><div className="mb-2 flex items-center justify-between text-sm"><span>{progress.message}</span><span className="text-muted-foreground">{progress.progress}%</span></div><Progress value={progress.progress}/></Card> : null}

    <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
      <Card className="p-4">
        <div className="mb-4 flex items-center gap-2"><Archive className="size-4"/><h3 className="text-sm font-medium">Create backup</h3></div>
        <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]">
          <select value={type} onChange={(event)=>setType(event.target.value as BackupType)} className="h-10 rounded-md border border-white/10 bg-black/20 px-3 text-sm outline-none"><option value="full">Full server</option><option value="world">World only</option></select>
          <Input value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Optional note, e.g. before 1.21.2 upgrade" maxLength={500}/>
          <Button onClick={()=>void createBackup()} disabled={busy}><DatabaseBackup className="size-4"/>Create backup</Button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between"><div><div className="flex items-center gap-2"><CalendarClock className="size-4"/><h3 className="text-sm font-medium">Automatic backups</h3></div><p className="mt-1 text-xs text-muted-foreground">{scheduledCount} automatic backup{scheduledCount===1?"":"s"} currently retained</p></div><Badge>{settings.enabled?"Enabled":"Disabled"}</Badge></div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Every (minutes)</span><Input type="number" min={15} value={settings.intervalMinutes} onChange={(e)=>setSettings((s)=>({...s,intervalMinutes:Number(e.target.value)}))}/></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Retention</span><Input type="number" min={1} max={500} value={settings.retentionCount} onChange={(e)=>setSettings((s)=>({...s,retentionCount:Number(e.target.value)}))}/></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Default type</span><select value={settings.defaultType} onChange={(e)=>setSettings((s)=>({...s,defaultType:e.target.value as BackupType}))} className="h-10 w-full rounded-md border border-white/10 bg-black/20 px-3"><option value="full">Full server</option><option value="world">World only</option></select></label>
          <label className="flex items-end"><Button variant={settings.enabled?"default":"outline"} className="w-full" onClick={()=>setSettings((s)=>({...s,enabled:!s.enabled}))}>{settings.enabled?"Automatic on":"Automatic off"}</Button></label>
        </div>
        <Button variant="outline" className="mt-3 w-full" onClick={()=>void saveSettings()} disabled={busy}><Save className="size-4"/>Save schedule</Button>
      </Card>
    </div>

    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><h3 className="text-sm font-medium">Backup archives</h3><p className="text-xs text-muted-foreground">Manual backups are preserved when scheduled retention pruning runs.</p></div><Button size="icon" variant="ghost" onClick={()=>void load()}><RefreshCcw className="size-4"/></Button></div>
      {items.length===0 ? <div className="p-10 text-center text-sm text-muted-foreground">No backups yet.</div> : items.map((backup)=><div key={backup.id} className="grid gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[1.2fr_.6fr_.6fr_.8fr_auto] md:items-center">
        <div><p className="text-sm">{new Date(backup.createdAt).toLocaleString()}</p><p className="text-xs text-muted-foreground">{backup.notes??`${backup.minecraftVersion??"Unknown version"} · ${backup.loader??"Unknown loader"}`}</p></div>
        <Badge className="w-fit">{backup.type === "world" ? "World" : "Full"}</Badge>
        <span className="text-sm text-muted-foreground">{formatBytes(backup.sizeBytes)}</span>
        <span className="text-xs text-muted-foreground">{backup.source === "scheduled" ? "Automatic" : "Manual"}</span>
        <div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Restore" onClick={()=>setConfirmAction({kind:"restore",backup})} disabled={busy}><RotateCcw className="size-4"/></Button><Button size="icon" variant="ghost" title="Delete" onClick={()=>setConfirmAction({kind:"delete",backup})} disabled={busy}><Trash2 className="size-4"/></Button></div>
      </div>)}
    </Card>

    <Card className="p-4"><h3 className="text-sm font-medium">Recent restore activity</h3><div className="mt-3 space-y-2">{logs.length===0?<p className="text-xs text-muted-foreground">No restores recorded.</p>:logs.slice(0,5).map((log)=><div key={log.id} className="flex items-center justify-between text-xs"><span>{new Date(log.startedAt).toLocaleString()} · {log.message??"Restore"}</span><Badge>{log.status}</Badge></div>)}</div></Card>
    <ConfirmationDialog open={Boolean(confirmAction)} onOpenChange={(open)=>{if(!open)setConfirmAction(null)}} title={confirmAction?.kind==="delete"?"Delete backup permanently?":"Restore this backup?"} description={confirmAction?.kind==="delete"?"This archive will be permanently removed and cannot be recovered.":`The server will be stopped safely while this ${confirmAction?.backup.type??""} backup is verified and restored. Current files will be replaced atomically.`} confirmLabel={confirmAction?.kind==="delete"?"Delete backup":"Restore backup"} destructive={confirmAction?.kind==="delete"} onConfirm={()=>confirmAction?.kind==="delete"?remove(confirmAction.backup):confirmAction?restore(confirmAction.backup):undefined}/>
  </div>;
}

function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;const units=["KB","MB","GB","TB"];let value=bytes/1024;let unit=units[0]!;for(let i=0;i<units.length;i+=1){unit=units[i]!;if(value<1024||i===units.length-1)break;value/=1024}return `${value.toFixed(value>=10?1:2)} ${unit}`}
