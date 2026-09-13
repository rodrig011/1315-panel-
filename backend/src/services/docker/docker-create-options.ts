import type { AppEnv } from '../../config/env.js';
import type { ContainerCreateSpec } from './container-runtime.js';
import type { VendorContainerDefinition } from './runtime-types.js';

export const MANAGED_LABEL = 'com.minecraft-panel.managed';
export const SERVER_ID_LABEL = 'com.minecraft-panel.server-id';
export const RUNTIME_LABEL = 'com.minecraft-panel.runtime';

export function buildDockerCreateOptions(
  env: AppEnv,
  adapterId: string,
  spec: ContainerCreateSpec,
  definition: VendorContainerDefinition,
) {
  return {
    Image: definition.image,
    name: spec.containerName,
    Env: Object.entries(definition.env).map(([key, value]) => `${key}=${value}`),
    Labels: {
      [MANAGED_LABEL]: 'true',
      [SERVER_ID_LABEL]: spec.serverId,
      [RUNTIME_LABEL]: adapterId,
    },
    ExposedPorts: definition.exposedPorts,
    OpenStdin: false,
    Tty: false,
    Healthcheck: {
      Test: definition.healthcheck.test,
      Interval: definition.healthcheck.intervalNanoseconds,
      Timeout: definition.healthcheck.timeoutNanoseconds,
      Retries: definition.healthcheck.retries,
      StartPeriod: definition.healthcheck.startPeriodNanoseconds,
    },
    HostConfig: {
      Binds: definition.binds,
      PortBindings: definition.portBindings,
      NetworkMode: env.DOCKER_NETWORK,
      Memory: spec.memoryMb * 1024 * 1024,
      MemorySwap: spec.memoryMb * 1024 * 1024,
      RestartPolicy: { Name: spec.restartPolicy, MaximumRetryCount: 0 },
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: env.MC_MANAGE_OWNERSHIP
        ? ['SETGID', 'SETUID']
        : ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
      SecurityOpt: ['no-new-privileges:true'],
      PidsLimit: 512,
      LogConfig: { Type: 'json-file', Config: { 'max-size': '10m', 'max-file': '3' } },
    },
    NetworkingConfig: {
      EndpointsConfig: { [env.DOCKER_NETWORK]: {} },
    },
  };
}
