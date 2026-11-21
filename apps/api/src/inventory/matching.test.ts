import { describe, expect, it } from 'vitest';
import { appKeyFor, deriveStatuses } from './matching';

const base = { packageId: null, publisher: null, architecture: null };

describe('appKeyFor', () => {
  it('keys a matched package by its id, ignoring case', () => {
    expect(appKeyFor({ ...base, packageId: 'Git.Git', displayName: 'Git' })).toBe('pkg:git.git');
  });

  it('never uses the display name when a package id exists', () => {
    const one = appKeyFor({ ...base, packageId: 'Git.Git', displayName: 'Git 2.44' });
    const two = appKeyFor({ ...base, packageId: 'Git.Git', displayName: 'Git' });
    expect(one).toBe(two);
  });

  it('keys an unmatched application by name, publisher and architecture', () => {
    expect(
      appKeyFor({
        packageId: null,
        displayName: 'Contoso Internal Tool',
        publisher: 'Contoso Ltd.',
        architecture: 'x64',
      }),
    ).toBe('app:contoso-internal-tool|contoso-ltd|x64');
  });

  it('survives a missing publisher and architecture without collapsing to the same key', () => {
    const withoutPublisher = appKeyFor({
      ...base,
      displayName: 'Tool',
      publisher: null,
      architecture: 'x64',
    });
    const withoutArchitecture = appKeyFor({
      ...base,
      displayName: 'Tool',
      publisher: null,
      architecture: 'x86',
    });
    expect(withoutPublisher).not.toBe(withoutArchitecture);
  });

  it('is stable across punctuation and casing differences', () => {
    const a = appKeyFor({
      ...base,
      displayName: 'Vi-Sual  Studio!',
      publisher: null,
      architecture: null,
    });
    const b = appKeyFor({
      ...base,
      displayName: 'vi sual studio',
      publisher: null,
      architecture: null,
    });
    expect(a).toBe(b);
  });
});

describe('deriveStatuses', () => {
  const matched = { packageId: 'Git.Git', source: 'winget', installedVersion: '2.44.0' };

  it('marks a newer version as an available update', () => {
    expect(deriveStatuses({ ...matched, availableVersion: '2.45.1' })).toEqual({
      matchStatus: 'MATCHED',
      updateStatus: 'UPDATE_AVAILABLE',
    });
  });

  it('marks the same version as up to date', () => {
    expect(deriveStatuses({ ...matched, availableVersion: '2.44.0' }).updateStatus).toBe(
      'UP_TO_DATE',
    );
  });

  it('treats no known version as up to date for a matched package', () => {
    expect(deriveStatuses({ ...matched, availableVersion: null }).updateStatus).toBe('UP_TO_DATE');
  });

  it('never offers a downgrade as an update', () => {
    // WinGet occasionally lists a lower "available" version than the installed one.
    expect(
      deriveStatuses({ ...matched, installedVersion: '2.45.1', availableVersion: '2.44.0' })
        .updateStatus,
    ).toBe('UP_TO_DATE');
  });

  it('compares versions properly instead of testing for inequality', () => {
    // Same version written differently is not an update.
    expect(
      deriveStatuses({ ...matched, installedVersion: '2.44', availableVersion: '2.44.0' })
        .updateStatus,
    ).toBe('UP_TO_DATE');
    // A numeric comparison, not a text one.
    expect(
      deriveStatuses({ ...matched, installedVersion: '2.9.0', availableVersion: '2.10.0' })
        .updateStatus,
    ).toBe('UPDATE_AVAILABLE');
  });

  it('says Unknown rather than guessing when a version cannot be read', () => {
    expect(
      deriveStatuses({ ...matched, installedVersion: 'Unknown', availableVersion: '2.8.0' })
        .updateStatus,
    ).toBe('UNKNOWN');
  });

  it('still finds an update when WinGet only reports a bound', () => {
    // Real case: the Python Launcher reports "< 3.14.7", which is enough to prove 3.15.2 is newer.
    expect(
      deriveStatuses({ ...matched, installedVersion: '< 3.14.7', availableVersion: '3.15.2' })
        .updateStatus,
    ).toBe('UPDATE_AVAILABLE');
  });

  it('never claims a status for an application without a package id', () => {
    expect(
      deriveStatuses({
        packageId: null,
        source: null,
        installedVersion: '1.0',
        availableVersion: '2.0',
      }),
    ).toEqual({ matchStatus: 'UNMATCHED', updateStatus: 'UNKNOWN' });
  });

  it('calls a matched row from another source unsupported', () => {
    expect(
      deriveStatuses({
        packageId: '9WZDNCRFHVN5',
        source: 'msstore',
        installedVersion: '1.0',
        availableVersion: null,
      }),
    ).toEqual({ matchStatus: 'UNSUPPORTED', updateStatus: 'UNKNOWN' });
  });
});
