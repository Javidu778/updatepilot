import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeWingetOutput } from './decode';
import {
  mergeScannedApplications,
  parseWingetList,
  parseWingetTable,
  parseWingetUpgrade,
} from './parse';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

const LIST = fixture('winget-list.txt');
const UPGRADE = fixture('winget-upgrade.txt');

describe('decodeWingetOutput', () => {
  it('reads plain UTF-8', () => {
    expect(decodeWingetOutput(Buffer.from('Name  Id\n', 'utf8'))).toBe('Name  Id\n');
  });

  it('reads UTF-16LE with a BOM, which is what a pipe sometimes produces', () => {
    const withBom = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Name  Id\n', 'utf16le'),
    ]);
    expect(decodeWingetOutput(withBom)).toBe('Name  Id\n');
  });

  it('strips a UTF-8 BOM and ANSI colour codes', () => {
    const text = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('\u001B[32mName\u001B[0m  Id\n', 'utf8'),
    ]);
    expect(decodeWingetOutput(text)).toBe('Name  Id\n');
  });

  it('normalises CRLF', () => {
    expect(decodeWingetOutput('a\r\nb\r\n')).toBe('a\nb\n');
  });
});

describe('parseWingetList', () => {
  it('reads every installed application from recorded output', () => {
    const rows = parseWingetList(LIST);
    expect(rows).toHaveLength(284);
    expect(rows.find((row) => row.packageId === 'Google.AntigravityIDE')).toEqual({
      displayName: 'Antigravity (User)',
      packageId: 'Google.AntigravityIDE',
      version: '1.16.5',
      availableVersion: '2.7.0',
      source: 'winget',
    });
  });

  it('keeps the full name when it contains spaces and brackets', () => {
    const vsCode = parseWingetList(LIST).find(
      (row) => row.packageId === 'Microsoft.VisualStudioCode',
    );
    expect(vsCode?.displayName).toBe('Microsoft Visual Studio Code (User)');
  });

  it('reads the available version when the list includes an upgrade', () => {
    const notepad = parseWingetList(LIST).find((row) => row.packageId === 'Notepad++.Notepad++');
    expect(notepad?.version).toBe('8.9.7');
    expect(notepad?.availableVersion).toBe('8.9.9.1');
  });

  it('keeps an msstore row with its source', () => {
    const capCut = parseWingetList(LIST).find((row) => row.displayName === 'CapCut');
    expect(capCut?.packageId).toBeNull();
    expect(capCut?.source).toBe('msstore');
    expect(capCut?.availableVersion).toBe('9.8.0.4213');
  });

  it('treats a non-identity id as unmatched instead of inventing one', () => {
    const tomcat = parseWingetList(LIST).find((row) =>
      row.displayName.startsWith('Apache Tomcat 9.0 Tomcat9'),
    );
    expect(tomcat?.packageId).toBeNull();
    expect(tomcat?.version).toBe('9.0.104');
  });

  it('ignores the header, the separator and the summary line', () => {
    const rows = parseWingetList(LIST);
    expect(rows.some((row) => row.displayName.startsWith('Name'))).toBe(false);
    expect(rows.some((row) => row.displayName.startsWith('-'))).toBe(false);
    expect(rows.some((row) => /upgrades available/i.test(row.displayName))).toBe(false);
  });
});

describe('parseWingetUpgrade', () => {
  it('reads the rows and skips the trailing count', () => {
    const rows = parseWingetUpgrade(UPGRADE);
    expect(rows).toHaveLength(42);
    const git = rows.find((row) => row.packageId === 'Git.Git');
    expect(git?.availableVersion).toBe('2.56.0.4');
  });
});

describe('parseWingetTable edge cases', () => {
  it('survives an empty document', () => {
    expect(parseWingetTable('')).toEqual([]);
  });

  it('still reads a row whose name was truncated by a narrow console', () => {
    const rows = parseWingetTable(
      'Microsoft Visual Stu…   Microsoft.VisualStudioCode   1.85.1   1.86.0   winget\n',
    );
    expect(rows[0].displayName).toBe('Microsoft Visual Stu…');
    expect(rows[0].availableVersion).toBe('1.86.0');
  });

  it('reports an unknown version as text, not as a number', () => {
    const rows = parseWingetTable('Odd App   Vendor.OddApp   Unknown               winget\n');
    expect(rows[0].version).toBe('Unknown');
  });
});

describe('mergeScannedApplications', () => {
  it('builds the objects the API accepts, with publisher and architecture unknown', () => {
    const applications = mergeScannedApplications(
      parseWingetList(LIST),
      parseWingetUpgrade(UPGRADE),
    );

    expect(applications).toHaveLength(222);
    const git = applications.find((application) => application.packageId === 'Git.Git');
    expect(git).toEqual({
      displayName: 'Git',
      publisher: null,
      installedVersion: '2.53.0',
      availableVersion: '2.56.0.4',
      packageId: 'Git.Git',
      source: 'winget',
      architecture: null,
    });
  });

  it('prefers the upgrade table over the list column', () => {
    const installed = [
      {
        displayName: 'Git',
        packageId: 'Git.Git',
        version: '2.44.0',
        availableVersion: '2.44.9',
        source: 'winget',
      },
    ];
    const upgrades = [
      {
        displayName: 'Git',
        packageId: 'Git.Git',
        version: '2.44.0',
        availableVersion: '2.45.1',
        source: 'winget',
      },
    ];
    expect(mergeScannedApplications(installed, upgrades)[0].availableVersion).toBe('2.45.1');
  });

  it('matches ids case-insensitively', () => {
    const installed = [
      {
        displayName: 'Git',
        packageId: 'Git.Git',
        version: '2.44.0',
        availableVersion: null,
        source: 'winget',
      },
    ];
    const upgrades = [
      {
        displayName: 'Git',
        packageId: 'git.git',
        version: '2.44.0',
        availableVersion: '2.45.1',
        source: 'winget',
      },
    ];
    expect(mergeScannedApplications(installed, upgrades)[0].availableVersion).toBe('2.45.1');
  });

  it('drops a package that appears twice in different scopes', () => {
    const row = {
      displayName: 'Git',
      packageId: 'Git.Git',
      version: '2.44.0',
      availableVersion: null,
      source: 'winget',
    };
    expect(mergeScannedApplications([row, row], [])).toHaveLength(1);
  });

  it('keeps an application that has no package id', () => {
    const applications = mergeScannedApplications(
      [
        {
          displayName: 'Contoso Tool',
          packageId: null,
          version: '2.1',
          availableVersion: null,
          source: null,
        },
      ],
      [],
    );
    expect(applications).toHaveLength(1);
    expect(applications[0].packageId).toBeNull();
    expect(applications[0].source).toBeNull();
  });
});
