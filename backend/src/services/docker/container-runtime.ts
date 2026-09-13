import type { Readable } from 'node:stream';
import type { ContainerMetrics, ServerRecord } from '../../types/domain.js';
import type { JavaVersion, RestartPolicy } from './runtime-types.js';

export interface ContainerCreateSpec {
  serverId: string;
  containerName: string;
  rootPath: string;
  version: string;
  loader: string;
  loaderVersion: string | null;
  memoryMb: number;
  javaVersion: JavaVersion;
  restartPolicy: RestartPolicy;
  port: number;
  maxPlayers: number;
  jvmFlags: string | null;
}

export interface CreatedContainer {
  id: string;
  name: string;
}

export interface ContainerRuntime {
  create(spec: ContainerCreateSpec): Promise<CreatedContainer>;
  remove(server: ServerRecord): Promise<void>;
  start(server: ServerRecord): Promise<void>;
  stop(server: ServerRecord, timeoutSeconds?: number): Promise<void>;
  restart(server: ServerRecord, timeoutSeconds?: number): Promise<void>;
  kill(server: ServerRecord): Promise<void>;
  status(server: ServerRecord): Promise<'running' | 'stopped' | 'missing'>;
  logs(server: ServerRecord, tail: number): Promise<string[]>;
  streamLogs(server: ServerRecord): Promise<Readable>;
  attachConsole(server: ServerRecord): Promise<Readable>;
  command(server: ServerRecord, command: string): Promise<string>;
  metrics(server: ServerRecord): Promise<ContainerMetrics>;
}
