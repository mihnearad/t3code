/** Hidden file an upload streams into beside its target, until the commit links or renames it. */
const UPLOAD_PART_FILE =
  /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.t3-upload$/;

export const uploadPartFileName = (targetName: string, partId: string) =>
  `.${targetName}.${partId}.t3-upload`;

export const isUploadPartFileName = (name: string) => UPLOAD_PART_FILE.test(name);

/** Tests the last segment of a relative path, posix or native. */
export const isUploadPartFilePath = (entryPath: string) =>
  isUploadPartFileName(
    entryPath.slice(Math.max(entryPath.lastIndexOf("/"), entryPath.lastIndexOf("\\")) + 1),
  );
