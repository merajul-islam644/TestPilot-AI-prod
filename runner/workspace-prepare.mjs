// Prepares a materialized workspace for native-ESM execution. Node resolves
// relative imports strictly: no extension guessing, and .ts cannot ride the
// Playwright loader pipeline (its hook returns null for files outside its
// compile set). So:
//   1. every TS helper gets a sibling compiled .mjs (specs are left native --
//      Playwright transpiles spec files itself);
//   2. every relative import specifier in .mjs/.js/.cjs files -- original or
//      compiled -- is rewritten to the exact file it resolves to, with
//      forward slashes and a leading "./" so Windows paths stay valid URLs.
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const TS_HELPER = /\.(ts|tsx)$/;
const SCRIPT = /\.(mjs|js|cjs)$/;
const SPEC_SHAPED = /\.(spec|test)\.(mjs|js|cjs|ts|tsx|jsx)$/;
// from "x" | import "x" | import("x") -- only relative specifiers are touched.
const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"'\n]+)\2/g;

export async function prepareWorkspace(dir, names) {
  const compiledSiblings = new Set();
  for (const name of names) {
    if (TS_HELPER.test(name) && !SPEC_SHAPED.test(name)) {
      compiledSiblings.add(await compileToMjs(path.join(dir, ...name.split("/"))));
    }
  }
  const targets = [...compiledSiblings, ...names.filter((name) => SCRIPT.test(name)).map((name) => path.join(dir, ...name.split("/")))];
  for (const target of targets) {
    const source = await readFile(target, "utf8");
    const rewritten = source.replace(IMPORT_RE, (match, head, quote, specifier) => {
      const resolved = resolveImport(path.dirname(target), specifier);
      return resolved ? `${head}${quote}${resolved}${quote}` : match;
    });
    if (rewritten !== source) await writeFile(target, rewritten, "utf8");
  }
}

async function compileToMjs(file) {
  const source = await readFile(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sibling = `${file.slice(0, -path.extname(file).length)}.mjs`;
  await writeFile(sibling, output, "utf8");
  return sibling;
}

/** Resolve a relative specifier to the file the import should actually load. */
function resolveImport(fromDir, specifier) {
  const base = path.resolve(fromDir, specifier);
  const candidates = [
    base,
    `${base}.mjs`,
    `${base}.js`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.js"),
    path.join(base, "index.mjs")
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const target = TS_HELPER.test(candidate) && !SPEC_SHAPED.test(candidate)
      ? `${candidate.slice(0, -path.extname(candidate).length)}.mjs`
      : candidate;
    const relative = path.relative(fromDir, target).split(path.sep).join("/");
    return relative.startsWith(".") ? relative : `./${relative}`;
  }
  return undefined;
}
