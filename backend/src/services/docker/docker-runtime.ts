import { PassThrough, type Readable } from 'node:stream';
import Docker from 'dockerode';
import type { AppEnv } from '../../config/env.js';
import { AppError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { ContainerMetrics, ServerRecord } from '../../types/domain.js';
import type { ContainerCreateSpec, ContainerRuntime, CreatedContainer } from './container-runtime.js';
import type { MinecraftImageAdapter } from './adapters/minecraft-image-adapter.js';
import { ItzgMinecraftImageAdapter } from './adapters/itzg-adapter.js';
import { prepareServerRuntimeDirectories } from './server-paths.js';
import { containerCreateSpecSchema, vendorContainerDefinitionSchema } from './runtime-schema.js';
import { buildDockerCreateOptions, MANAGED_LABEL, SERVER_ID_LABEL } from './docker-create-options.js';

interface DockerStatsShape {
  cpu_stats?: { cpu_usage?: { total_usage?: number; percpu_usage?: number[] }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; limit?: number };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
}

export class DockerContainerRuntime implements ContainerRuntime {
  private readonly docker: Docker;
  private readonly adapter: MinecraftImageAdapter;

  constructor(private readonly env: AppEnv, adapter: MinecraftImageAdapter = new ItzgMinecraftImageAdapter(env)) {
    this.docker = env.DOCKER_HOST ? new Docker(dockerHostOptions(env.DOCKER_HOST)) : new Docker({ socketPath: env.DOCKER_SOCKET });
    this.adapter = adapter;
  }

  async create(spec: ContainerCreateSpec): Promise<CreatedContainer> {
    containerCreateSpecSchema.parse(spec);
    await prepareServerRuntimeDirectories(this.env, spec.rootPath);
    await this.ensureNetwork();
    const definition = vendorContainerDefinitionSchema.parse(this.adapter.buildDefinition(spec));
    await this.ensureImage(definition.image);
    const container = await this.docker.createContainer(buildDockerCreateOptions(this.env, this.adapter.id, spec, definition));
    return { id: container.id, name: spec.containerName };
  }

  async remove(server: ServerRecord): Promise<void> { const container=await this.getManagedContainer(server,true);if(!container)return;const info=await container.inspect();if(info.State.Running)await container.stop({t:30});await container.remove({force:false,v:false}); }
  async start(server: ServerRecord): Promise<void> { const container=await this.requireManagedContainer(server);const info=await container.inspect();if(!info.State.Running)await container.start(); }
  async stop(server: ServerRecord, timeoutSeconds=30): Promise<void> { const container=await this.requireManagedContainer(server);const info=await container.inspect();if(!info.State.Running)return;await this.command(server,'stop').catch(()=>undefined);const stoppedGracefully=await waitForContainerStop(container,Math.min(timeoutSeconds,25));if(!stoppedGracefully)await container.stop({t:Math.max(5,timeoutSeconds-25)}); }
  async restart(server: ServerRecord, timeoutSeconds=30): Promise<void> { await this.stop(server,timeoutSeconds);await this.start(server); }
  async kill(server: ServerRecord): Promise<void> { const container=await this.requireManagedContainer(server);const info=await container.inspect();if(info.State.Running)await container.kill({signal:'SIGKILL'}); }
  async status(server: ServerRecord): Promise<'running'|'stopped'|'missing'> { const container=await this.getManagedContainer(server,true);if(!container)return'missing';const info=await container.inspect();return info.State.Running?'running':'stopped'; }
  async logs(server: ServerRecord,tail:number):Promise<string[]>{if(!Number.isInteger(tail)||tail<1||tail>5000)throw new ValidationError('Log tail must be between 1 and 5000');const container=await this.requireManagedContainer(server);const raw=(await container.logs({stdout:true,stderr:true,timestamps:true,tail}))as Buffer;return parseDockerLogBuffer(raw);}
  async streamLogs(server:ServerRecord):Promise<Readable>{const container=await this.requireManagedContainer(server);const source=(await container.logs({stdout:true,stderr:true,timestamps:true,follow:true,tail:100}))as NodeJS.ReadableStream;return this.demux(source);}
  async attachConsole(server:ServerRecord):Promise<Readable>{const container=await this.requireManagedContainer(server);const source=(await container.attach({stream:true,stdin:false,stdout:true,stderr:true,logs:true}))as NodeJS.ReadableStream;return this.demux(source);}

  async command(server:ServerRecord,command:string):Promise<string>{
    const container=await this.requireManagedContainer(server);const exec=await container.exec({Cmd:['rcon-cli',command],AttachStdout:true,AttachStderr:true,Tty:false});const stream=(await exec.start({hijack:true,stdin:false}))as NodeJS.ReadableStream;const stdout=new PassThrough();const stderr=new PassThrough();const output:Buffer[]=[];const errors:Buffer[]=[];stdout.on('data',(chunk:Buffer)=>output.push(Buffer.from(chunk)));stderr.on('data',(chunk:Buffer)=>errors.push(Buffer.from(chunk)));this.docker.modem.demuxStream(stream,stdout,stderr);await new Promise<void>((resolve,reject)=>{stream.once('end',resolve);stream.once('close',resolve);stream.once('error',reject);});const inspection=await exec.inspect();const stderrText=Buffer.concat(errors).toString('utf8').trim();if((inspection.ExitCode??1)!==0)throw new AppError(stderrText||'Minecraft command failed',502,'RCON_COMMAND_FAILED');return Buffer.concat(output).toString('utf8').trim();
  }

  async metrics(server:ServerRecord):Promise<ContainerMetrics>{
    const container=await this.requireManagedContainer(server);
    const [raw,inspection]=await Promise.all([container.stats({stream:false}) as Promise<DockerStatsShape>,container.inspect()]);
    const networks=Object.values(raw.networks??{});
    const startedAt=Date.parse(inspection.State.StartedAt||'');
    return {cpuPercent:calculateCpuPercent(raw),memoryUsedBytes:Math.max(0,raw.memory_stats?.usage??0),memoryLimitBytes:Math.max(0,raw.memory_stats?.limit??server.memoryMb*1024*1024),networkRxBytes:networks.reduce((sum,item)=>sum+(item.rx_bytes??0),0),networkTxBytes:networks.reduce((sum,item)=>sum+(item.tx_bytes??0),0),uptimeSeconds:Number.isFinite(startedAt)?Math.max(0,Math.floor((Date.now()-startedAt)/1000)):0};
  }

  private demux(source:NodeJS.ReadableStream):Readable{const stdout=new PassThrough();const stderr=new PassThrough();const merged=new PassThrough();stdout.pipe(merged,{end:false});stderr.pipe(merged,{end:false});let ended=0;const endOne=()=>{ended+=1;if(ended===2)merged.end();};stdout.on('end',endOne);stderr.on('end',endOne);source.on('error',(error)=>merged.destroy(error));source.on('close',()=>{stdout.end();stderr.end();});this.docker.modem.demuxStream(source,stdout,stderr);return merged;}
  private async ensureImage(image:string):Promise<void>{try{await this.docker.getImage(image).inspect();return;}catch(error){if(!isDockerNotFound(error))throw error;}const stream=await this.docker.pull(image);await new Promise<void>((resolve,reject)=>{this.docker.modem.followProgress(stream,(error)=>(error?reject(error):resolve()));});}
  private async ensureNetwork():Promise<void>{try{const network=this.docker.getNetwork(this.env.DOCKER_NETWORK);const info=await network.inspect();if(info.Driver!=='bridge')throw new AppError('Configured Docker network must use the bridge driver',500,'DOCKER_NETWORK_INVALID');return;}catch(error){if(!isDockerNotFound(error))throw error;}await this.docker.createNetwork({Name:this.env.DOCKER_NETWORK,Driver:'bridge',Internal:false,CheckDuplicate:true,Labels:{[MANAGED_LABEL]:'true'}});}
  private async requireManagedContainer(server:ServerRecord):Promise<Docker.Container>{const container=await this.getManagedContainer(server,false);if(!container)throw new AppError('Managed container is missing',409,'CONTAINER_MISSING');return container;}
  private async getManagedContainer(server:ServerRecord,allowMissing:boolean):Promise<Docker.Container|null>{if(!server.containerId){if(allowMissing)return null;throw new AppError('Server has no container assigned',409,'CONTAINER_MISSING');}const container=this.docker.getContainer(server.containerId);try{const info=await container.inspect();const labels=info.Config.Labels??{};if(labels[MANAGED_LABEL]!=='true'||labels[SERVER_ID_LABEL]!==server.id)throw new ForbiddenError('Refusing to control an unmanaged Docker container');return container;}catch(error){if(isDockerNotFound(error)&&allowMissing)return null;throw error;}}
}
function dockerHostOptions(value:string){const url=new URL(value);if(url.protocol!=='tcp:')throw new ValidationError('DOCKER_HOST must use tcp:// when configured');return{protocol:'http',host:url.hostname,port:Number(url.port||'2375')};}
function calculateCpuPercent(stats:DockerStatsShape):number{const cpuDelta=(stats.cpu_stats?.cpu_usage?.total_usage??0)-(stats.precpu_stats?.cpu_usage?.total_usage??0);const systemDelta=(stats.cpu_stats?.system_cpu_usage??0)-(stats.precpu_stats?.system_cpu_usage??0);const cpuCount=stats.cpu_stats?.online_cpus??stats.cpu_stats?.cpu_usage?.percpu_usage?.length??1;if(cpuDelta<=0||systemDelta<=0)return 0;return Math.max(0,(cpuDelta/systemDelta)*cpuCount*100);}
function parseDockerLogBuffer(buffer:Buffer):string[]{const lines:string[]=[];let offset=0;while(offset+8<=buffer.length){const length=buffer.readUInt32BE(offset+4);const frameEnd=offset+8+length;if(frameEnd>buffer.length)break;const text=buffer.subarray(offset+8,frameEnd).toString('utf8');lines.push(...text.split(/\r?\n/u).filter(Boolean));offset=frameEnd;}if(offset===0)return buffer.toString('utf8').split(/\r?\n/u).filter(Boolean);return lines;}
function isDockerNotFound(error:unknown):boolean{return Boolean(error&&typeof error==='object'&&'statusCode'in error&&(error as{statusCode?:unknown}).statusCode===404);}
async function waitForContainerStop(container:Docker.Container,timeoutSeconds:number):Promise<boolean>{const deadline=Date.now()+timeoutSeconds*1000;while(Date.now()<deadline){const info=await container.inspect();if(!info.State.Running)return true;await new Promise((resolve)=>setTimeout(resolve,500));}return false;}
