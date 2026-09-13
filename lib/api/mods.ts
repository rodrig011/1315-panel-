import { apiRequest } from "./client";
export interface InstalledModDto {
  id:string; name:string; version:string|null; fileName:string; enabled:boolean; source:string|null;
  sourceProjectId:string|null; sourceVersionId:string|null; updateAvailable?:boolean; latestVersion?:string|null;
}
export interface BrowseMod {
  projectId:string; slug:string|null; name:string; author:string; description:string; iconUrl:string|null;
  downloads:number; categories:string[]; gameVersions:string[];
  latestCompatibleVersion:{id:string;name:string;version:string;loaders:string[];gameVersions:string[]}|null;
}
export interface DependencyPlanItem {
  projectId:string|null; versionId:string|null; name:string; type:"required"|"optional"|"incompatible";
  compatible:boolean; reason:string|null; selectedVersion:string|null; alreadyInstalled:boolean;
}
export interface InstallPlan { projectId:string; versionId:string; version:string; dependencies:DependencyPlanItem[]; canInstall:boolean; warnings:string[]; }
const qs=(params:Record<string,string|number|undefined>)=>{const s=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!=="")s.set(k,String(v))});return s.toString()};
export const modsApi={
  async installed(serverId:string){return apiRequest<{mods:InstalledModDto[]}>(`/api/servers/${encodeURIComponent(serverId)}/mods`)},
  async search(serverId:string,filters:{q:string;minecraftVersion?:string;loader?:string;category?:string;offset?:number;limit?:number}){return apiRequest<{items:BrowseMod[];offset:number;limit:number;total:number}>(`/api/servers/${encodeURIComponent(serverId)}/mods/search?${qs(filters)}`)},
  async plan(serverId:string,projectId:string,versionId?:string){return apiRequest<InstallPlan>(`/api/servers/${encodeURIComponent(serverId)}/mods/modrinth/${encodeURIComponent(projectId)}/plan?${qs({versionId})}`)},
  async install(serverId:string,input:{projectId:string;versionId?:string;optionalDependencyProjectIds:string[]}){return apiRequest<{installed:InstalledModDto[];plan:InstallPlan}>(`/api/servers/${encodeURIComponent(serverId)}/mods/install`,{method:"POST",body:JSON.stringify(input)})},
  async update(serverId:string,modId:string){return apiRequest<{mod:InstalledModDto}>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}/update`,{method:"POST"})},
  async updateAll(serverId:string){return apiRequest<{updated:InstalledModDto[];skipped:string[]}>(`/api/servers/${encodeURIComponent(serverId)}/mods/update-all`,{method:"POST"})},
  async remove(serverId:string,modId:string){return apiRequest<void>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}`,{method:"DELETE"})},
  async setEnabled(serverId:string,modId:string,enabled:boolean){return apiRequest<{mod:InstalledModDto}>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}`,{method:"PATCH",body:JSON.stringify({enabled})})},
};
