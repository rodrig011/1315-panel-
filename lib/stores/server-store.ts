"use client";
import { create } from "zustand";
import { server as initialServer } from "@/lib/mock/data";
import { api } from "@/lib/api/client";
import type { Server, ServerStatus } from "@/types";
interface ServerState { server:Server; busy:boolean; setStatus:(status:ServerStatus)=>void; runAction:(action:"start"|"stop"|"restart")=>Promise<void>; }
export const useServerStore=create<ServerState>((set)=>({server:initialServer,busy:false,setStatus:(status)=>set((s)=>({server:{...s.server,status}})),runAction:async(action)=>{set((s)=>({busy:true,server:{...s.server,status:action==="restart"?"restarting":action==="start"?"starting":"stopping"}}));const status=await api.serverAction(action);set((s)=>({busy:false,server:{...s.server,status}}));}}));
