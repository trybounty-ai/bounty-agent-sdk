import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
import { createRequire as __eveCreateRequire } from "node:module";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
__eveCreateRequire(import.meta.url);
import { z } from "zod";
import { defineExtension } from "eve/extension";
var extension_default = defineExtension({ config: z.object({
	apiKey: z.string().min(1),
	webhookSecret: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
	baseURL: z.string().url().default("https://api.trybounty.ai")
}) });
export { extension_default as default };
