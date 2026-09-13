import { PageHeader } from "@/components/shared/page"; import { ServerWizard } from "@/components/wizard/server-wizard";
export default function NewServerPage(){return <><PageHeader title="Create server" description="Provision a new Minecraft server with a guided configuration flow."/><ServerWizard/></>}
