import { secureHeaders } from "./security";
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

const API_BASE=(process.env.NEXT_PUBLIC_API_URL??"http://localhost:4000").replace(/\/$/,"");
async function request<T>(path:string, init?:RequestInit):Promise<T>{
  const response=await fetch(`${API_BASE}${path}`,{...init,credentials:"include",headers:secureHeaders(init)});
  if(!response.ok){let message=`Request failed (${response.status})`;try{const body=await response.json() as {message?:string};if(body.message)message=body.message;}catch{}throw new Error(message)}
  if(response.status===204)return undefined as T;
  return response.json() as Promise<T>;
}
const qs=(params:Record<string,string|number|undefined>)=>{const s=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!=="")s.set(k,String(v))});return s.toString()};
export const modsApi={
  async installed(serverId:string){return request<{mods:InstalledModDto[]}>(`/api/servers/${encodeURIComponent(serverId)}/mods`)},
  async search(serverId:string,filters:{q:string;minecraftVersion?:string;loader?:string;category?:string;offset?:number;limit?:number}){return request<{items:BrowseMod[];offset:number;limit:number;total:number}>(`/api/servers/${encodeURIComponent(serverId)}/mods/search?${qs(filters)}`)},
  async plan(serverId:string,projectId:string,versionId?:string){return request<InstallPlan>(`/api/servers/${encodeURIComponent(serverId)}/mods/modrinth/${encodeURIComponent(projectId)}/plan?${qs({versionId})}`)},
  async install(serverId:string,input:{projectId:string;versionId?:string;optionalDependencyProjectIds:string[]}){return request<{installed:InstalledModDto[];plan:InstallPlan}>(`/api/servers/${encodeURIComponent(serverId)}/mods/install`,{method:"POST",body:JSON.stringify(input)})},
  async update(serverId:string,modId:string){return request<{mod:InstalledModDto}>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}/update`,{method:"POST"})},
  async updateAll(serverId:string){return request<{updated:InstalledModDto[];skipped:string[]}>(`/api/servers/${encodeURIComponent(serverId)}/mods/update-all`,{method:"POST"})},
  async remove(serverId:string,modId:string){return request<void>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}`,{method:"DELETE"})},
  async setEnabled(serverId:string,modId:string,enabled:boolean){return request<{mod:InstalledModDto}>(`/api/servers/${encodeURIComponent(serverId)}/mods/${encodeURIComponent(modId)}`,{method:"PATCH",body:JSON.stringify({enabled})})},
};
