import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageDirectories = ["packages/agent-sdk", "packages/flue"];
const args = process.argv.slice(2);
const tagIndex = args.indexOf("--tag");
const outputIndex = args.indexOf("--out");
const tag = tagIndex === -1 ? undefined : args.at(tagIndex + 1);
const outputArgument =
  outputIndex === -1 ? undefined : args.at(outputIndex + 1);

if (tag !== "beta" && tag !== "latest") {
  throw new Error("Pass --tag beta or --tag latest.");
}

if (!outputArgument) {
  throw new Error("Pass --out with a release artifact directory.");
}

const outputDirectory = resolve(root, outputArgument);

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });

const runOrThrow = (command, commandArgs, options) => {
  const result = run(command, commandArgs, options);
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed.`);
  }
  return result;
};

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const packages = [];

for (const packageDirectory of packageDirectories) {
  const manifest = JSON.parse(
    await readFile(join(root, packageDirectory, "package.json"), "utf8"),
  );
  const packageVersion = `${manifest.name}@${manifest.version}`;
  const lookup = run("npm", ["view", packageVersion, "version", "--json"], {
    stdio: "pipe",
  });

  if (lookup.status === 0) {
    console.log(`Skipping ${packageVersion}; it is already published.`);
    packages.push({
      name: manifest.name,
      version: manifest.version,
      directory: packageDirectory,
      tag,
      publish: false,
    });
    continue;
  }

  const lookupOutput = `${lookup.stdout ?? ""}\n${lookup.stderr ?? ""}`;
  if (!lookupOutput.includes("E404")) {
    process.stderr.write(lookupOutput);
    throw new Error(`Could not check ${packageVersion} on npm.`);
  }

  const tarball = `${manifest.name
    .replace(/^@/, "")
    .replaceAll("/", "-")}-${manifest.version}.tgz`;
  const tarballPath = join(outputDirectory, tarball);

  runOrThrow("pnpm", ["--filter", manifest.name, "pack", "--out", tarballPath]);

  const sha256 = createHash("sha256")
    .update(await readFile(tarballPath))
    .digest("hex");

  packages.push({
    name: manifest.name,
    version: manifest.version,
    directory: packageDirectory,
    tag,
    publish: true,
    tarball,
    sha256,
  });
}

await writeFile(
  join(outputDirectory, "release-manifest.json"),
  `${JSON.stringify({ packages }, undefined, 2)}\n`,
);
await writeFile(
  join(outputDirectory, "SHA256SUMS"),
  packages
    .filter(({ publish }) => publish)
    .map(({ sha256, tarball }) => `${sha256}  ${tarball}`)
    .join("\n") + (packages.some(({ publish }) => publish) ? "\n" : ""),
);

console.log(
  `Prepared ${packages.filter(({ publish }) => publish).length} package artifact(s).`,
);
