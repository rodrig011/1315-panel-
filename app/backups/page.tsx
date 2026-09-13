import { BackupList } from "@/components/backups/backup-list"; import { PageHeader } from "@/components/shared/page";
export default function BackupsPage(){return <><PageHeader title="Backups" description="Create restore points, schedule snapshots, and manage retention."/><BackupList/></>}
