import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  filename: string;
  content: Uint8Array;
}

const MAX_APK_BYTES = 100 * 1024 * 1024;

/** Reads one file from a GitHub Actions artifact ZIP without extracting to disk. */
export function findZipFileByExtension(bytes: Uint8Array, extension: string): ZipEntry | null {
  const buffer = Buffer.from(bytes);
  const end = findEndOfCentralDirectory(buffer);
  if (!end) return null;
  const totalEntries = buffer.readUInt16LE(end + 10);
  let position = buffer.readUInt32LE(end + 16);
  const wanted = extension.toLowerCase();

  for (let index = 0; index < totalEntries; index += 1) {
    if (position + 46 > buffer.length || buffer.readUInt32LE(position) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(position + 10);
    const compressedSize = buffer.readUInt32LE(position + 20);
    const uncompressedSize = buffer.readUInt32LE(position + 24);
    const nameLength = buffer.readUInt16LE(position + 28);
    const extraLength = buffer.readUInt16LE(position + 30);
    const commentLength = buffer.readUInt16LE(position + 32);
    const localOffset = buffer.readUInt32LE(position + 42);
    const filename = buffer.subarray(position + 46, position + 46 + nameLength).toString("utf8");

    if (!filename.endsWith("/") && filename.toLowerCase().endsWith(wanted)) {
      if (uncompressedSize > MAX_APK_BYTES || localOffset + 30 > buffer.length) return null;
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      let content: Buffer;
      try {
        content = method === 0
          ? compressed
          : method === 8
            ? inflateRawSync(compressed)
            : Buffer.alloc(0);
      } catch {
        return null;
      }
      if (!content.length || content.length > MAX_APK_BYTES) return null;
      return { filename, content: new Uint8Array(content) };
    }

    position += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function findEndOfCentralDirectory(buffer: Buffer): number | null {
  if (buffer.length < 22) return null;
  for (let position = buffer.length - 22; position >= 0; position -= 1) {
    if (buffer.readUInt32LE(position) === 0x06054b50) return position;
  }
  return null;
}
