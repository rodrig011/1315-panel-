"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Archive,
  Bell,
  Box,
  Boxes,
  Command,
  FileText,
  FolderTree,
  Gauge,
  HardDrive,
  Search,
  Server,
  Settings,
  TerminalSquare,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastCenter } from "@/components/product/toast-center";

const destinations = [
  ["Overview", "/", Gauge, "Server health, metrics and recent activity"],
  ["Console", "/console", TerminalSquare, "Live logs and server commands"],
  ["Files", "/files", FolderTree, "Browse and edit server files"],
  ["Mods", "/mods", Boxes, "Installed mods, Modrinth and updates"],
  ["Plugins", "/plugins", Box, "Paper and Spigot plugins"],
  ["Worlds", "/worlds", HardDrive, "Worlds, seeds and active world"],
  ["Backups", "/backups", Archive, "Archives, schedules and restores"],
  ["Players", "/players", Users, "Players, whitelist and moderation"],
  ["Settings", "/settings", Settings, "General, performance and networking"],
] as const;

const notices = [
  { title: "RAM pressure is high", detail: "BetterMC is using 7.8 of 8 GB allocated memory.", age: "4m", tone: "warning" },
  { title: "Mod updates available", detail: "3 installed mods have compatible updates ready.", age: "27m", tone: "info" },
  { title: "Backup completed", detail: "Scheduled world backup finished successfully.", age: "2h", tone: "success" },
] as const;

export function ProductLayer({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    const onPalette = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mcpanel:palette", onPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mcpanel:palette", onPalette);
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter(([label, , , detail]) => `${label} ${detail}`.toLowerCase().includes(needle));
  }, [query]);

  return <>
    {children}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content className="fixed left-1/2 top-[14vh] z-[90] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#0c0f15]/98 shadow-2xl shadow-black/60 outline-none">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-white/[.07] px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search pages, settings and actions…"
              className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              aria-label="Global search"
            />
            <kbd className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-[10px] text-muted-foreground">ESC</kbd>
          </div>
          <div className="max-h-[420px] overflow-y-auto p-2 scrollbar-thin">
            <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Navigate</p>
            {filtered.map(([label, href, Icon, detail]) => <button
              key={href}
              onClick={() => { router.push(href); setOpen(false); setQuery(""); }}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[.055] focus-visible:bg-white/[.055] focus-visible:outline-none"
            >
              <span className="grid size-9 place-items-center rounded-lg border border-white/[.06] bg-white/[.025] text-muted-foreground transition group-hover:text-foreground"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{detail}</span></span>
              <span className="text-[11px] text-muted-foreground opacity-0 transition group-hover:opacity-100">Open</span>
            </button>)}
            {filtered.length === 0 && <div className="px-5 py-12 text-center"><Search className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No matches</p><p className="mt-1 text-xs text-muted-foreground">Try a server page, setting, or feature name.</p></div>}
          </div>
          <div className="flex items-center justify-between border-t border-white/[.07] bg-white/[.015] px-4 py-2.5 text-[10px] text-muted-foreground"><span>↑↓ Navigate · Enter open</span><span className="flex items-center gap-1"><Command className="size-3" /> K anywhere</span></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <ToastCenter />
  </>;
}

export function NotificationMenu() {
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="relative grid size-9 place-items-center rounded-lg border border-white/[.07] bg-white/[.025] text-muted-foreground transition hover:bg-white/[.055] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70" aria-label="Open notifications">
        <Bell className="size-4" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-400 ring-2 ring-[#090b10]" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={10} className="z-[70] w-[360px] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1016]/98 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-white/[.07] px-4 py-3"><div><p className="text-sm font-semibold">Notifications</p><p className="text-[11px] text-muted-foreground">3 items need your attention</p></div><button className="text-[11px] text-muted-foreground hover:text-white">Mark all read</button></div>
        <div className="p-2">{notices.map((notice) => <DropdownMenu.Item key={notice.title} className="flex cursor-default gap-3 rounded-xl px-3 py-3 outline-none hover:bg-white/[.04] focus:bg-white/[.04]">
          <span className={cn("mt-1.5 size-2 rounded-full", notice.tone === "warning" ? "bg-amber-400" : notice.tone === "success" ? "bg-emerald-400" : "bg-sky-400")} />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{notice.title}</span><span className="text-[10px] text-muted-foreground">{notice.age}</span></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{notice.detail}</span></span>
        </DropdownMenu.Item>)}</div>
        <div className="border-t border-white/[.07] p-2"><DropdownMenu.Item className="flex cursor-default items-center justify-center gap-2 rounded-lg py-2 text-xs text-muted-foreground outline-none hover:bg-white/[.04] hover:text-white focus:bg-white/[.04]"><Activity className="size-3.5" />View activity center</DropdownMenu.Item></div>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
