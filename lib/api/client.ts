import type { ServerStatus } from "@/types";
const sleep=(ms=350)=>new Promise((r)=>setTimeout(r,ms));
export const api = {
  async serverAction(action:"start"|"stop"|"restart"):Promise<ServerStatus>{ await sleep(); return action==="stop"?"offline":"online"; },
  async sendCommand(command:string){ await sleep(120); return {ok:true,command}; },
  async uploadFile(_file:File){ await sleep(500); return {ok:true}; },
  async createBackup(){ await sleep(700); return {ok:true}; },
  async saveSettings<T>(settings:T){ await sleep(400); return settings; },
  async marketplaceAction(_id:string,_action:"install"|"uninstall"|"enable"|"disable"|"update"){ await sleep(450); return {ok:true}; }
};
