import type { ContainerCreateSpec } from '../container-runtime.js';
import type { VendorContainerDefinition } from '../runtime-types.js';

export interface MinecraftImageAdapter {
  readonly id: string;
  buildDefinition(spec: ContainerCreateSpec): VendorContainerDefinition;
}
