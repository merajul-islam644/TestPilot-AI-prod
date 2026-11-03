#!/usr/bin/env node
// Generates a self-signed HTTPS cert for local Blocks SSO testing.
// Uses a Node dependency so this works from normal PowerShell after npm install.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import selfsigned from "selfsigned";

const domain = readDevHost() || process.argv[2];

if (!domain) {
  console.error("No domain given. Set VITE_BLOCKS_DEV_HOST in .env, or run: npm run cert -- <domain>");
  console.error("Use the project's real domain (Project/Gets -> applications[].domain) -- never a guessed one.");
  process.exit(1);
}

mkdirSync(".cert", { recursive: true });

const pems = selfsigned.generate([{ name: "commonName", value: domain }], {
  algorithm: "sha256",
  days: 365,
  extensions: [
    {
      altNames: [
        { type: 2, value: domain },
        { type: 2, value: "localhost" },
        { ip: "127.0.0.1", type: 7 }
      ],
      name: "subjectAltName"
    }
  ],
  keySize: 2048
});

writeFileSync(".cert/dev-key.pem", pems.private);
writeFileSync(".cert/dev-cert.pem", pems.cert);

console.log("");
console.log(`Wrote .cert/dev-cert.pem and .cert/dev-key.pem for "${domain}" (SAN: ${domain}, localhost, 127.0.0.1).`);
console.log("");
console.log("Trust it to remove the browser warning, then restart the browser:");
console.log("  macOS:   sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain .cert/dev-cert.pem");
console.log("  Windows: certutil -addstore -f Root .cert\\dev-cert.pem   (run from an elevated prompt)");
console.log("  Linux:   sudo cp .cert/dev-cert.pem /usr/local/share/ca-certificates/blocks-dev.crt && sudo update-ca-certificates");
console.log("");
console.log(`Make sure "127.0.0.1  ${domain}" is in your hosts file, then run: npm run dev`);

function readDevHost() {
  if (process.env.VITE_BLOCKS_DEV_HOST) return process.env.VITE_BLOCKS_DEV_HOST;
  if (!existsSync(".env")) return undefined;

  const match = readFileSync(".env", "utf8").match(/^VITE_BLOCKS_DEV_HOST=(.*)$/m);
  return match ? match[1].trim() : undefined;
}
