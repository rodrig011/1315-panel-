"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Download, FileCode2, FileJson2, Folder, FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest } from "@/lib/api/client";
import { useServerStore } from "@/lib/stores/server-store";

interface FileEntryDto { name:string; path:string; type:"file"|"directory"; sizeBytes:number|null; modifiedAt:string; }

export function FileManager(){
  const server=useServerStore((state)=>state.server);
  const [entries,setEntries]=useState<FileEntryDto[]>([]);
  const [path,setPath]=useState("");
  const [editing,setEditing]=useState<FileEntryDto|null>(null);
  const [content,setContent]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const uploadRef=useRef<HTMLInputElement>(null);

  const load=useCallback(async()=>{
    if(!server)return;
    setError(null);
    try{const response=await apiRequest<{files:FileEntryDto[]}>(`/api/servers/${encodeURIComponent(server.id)}/files?path=${encodeURIComponent(path)}`);setEntries(response.files);}catch(cause){setError(message(cause));}
  },[server,path]);
  useEffect(()=>{void load();},[load]);

  const breadcrumbs=path?path.split("/"):[];
  const openFolder=(entry:FileEntryDto)=>{if(entry.type==="directory")setPath(entry.path);};
  const edit=async(entry:FileEntryDto)=>{if(!server)return;setBusy(true);try{const response=await apiRequest<{content:string}>(`/api/servers/${encodeURIComponent(server.id)}/files/content?path=${encodeURIComponent(entry.path)}`);setContent(response.content);setEditing(entry);}catch(cause){setError(message(cause));}finally{setBusy(false);}};
  const save=async()=>{if(!server||!editing)return;setBusy(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}/files/content?path=${encodeURIComponent(editing.path)}`,{method:"PUT",body:JSON.stringify({content})});setEditing(null);await load();}catch(cause){setError(message(cause));}finally{setBusy(false);}};
  const remove=async(entry:FileEntryDto)=>{if(!server||!window.confirm(`Delete ${entry.name}?`))return;setBusy(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}/files?path=${encodeURIComponent(entry.path)}`,{method:"DELETE"});await load();}catch(cause){setError(message(cause));}finally{setBusy(false);}};
  const createFolder=async()=>{if(!server)return;const name=window.prompt("Folder name");if(!name)return;const target=[path,name.trim()].filter(Boolean).join("/");setBusy(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}/files/folder`,{method:"POST",body:JSON.stringify({path:target})});await load();}catch(cause){setError(message(cause));}finally{setBusy(false);}};
  const rename=async(entry:FileEntryDto)=>{if(!server)return;const name=window.prompt("New name",entry.name);if(!name||name===entry.name)return;const parent=entry.path.split("/").slice(0,-1).join("/");const to=[parent,name.trim()].filter(Boolean).join("/");setBusy(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}/files`,{method:"PATCH",body:JSON.stringify({from:entry.path,to})});await load();}catch(cause){setError(message(cause));}finally{setBusy(false);}};
  const upload=async(file:File)=>{if(!server)return;const form=new FormData();form.append("file",file);setBusy(true);try{await apiRequest(`/api/servers/${encodeURIComponent(server.id)}/files/upload?path=${encodeURIComponent(path)}`,{method:"POST",body:form});await load();}catch(cause){setError(message(cause));}finally{setBusy(false);if(uploadRef.current)uploadRef.current.value="";}};
  const download=(entry:FileEntryDto)=>{if(!server||entry.type!=="file")return;window.location.assign(`/api/servers/${encodeURIComponent(server.id)}/files/download?path=${encodeURIComponent(entry.path)}`);};

  if(!server)return <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Create or select a server to browse files.</div>;

  return <>
    {error?<Card className="mb-3 border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>:null}
    <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center"><div className="flex flex-wrap items-center text-sm text-muted-foreground"><button onClick={()=>setPath("")} className="hover:text-white">root</button>{breadcrumbs.map((part,index)=><span key={`${part}-${index}`} className="flex items-center"><ChevronRight className="mx-1 size-3"/><button className="hover:text-white" onClick={()=>setPath(breadcrumbs.slice(0,index+1).join("/"))}>{part}</button></span>)}</div><div className="flex gap-2 sm:ml-auto"><input ref={uploadRef} type="file" className="hidden" onChange={(event)=>{const file=event.target.files?.[0];if(file)void upload(file);}}/><Button variant="outline" size="sm" disabled={busy} onClick={()=>uploadRef.current?.click()}><Upload className="size-3.5"/>Upload</Button><Button size="sm" disabled={busy} onClick={()=>void createFolder()}><FolderPlus className="size-3.5"/>New folder</Button></div></div>
      <div className="hidden grid-cols-[1fr_120px_170px_150px] border-b bg-white/[.02] px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground md:grid"><span>Name</span><span>Size</span><span>Modified</span><span className="text-right">Actions</span></div>
      {entries.length===0?<div className="p-10 text-center text-sm text-muted-foreground">This folder is empty.</div>:entries.map((entry)=><div key={entry.path} className="grid gap-2 border-b px-4 py-3 text-sm last:border-0 hover:bg-white/[.02] md:grid-cols-[1fr_120px_170px_150px] md:items-center"><button onClick={()=>openFolder(entry)} className="flex min-w-0 items-center gap-3 text-left"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[.04]">{entry.type==="directory"?<Folder className="size-4 text-blue-400"/>:entry.name.endsWith("json")?<FileJson2 className="size-4 text-amber-400"/>:<FileCode2 className="size-4 text-emerald-400"/>}</span><span className="truncate">{entry.name}</span></button><span className="text-muted-foreground">{entry.sizeBytes===null?"—":formatBytes(entry.sizeBytes)}</span><span className="text-xs text-muted-foreground">{new Date(entry.modifiedAt).toLocaleString()}</span><div className="flex justify-end gap-1">{entry.type==="file"?<><Button size="icon" variant="ghost" onClick={()=>void edit(entry)} title="Edit"><Pencil className="size-3.5"/></Button><Button size="icon" variant="ghost" onClick={()=>download(entry)} title="Download"><Download className="size-3.5"/></Button></>:null}<Button size="sm" variant="ghost" onClick={()=>void rename(entry)}>Rename</Button><Button size="icon" variant="ghost" onClick={()=>void remove(entry)} title="Delete"><Trash2 className="size-3.5"/></Button></div></div>)}
    </Card>
    {editing?<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={()=>setEditing(null)}><div className="w-full max-w-3xl rounded-xl border bg-[#0d1016] shadow-2xl" onMouseDown={(event)=>event.stopPropagation()}><div className="flex items-center justify-between border-b px-5 py-4"><div><p className="font-medium">Edit {editing.name}</p><p className="text-xs text-muted-foreground">Saved directly to this server.</p></div><Button variant="ghost" onClick={()=>setEditing(null)}>Close</Button></div><div className="p-5"><textarea className="h-80 w-full resize-none rounded-lg border bg-black/30 p-4 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/30" value={content} onChange={(event)=>setContent(event.target.value)}/><div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={()=>setEditing(null)}>Cancel</Button><Button disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Save changes"}</Button></div></div></div></div>:null}
  </>;
}

function formatBytes(bytes:number){if(bytes<1024)return `${bytes} B`;const units=["KB","MB","GB","TB"];let value=bytes/1024;let unit=units[0]!;for(let index=0;index<units.length;index+=1){unit=units[index]!;if(value<1024||index===units.length-1)break;value/=1024}return `${value.toFixed(value>=10?1:2)} ${unit}`;}
function message(error:unknown){return error instanceof Error?error.message:"Unexpected error";}
