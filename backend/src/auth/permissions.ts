export const permissions = ['server.manage','console.access','files.access','mods.access','backups.access','players.moderate'] as const;
export type Permission=(typeof permissions)[number];
export type Role='owner'|'admin'|'moderator'|'viewer';
const matrix:Record<Role,ReadonlySet<Permission>>={owner:new Set<Permission>(permissions),admin:new Set<Permission>(permissions),moderator:new Set<Permission>(['console.access','players.moderate']),viewer:new Set<Permission>()};
export function normalizeRole(role:string):Role{return(['owner','admin','moderator','viewer'] as string[]).includes(role)?role as Role:'viewer';}
export function hasPermission(role:string,p:Permission):boolean{return matrix[normalizeRole(role)].has(p);}
export function listPermissions(role:string):Permission[]{return permissions.filter(p=>hasPermission(role,p));}
