/** 分片大小计算：S3 要求每片 >= 5 MiB 且总片数 <= 10000。 */

export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const MAX_PARTS = 10_000;

/**
 * 返回每一片的字节数（最后一片可以小于其余片）。
 * 只接受非负整数 size。
 */
export function planParts(size: number, requestedPartSize: number): number[] {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`invalid size: ${size}`);
  }
  if (size === 0) return [];
  let partSize = Math.max(Math.floor(requestedPartSize), MIN_PART_SIZE);
  if (!Number.isFinite(partSize) || partSize <= 0) partSize = MIN_PART_SIZE;
  if (Math.ceil(size / partSize) > MAX_PARTS) {
    partSize = Math.ceil(size / MAX_PARTS);
  }
  const parts: number[] = [];
  for (let offset = 0; offset < size; offset += partSize) {
    parts.push(Math.min(partSize, size - offset));
  }
  return parts;
}

export function offsetsForParts(parts: number[]): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const size of parts) {
    result.push({ start: offset, end: offset + size - 1 });
    offset += size;
  }
  return result;
}