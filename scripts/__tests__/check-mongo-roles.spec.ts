import { describe, expect, it } from 'vitest';
import { dangerousActionsHeld, databaseFromUri, isMainModule, outcomeOf } from '../check-mongo-roles.js';

describe('check-mongo-roles helpers (REV-198)', () => {
  it('databaseFromUri reads the database from the URI path, so Atlas revamp_prod is checked too', () => {
    expect(databaseFromUri('mongodb+srv://u:p@cluster.example.net/revamp_prod?retryWrites=true')).toBe('revamp_prod');
    expect(databaseFromUri('mongodb://u:p@localhost:27017/revamp?authSource=admin')).toBe('revamp');
    expect(databaseFromUri('mongodb://localhost:27017')).toBe('revamp');
  });

  it('outcomeOf counts only Unauthorized as denied; any other error is an error, never a pass', () => {
    expect(outcomeOf({ code: 13, message: 'not authorized' })).toEqual({ outcome: 'denied' });
    expect(outcomeOf({ code: 10107, message: 'not primary' })).toEqual({ outcome: 'error', note: 'not primary' });
    expect(outcomeOf(new Error('timeout'))).toEqual({ outcome: 'error', note: 'timeout' });
  });

  it('dangerousActionsHeld sees rights on the database, on every database and on any resource', () => {
    const on = (resource: object, actions: string[]) => ({ resource, actions });
    expect(dangerousActionsHeld([on({ db: 'revamp', collection: '' }, ['find', 'insert'])], 'revamp')).toEqual([]);
    expect(dangerousActionsHeld([on({ db: 'revamp', collection: '' }, ['dropDatabase'])], 'revamp')).toEqual(['dropDatabase']);
    expect(dangerousActionsHeld([on({ db: '', collection: '' }, ['createUser'])], 'revamp')).toEqual(['createUser']);
    expect(dangerousActionsHeld([on({ anyResource: true }, ['grantRole', 'dropDatabase'])], 'revamp')).toEqual([
      'dropDatabase',
      'grantRole',
    ]);
    expect(dangerousActionsHeld([on({ db: 'other', collection: '' }, ['dropDatabase'])], 'revamp')).toEqual([]);
  });

  it('isMainModule matches a script path with spaces and non-ASCII characters', () => {
    const file = '/Users/me/My Projects/Ревамп/scripts/check-mongo-roles.ts';
    expect(isMainModule(file, new URL(`file://${file}`).href)).toBe(true);
    expect(isMainModule('/elsewhere/other.ts', new URL(`file://${file}`).href)).toBe(false);
    expect(isMainModule(undefined, new URL(`file://${file}`).href)).toBe(false);
  });
});
