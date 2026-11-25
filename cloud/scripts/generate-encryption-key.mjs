import { randomBytes } from "node:crypto";

// This script intentionally prints the generated key once to stdout so an operator can store it
// directly in a GitHub Actions secret or host secret manager. It never writes a file.
process.stderr.write(
  "Store this value only in a secret manager (GitHub Actions secret or deploy/.env on the host). " +
  "Never commit it, paste it into chat, or add it to a public repository.\n",
);
process.stdout.write(`${randomBytes(32).toString("base64")}\n`);
