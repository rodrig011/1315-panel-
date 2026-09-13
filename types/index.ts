export type ServerStatus = "online" | "offline" | "starting" | "stopping" | "restarting";
export interface Server { id:string; name:string; status:ServerStatus; version:string; loader:string; ramUsed:number; ramTotal:number; cpu:number; diskUsed:number; diskTotal:number; tps:number; players:number; maxPlayers:number; uptime:string; ip:string; }
export interface MetricPoint { time:string; cpu:number; ram:number; players:number; network:number; }
export interface ConsoleLine { id:string; time:string; level:"INFO"|"WARN"|"ERROR"|"CHAT"; message:string; }
export interface FileEntry { id:string; name:string; type:"file"|"folder"; size?:string; modified:string; }
export interface MarketplaceItem { id:string; name:string; author:string; version:string; description:string; installed:boolean; enabled:boolean; updateAvailable?:boolean; loader:string; gameVersion:string; downloads:string; }
export interface World { id:string; name:string; seed:string; size:string; lastPlayed:string; active:boolean; }
export interface Backup { id:string; createdAt:string; type:"Automatic"|"Manual"; size:string; status:"Ready"|"Creating"; }
export interface Player { id:string; username:string; uuid:string; ping:number; playtime:string; op:boolean; whitelisted:boolean; online:boolean; }
