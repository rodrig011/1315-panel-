ALTER TABLE "MinecraftServer" ADD COLUMN "javaVersion" INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "MinecraftServer" ADD COLUMN "restartPolicy" TEXT NOT NULL DEFAULT 'unless-stopped';
