/**
 * Integra o MultiTerm ao ambiente de desktop do Linux:
 *   - atalho no menu de aplicativos (~/.local/share/applications)
 *   - icone no tema hicolor (~/.local/share/icons)
 *   - comando `multiterm` no PATH (~/.local/bin)
 *
 * Tudo por usuario: nao precisa de sudo e nao toca em /usr.
 *
 *   node scripts/install-desktop.mjs            instala
 *   node scripts/install-desktop.mjs --uninstall  remove
 */
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildIcon } from './make-icon.mjs';

const run = promisify(execFile);

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = homedir();
const ICON_SIZES = [64, 128, 256, 512];

const DESKTOP_FILE = join(HOME, '.local/share/applications/multiterm.desktop');
const BIN_LINK = join(HOME, '.local/bin/multiterm');
const iconPath = (size) =>
  join(HOME, `.local/share/icons/hicolor/${size}x${size}/apps/multiterm.png`);

function install() {
  for (const size of ICON_SIZES) {
    const target = iconPath(size);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buildIcon(size));
  }

  mkdirSync(dirname(DESKTOP_FILE), { recursive: true });
  writeFileSync(
    DESKTOP_FILE,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=MultiTerm',
      'GenericName=Painel de terminais',
      'Comment=Executa e acompanha varios terminais e agentes em uma janela so',
      `Exec=${join(APP_DIR, 'bin/multiterm')}`,
      'Icon=multiterm',
      'Terminal=false',
      'StartupNotify=true',
      'StartupWMClass=MultiTerm',
      // Uma unica categoria principal: com duas, o app aparece duplicado no menu.
      'Categories=Development;TerminalEmulator;',
      'Keywords=terminal;shell;claude;codex;agente;',
      '',
    ].join('\n'),
  );
  chmodSync(DESKTOP_FILE, 0o755);

  mkdirSync(dirname(BIN_LINK), { recursive: true });
  rmSync(BIN_LINK, { force: true });
  symlinkSync(join(APP_DIR, 'bin/multiterm'), BIN_LINK);

  return [
    `atalho  ${DESKTOP_FILE}`,
    `comando ${BIN_LINK}`,
    `icones  ${ICON_SIZES.map((s) => `${s}px`).join(', ')}`,
  ];
}

function uninstall() {
  rmSync(DESKTOP_FILE, { force: true });
  rmSync(BIN_LINK, { force: true });
  for (const size of ICON_SIZES) rmSync(iconPath(size), { force: true });
  return ['atalho, comando e icones removidos'];
}

/** Sem isso o menu so mostra o app apos logout/login em alguns ambientes. */
async function refreshCaches() {
  const tasks = [
    ['update-desktop-database', [join(HOME, '.local/share/applications')]],
    ['gtk-update-icon-cache', ['-f', '-t', join(HOME, '.local/share/icons/hicolor')]],
  ];
  for (const [command, args] of tasks) {
    try {
      await run(command, args);
    } catch {
      // ferramenta ausente ou nao aplicavel neste ambiente — inofensivo
    }
  }
}

const removing = process.argv.includes('--uninstall');
const lines = removing ? uninstall() : install();
await refreshCaches();

console.log(removing ? 'MultiTerm removido do menu.' : 'MultiTerm instalado no menu.');
for (const line of lines) console.log(`  ${line}`);
if (!removing && !(process.env.PATH ?? '').split(':').includes(dirname(BIN_LINK))) {
  console.log(`\nAviso: ${dirname(BIN_LINK)} nao esta no PATH.`);
  console.log('Para usar o comando `multiterm` no terminal, adicione ao ~/.bashrc:');
  console.log('  export PATH="$HOME/.local/bin:$PATH"');
}
