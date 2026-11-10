import { clearStoredBody, readStoredBody, storedMd5, writeStoredBody } from '@/lib/lookup-store';

// Índice guardado no aparelho: grava num .tmp, troca e apaga os antigos; arquivo pela metade nunca é lido.

type Disk = Map<string, string>;

jest.mock('expo-file-system', () => {
  const disk: Disk = new Map();
  const base = 'file:///docs/';
  const tail = (uri: string) => uri.split('/').filter(Boolean).pop()!;

  class Directory {
    uri: string;
    constructor(parent: { uri: string } | string, name: string) {
      this.uri = `${typeof parent === 'string' ? parent : parent.uri}${name}/`;
    }
    get exists() {
      return disk.has(this.uri);
    }
    create() {
      disk.set(this.uri, '');
    }
    delete() {
      for (const key of [...disk.keys()]) if (key.startsWith(this.uri)) disk.delete(key);
    }
    list() {
      // Escrito de outro jeito de propósito: no aparelho, a listagem pode trazer "file:/" em vez de "file:///".
      return [...disk.keys()].filter((k) => k.startsWith(this.uri) && k !== this.uri).map((k) => new File(k.replace('file:///', 'file:/')));
    }
  }

  class File {
    uri: string;
    constructor(parent: { uri: string } | string, name?: string) {
      this.uri = name ? `${typeof parent === 'string' ? parent : parent.uri}${name}` : (parent as string);
    }
    get name() {
      return tail(this.uri);
    }
    get real() {
      return this.uri.replace(/^file:\/+/, 'file:///');
    }
    get exists() {
      return disk.has(this.real);
    }
    async text() {
      return disk.get(this.real)!;
    }
    async write(content: string) {
      disk.set(this.real, content);
    }
    delete() {
      disk.delete(this.real);
    }
    async move(to: File) {
      disk.set(to.real, disk.get(this.real)!);
      disk.delete(this.real);
      this.uri = to.uri;
    }
  }

  return { __disk: disk, Directory, File, Paths: { document: { uri: base } } };
});

const disk = jest.requireMock<{ __disk: Disk }>('expo-file-system').__disk;

const names = () => [...disk.keys()].map((k) => k.replace('file:///docs/lookup/', '')).filter(Boolean).sort();

beforeEach(() => disk.clear());

describe('lookup-store', () => {
  it('sem arquivo, nada', async () => {
    expect(await readStoredBody()).toBeNull();
    expect(await storedMd5()).toBeNull();
  });

  it('o nome do arquivo já é a versão', async () => {
    await writeStoredBody('abc', 'corpo');
    expect(names()).toEqual(['abc.txt']);
    expect(await storedMd5()).toBe('abc');
    expect(await readStoredBody()).toEqual({ md5: 'abc', body: 'corpo' });
  });

  it('versão nova apaga a antiga e mantém o arquivo novo', async () => {
    await writeStoredBody('velho', 'um');
    await writeStoredBody('novo', 'dois');
    expect(names()).toEqual(['novo.txt']);
    expect(await readStoredBody()).toEqual({ md5: 'novo', body: 'dois' });
  });

  it('gravar a mesma versão de novo troca o conteúdo', async () => {
    await writeStoredBody('abc', 'um');
    await writeStoredBody('abc', 'dois');
    expect(names()).toEqual(['abc.txt']);
    expect((await readStoredBody())?.body).toBe('dois');
  });

  it('arquivo pela metade (.tmp que ficou) nunca é lido e sai na próxima gravação', async () => {
    disk.set('file:///docs/lookup/', '');
    disk.set('file:///docs/lookup/antigo.tmp', 'pela met');
    expect(await readStoredBody()).toBeNull();
    await writeStoredBody('abc', 'corpo');
    expect(names()).toEqual(['abc.txt']);
  });

  it('limpar apaga tudo e pode ser chamado sem nada guardado', async () => {
    await clearStoredBody();
    await writeStoredBody('abc', 'corpo');
    await clearStoredBody();
    expect(await readStoredBody()).toBeNull();
    expect(names()).toEqual([]);
  });
});
