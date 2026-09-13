import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { ItzgMinecraftImageAdapter } from '../../src/services/docker/adapters/itzg-adapter.js';
import type { ContainerCreateSpec } from '../../src/services/docker/container-runtime.js';
import { containerCreateSpecSchema, vendorContainerDefinitionSchema } from '../../src/services/docker/runtime-schema.js';
import { buildDockerCreateOptions } from '../../src/services/docker/docker-create-options.js';

const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY',
  AUTH_RECOVERY_PEPPER: '0123456789abcdef0123456789abcdef',
  ADMIN_PASSWORD: 'correct-horse-battery-staple',
  SERVER_DATA_ROOT: '/srv/mcpanel/servers',
  MINECRAFT_IMAGE_REPOSITORY: 'itzg/minecraft-server',
  DOCKER_NETWORK: 'mcpanel-internal',
  MC_BIND_ADDRESS: '0.0.0.0',
  MC_MANAGE_OWNERSHIP: 'false',
});

describe('itzg runtime container configuration', () => {
  it('produces an isolated NeoForge container definition with persistent mounts', () => {
    const adapter = new ItzgMinecraftImageAdapter(env);
    const spec: ContainerCreateSpec = {
      serverId: 'server-123',
      containerName: 'mcpanel-server-123',
      rootPath: '/srv/mcpanel/servers/server-123',
      version: '1.21.1',
      loader: 'NeoForge',
      loaderVersion: null,
      memoryMb: 8192,
      javaVersion: 21,
      restartPolicy: 'unless-stopped',
      port: 25565,
      maxPlayers: 10,
      jvmFlags: null,
    };

    expect(containerCreateSpecSchema.safeParse(spec).success).toBe(true);
    const definition = vendorContainerDefinitionSchema.parse(adapter.buildDefinition(spec));

    expect(definition.image).toBe('itzg/minecraft-server:java21');
    expect(definition.env.EULA).toBe('TRUE');
    expect(definition.env.TYPE).toBe('NEOFORGE');
    expect(definition.env.VERSION).toBe('1.21.1');
    expect(definition.env.MEMORY).toBe('6144M');
    expect(definition.env.RCON_PASSWORD).toBeTruthy();
    expect(definition.binds).toEqual([
      '/srv/mcpanel/servers/server-123/data:/data',
      '/srv/mcpanel/servers/server-123/mods:/data/mods',
      '/srv/mcpanel/servers/server-123/config:/data/config',
      '/srv/mcpanel/servers/server-123/logs:/data/logs',
    ]);
    expect(definition.portBindings).toEqual({
      '25565/tcp': [{ HostIp: '0.0.0.0', HostPort: '25565' }],
    });
    expect(Object.keys(definition.exposedPorts)).toEqual(['25565/tcp']);
    expect(definition.healthcheck.test).toEqual(['CMD', 'mc-health']);

    const dockerConfig = buildDockerCreateOptions(env, adapter.id, spec, definition);
    expect(dockerConfig.HostConfig.NetworkMode).toBe('mcpanel-internal');
    expect(dockerConfig.HostConfig.Privileged).toBe(false);
    expect(dockerConfig.HostConfig.CapDrop).toEqual(['ALL']);
    expect(dockerConfig.HostConfig.RestartPolicy.Name).toBe('unless-stopped');
    expect(dockerConfig.HostConfig.Memory).toBe(8192 * 1024 * 1024);
    expect(dockerConfig.HostConfig.PidsLimit).toBe(512);
    expect(dockerConfig.NetworkingConfig.EndpointsConfig).toEqual({ 'mcpanel-internal': {} });
    expect(dockerConfig.Labels['com.minecraft-panel.managed']).toBe('true');
  });
});
