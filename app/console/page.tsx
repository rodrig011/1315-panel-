import { ConsolePanel } from "@/components/console/console-panel"; import { PageHeader } from "@/components/shared/page";
export default function ConsolePage(){return <><PageHeader title="Console" description="Stream server output and execute commands in real time."/><ConsolePanel/></>}
