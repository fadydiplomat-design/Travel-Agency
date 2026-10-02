import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const f = path.join(ROOT, spec.slice(2));
    return next(pathToFileURL(f.endsWith(".js") ? f : f + ".js").href, ctx);
  }
  return next(spec, ctx);
}
