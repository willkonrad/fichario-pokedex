import { Directory, File, Paths } from 'expo-file-system';

// Índice da Consulta no aparelho: um arquivo "<md5>.txt", cujo nome já é a versão.

const folder = () => new Directory(Paths.document, 'lookup');

function currentFile(): File | null {
  const dir = folder();
  if (!dir.exists) return null;
  for (const item of dir.list()) if (item instanceof File && item.name.endsWith('.txt')) return item;
  return null;
}

const md5Of = (file: File) => file.name.replace(/\.txt$/, '');

/** Versão guardada, sem ler o arquivo. */
export async function storedMd5(): Promise<string | null> {
  const file = currentFile();
  return file ? md5Of(file) : null;
}

export async function readStoredBody(): Promise<{ md5: string; body: string } | null> {
  const file = currentFile();
  return file ? { md5: md5Of(file), body: await file.text() } : null;
}

/** Grava num .tmp e só depois troca: arquivo pela metade nunca é lido. */
export async function writeStoredBody(md5: string, body: string): Promise<void> {
  const dir = folder();
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `${md5}.tmp`);
  await tmp.write(body);
  const target = new File(dir, `${md5}.txt`);
  if (target.exists) target.delete();
  await tmp.move(target);
  // Pelo nome: o uri da listagem pode vir escrito de outro jeito e apagaria o arquivo novo.
  for (const item of dir.list()) if (item instanceof File && item.name !== target.name) item.delete();
}

export async function clearStoredBody(): Promise<void> {
  const dir = folder();
  if (dir.exists) dir.delete();
}
