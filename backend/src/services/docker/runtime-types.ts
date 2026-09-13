export const SUPPORTED_JAVA_VERSIONS = [17, 21, 25] as const;
export type JavaVersion = (typeof SUPPORTED_JAVA_VERSIONS)[number];

export const RESTART_POLICIES = ['no', 'on-failure', 'unless-stopped', 'always'] as const;
export type RestartPolicy = (typeof RESTART_POLICIES)[number];

export interface ServerRuntimePaths {
  root: string;
  data: string;
  mods: string;
  config: string;
  logs: string;
  backups: string;
}

export interface VendorContainerDefinition {
  image: string;
  env: Record<string, string>;
  binds: string[];
  exposedPorts: Record<string, Record<string, never>>;
  portBindings: Record<string, Array<{ HostIp: string; HostPort: string }>>;
  healthcheck: {
    test: string[];
    intervalNanoseconds: number;
    timeoutNanoseconds: number;
    retries: number;
    startPeriodNanoseconds: number;
  };
}
