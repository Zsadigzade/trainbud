import path from "node:path";
import { readJsonFile } from "./utils/jsonFile.js";
import { fileURLToPath } from "node:url";

const packageJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json"
);

const pkg = readJsonFile<{ version: string }>(packageJsonPath);

export const packageVersion = pkg.version;
