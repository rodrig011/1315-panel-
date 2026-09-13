import { Marketplace } from "@/components/marketplace/marketplace"; import { PageHeader } from "@/components/shared/page"; import { pluginItems } from "@/lib/mock/data";
export default function PluginsPage(){return <><PageHeader title="Plugins" description="Manage Paper and Spigot plugins for compatible servers."/><Marketplace kind="plugins" seed={pluginItems}/></>}
