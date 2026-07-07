import { inflateRawSync } from 'node:zlib';

export type ZipEntries = Map<string, Buffer>;

const LOCAL_FILE_HEADER = 0x04034b50;

function normalizeZipPath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function readZipEntries(buffer: Buffer): ZipEntries {
  const entries: ZipEntries = new Map();
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);

    if (signature !== LOCAL_FILE_HEADER) {
      break;
    }

    const flags = buffer.readUInt16LE(offset + 6);
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if ((flags & 0x08) !== 0) {
      throw new Error('Zip entries with data descriptors are not supported');
    }

    if (dataEnd > buffer.length) {
      throw new Error('Zip entry is truncated');
    }

    const name = normalizeZipPath(buffer.subarray(nameStart, nameStart + fileNameLength).toString('utf8'));
    const compressed = buffer.subarray(dataStart, dataEnd);

    if (!name.endsWith('/')) {
      if (compression === 0) {
        entries.set(name, Buffer.from(compressed));
      } else if (compression === 8) {
        const inflated = inflateRawSync(compressed);

        if (inflated.length !== uncompressedSize) {
          throw new Error(`Zip entry ${name} has an invalid uncompressed size`);
        }

        entries.set(name, inflated);
      } else {
        throw new Error(`Zip entry ${name} uses unsupported compression method ${compression}`);
      }
    }

    offset = dataEnd;
  }

  if (entries.size === 0) {
    throw new Error('Zip archive does not contain files');
  }

  return entries;
}
