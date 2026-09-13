"use client";

import { create } from "zustand";
import { apiRequest } from "@/lib/api/client";

export type ServerStatus = "online" | "offline" | "starting" | "stopping" | "creating" | "error";

export interface ServerDto {
  id: string;
  name: string;
  status: ServerStatus;
  version: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: number;
  javaVersion: number;
  restartPolicy: string;
  port: number;
  maxPlayers: number;
  address: string;
  customDomain: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ServerState {
  servers: ServerDto[];
  server: ServerDto | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  initialized: boolean;
  loadServers: () => Promise<void>;
  selectServer: (id: string) => void;
  runAction: (action: "start" | "stop" | "restart" | "kill") => Promise<void>;
  refreshCurrent: () => Promise<void>;
}

const STORAGE_KEY = "1315-panel-current-server";

function rememberedServerId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  server: null,
  loading: false,
  busy: false,
  error: null,
  initialized: false,

  loadServers: async () => {
    set({ loading: true, error: null });
    try {
      const response = await apiRequest<{ servers: ServerDto[] }>("/api/servers");
      const remembered = rememberedServerId();
      const current =
        response.servers.find((item) => item.id === remembered) ?? response.servers[0] ?? null;
      if (typeof window !== "undefined") {
        if (current) window.localStorage.setItem(STORAGE_KEY, current.id);
        else window.localStorage.removeItem(STORAGE_KEY);
      }
      set({ servers: response.servers, server: current, loading: false, initialized: true });
    } catch (error) {
      set({
        loading: false,
        initialized: true,
        error: error instanceof Error ? error.message : "Unable to load servers",
      });
    }
  },

  selectServer: (id) => {
    const selected = get().servers.find((item) => item.id === id) ?? null;
    if (!selected) return;
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, selected.id);
    set({ server: selected });
  },

  refreshCurrent: async () => {
    const current = get().server;
    if (!current) return;
    const response = await apiRequest<{ server: ServerDto }>(`/api/servers/${encodeURIComponent(current.id)}`);
    set((state) => ({
      server: response.server,
      servers: state.servers.map((item) => (item.id === response.server.id ? response.server : item)),
    }));
  },

  runAction: async (action) => {
    const current = get().server;
    if (!current) throw new Error("No server selected");
    set({ busy: true, error: null });
    try {
      const response = await apiRequest<{ server: ServerDto }>(
        `/api/servers/${encodeURIComponent(current.id)}/${action}`,
        { method: "POST" },
      );
      set((state) => ({
        busy: false,
        server: response.server,
        servers: state.servers.map((item) => (item.id === response.server.id ? response.server : item)),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to ${action} server`;
      set({ busy: false, error: message });
      throw error;
    }
  },
}));
