import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const rootDist = "dist";
const girlfriendDist = join(rootDist, "girlfriend");

await rm(girlfriendDist, { recursive: true, force: true });
await mkdir(girlfriendDist, { recursive: true });

const entries = ["assets", "icons", "data", "index.html", "manifest.webmanifest", "sw.js"];
for (const entry of entries) {
  await cp(join(rootDist, entry), join(girlfriendDist, entry), { recursive: true });
}

await mkdir(join(girlfriendDist, "data"), { recursive: true });
await cp("public/girlfriend/data/question-bank.json", join(girlfriendDist, "data", "question-bank.json"));

const manifestPath = join(girlfriendDist, "manifest.webmanifest");
const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
manifest.name = "专属刷题本";
manifest.short_name = "刷题本";
manifest.start_url = "./";
manifest.scope = "./";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
