"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { modsApi, type BrowseMod, type InstallPlan, type InstalledModDto } from "@/lib/api/mods";
import { useServerStore } from "@/lib/stores/server-store";

type Tab = "browse" | "installed" | "updates";

const categories = [
  "",
  "adventure",
  "cursed",
  "decoration",
  "economy",
  "equipment",
  "food",
  "library",
  "magic",
  "management",
  "minigame",
  "mobs",
  "optimization",
  "social",
  "storage",
  "technology",
  "transportation",
  "utility",
  "worldgen",
];

export function ModrinthMods() {
  const server = useServerStore((state) => state.server);
  const serverId = server?.id;
  const [tab, setTab] = useState<Tab>("browse");
  const [q, setQ] = useState("");
  const [loader, setLoader] = useState("");
  const [version, setVersion] = useState("");
  const [category, setCategory] = useState("");
  const [browse, setBrowse] = useState<BrowseMod[]>([]);
  const [installed, setInstalled] = useState<InstalledModDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [selected, setSelected] = useState<BrowseMod | null>(null);
  const [optionals, setOptionals] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!server) return;
    setLoader(server.loader);
    setVersion(server.version);
  }, [server]);

  const refreshInstalled = useCallback(async () => {
    if (!serverId) return;
    const result = await modsApi.installed(serverId);
    setInstalled(result.mods);
  }, [serverId]);

  useEffect(() => {
    void refreshInstalled().catch((cause) => setError(message(cause)));
  }, [refreshInstalled]);

  useEffect(() => {
    if (!serverId || tab !== "browse" || !loader || !version) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void modsApi
        .search(serverId, { q, minecraftVersion: version, loader, category, limit: 24 })
        .then((result) => setBrowse(result.items))
        .catch((cause) => setError(message(cause)))
        .finally(() => setLoading(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [serverId, tab, q, version, loader, category]);

  const visibleInstalled = useMemo(
    () => (tab === "updates" ? installed.filter((item) => item.updateAvailable) : installed),
    [installed, tab],
  );

  if (!server || !serverId) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
        Create or select a server to manage mods.
      </div>
    );
  }

  if (!["Fabric", "Forge", "NeoForge"].includes(server.loader)) {
    return (
      <Card className="p-8">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-amber-400" />
          <div>
            <h2 className="font-medium">Mods are not managed for {server.loader}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The Modrinth installer only exposes loader-compatible artifacts. Use Plugins for Paper or Files for manual server files.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const openPlan = async (item: BrowseMod) => {
    if (!item.latestCompatibleVersion) {
      setError(`No ${loader} build for Minecraft ${version}.`);
      return;
    }
    setBusy(item.projectId);
    setError(null);
    try {
      const result = await modsApi.plan(serverId, item.projectId, item.latestCompatibleVersion.id);
      setSelected(item);
      setPlan(result);
      setOptionals(new Set());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const install = async () => {
    if (!selected || !plan) return;
    setBusy(selected.projectId);
    try {
      await modsApi.install(serverId, {
        projectId: selected.projectId,
        versionId: plan.versionId,
        optionalDependencyProjectIds: [...optionals],
      });
      setPlan(null);
      setSelected(null);
      await refreshInstalled();
      setTab("installed");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const updateOne = async (mod: InstalledModDto) => {
    setBusy(mod.id);
    try {
      await modsApi.update(serverId, mod.id);
      await refreshInstalled();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (mod: InstalledModDto) => {
    setBusy(mod.id);
    try {
      await modsApi.remove(serverId, mod.id);
      await refreshInstalled();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (mod: InstalledModDto) => {
    setBusy(mod.id);
    try {
      await modsApi.setEnabled(serverId, mod.id, !mod.enabled);
      await refreshInstalled();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const updateAll = async () => {
    setBusy("all");
    try {
      await modsApi.updateAll(serverId);
      await refreshInstalled();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const updateCount = installed.filter((item) => item.updateAvailable).length;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="inline-flex w-fit rounded-lg border bg-white/[.02] p-1">
          {(["browse", "installed", "updates"] as Tab[]).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize ${tab === value ? "bg-white/[.08] text-white" : "text-muted-foreground"}`}
            >
              {value === "updates" ? `Updates Available${updateCount ? ` (${updateCount})` : ""}` : value}
            </button>
          ))}
        </div>

        {tab === "browse" ? (
          <>
            <div className="relative min-w-64 xl:ml-auto">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search Modrinth mods…" />
            </div>
            <FilterSelect value={version} onChange={setVersion} options={[server.version, "1.21.4", "1.21.1", "1.20.6", "1.20.1"]} />
            <FilterSelect value={loader} onChange={setLoader} options={[server.loader]} />
            <FilterSelect value={category} onChange={setCategory} options={categories} label="All categories" />
          </>
        ) : (
          <div className="xl:ml-auto">
            <Button onClick={() => void updateAll()} disabled={busy !== null}>
              <RefreshCw className={`size-4 ${busy === "all" ? "animate-spin" : ""}`} />
              Update all
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[.06] px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      ) : null}

      {tab === "browse" ? (
        loading ? (
          <LoadingGrid />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {browse.map((item) => (
              <Card key={item.projectId} className="p-4">
                <div className="flex gap-4">
                  {item.iconUrl ? (
                    <Image src={item.iconUrl} alt="" width={48} height={48} className="size-12 rounded-xl border object-cover" />
                  ) : (
                    <div className="grid size-12 shrink-0 place-items-center rounded-xl border bg-white/[.04]">
                      <PackageCheck className="size-5 text-emerald-400" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{item.name}</h3>
                      {item.latestCompatibleVersion ? <Badge>{item.latestCompatibleVersion.version}</Badge> : <Badge className="text-amber-300">No compatible build</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                    <div className="mt-3 flex gap-2 text-[11px] text-muted-foreground">
                      <span>by {item.author}</span><span>·</span><span>{formatDownloads(item.downloads)} downloads</span>
                    </div>
                  </div>
                  <Button size="sm" disabled={!item.latestCompatibleVersion || busy === item.projectId} onClick={() => void openPlan(item)}>
                    {busy === item.projectId ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    Install
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {visibleInstalled.map((mod) => (
            <Card key={mod.id} className="p-4">
              <div className="flex items-center gap-4">
                <div className="grid size-12 place-items-center rounded-xl border bg-white/[.04]"><PackageCheck className="size-5 text-emerald-400" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{mod.name}</h3>{mod.version ? <Badge>v{mod.version}</Badge> : null}{mod.updateAvailable ? <Badge className="text-blue-300">Update available</Badge> : null}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{mod.fileName}</p>
                </div>
                <div className="flex gap-1">
                  {mod.updateAvailable ? <Button size="sm" variant="outline" onClick={() => void updateOne(mod)}>Update</Button> : null}
                  <Button size="icon" variant="ghost" onClick={() => void toggle(mod)}>{mod.enabled ? <ToggleRight className="size-5 text-emerald-400" /> : <ToggleLeft className="size-5" />}</Button>
                  <Button size="icon" variant="ghost" onClick={() => void remove(mod)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && ((tab === "browse" && browse.length === 0) || (tab !== "browse" && visibleInstalled.length === 0)) ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {tab === "updates" ? "Everything is up to date." : `No mods found in ${tab}.`}
        </div>
      ) : null}

      {plan && selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={() => { setPlan(null); setSelected(null); }}>
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-auto p-0" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-5">
              <div><h2 className="font-semibold">Install {selected.name}</h2><p className="text-xs text-muted-foreground">{plan.version} · dependency review</p></div>
              <Button size="icon" variant="ghost" onClick={() => { setPlan(null); setSelected(null); }}><X className="size-4" /></Button>
            </div>
            <div className="space-y-3 p-5">
              {plan.dependencies.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-400" />No external dependencies.</div>
              ) : (
                plan.dependencies.map((dependency, index) => (
                  <label key={`${dependency.projectId}-${index}`} className={`flex gap-3 rounded-lg border p-3 ${!dependency.compatible ? "border-amber-500/20 bg-amber-500/[.04]" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={dependency.type === "required" || Boolean(dependency.projectId && optionals.has(dependency.projectId))}
                      disabled={dependency.type !== "optional" || !dependency.compatible || dependency.alreadyInstalled}
                      onChange={() => {
                        if (!dependency.projectId) return;
                        setOptionals((previous) => {
                          const next = new Set(previous);
                          if (next.has(dependency.projectId!)) next.delete(dependency.projectId!); else next.add(dependency.projectId!);
                          return next;
                        });
                      }}
                    />
                    <div>
                      <div className="flex gap-2"><span className="text-sm font-medium">{dependency.name}</span><Badge>{dependency.type}</Badge></div>
                      <p className="mt-1 text-xs text-muted-foreground">{dependency.compatible ? (dependency.selectedVersion ? `Compatible version ${dependency.selectedVersion}` : "Compatible") : dependency.reason}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2 border-t p-5">
              <Button variant="outline" onClick={() => { setPlan(null); setSelected(null); }}>Cancel</Button>
              <Button disabled={!plan.canInstall || busy === selected.projectId} onClick={() => void install()}><Download className="size-4" />Install compatible mods</Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: string[]; label?: string }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border bg-[#0d1016] px-3 text-sm">
      <option value="">{label ?? "All"}</option>
      {[...new Set(options.filter(Boolean))].map((option) => <option key={option}>{option}</option>)}
    </select>
  );
}

function LoadingGrid() {
  return <div className="grid gap-3 xl:grid-cols-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border bg-white/[.025]" />)}</div>;
}

function formatDownloads(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
