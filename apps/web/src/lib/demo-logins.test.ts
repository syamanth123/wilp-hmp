import { afterEach, describe, expect, it } from 'vitest';
import { demoLoginsVisible } from './demo-logins';

const saved = process.env.SHOW_DEMO_LOGINS;

function setEnv(value: string | undefined) {
  if (value === undefined) delete process.env.SHOW_DEMO_LOGINS;
  else process.env.SHOW_DEMO_LOGINS = value;
}

afterEach(() => setEnv(saved));

describe('demoLoginsVisible (SHOW_DEMO_LOGINS)', () => {
  it('is off when the setting is missing', () => {
    setEnv(undefined);
    expect(demoLoginsVisible()).toBe(false);
  });

  it('is off for anything other than "true"', () => {
    for (const v of ['', 'false', '0', '1', 'yes', 'on']) {
      setEnv(v);
      expect(demoLoginsVisible()).toBe(false);
    }
  });

  it('is on for "true" in any case, ignoring spaces', () => {
    for (const v of ['true', 'TRUE', ' True ']) {
      setEnv(v);
      expect(demoLoginsVisible()).toBe(true);
    }
  });

  it('stays off in a production build unless the setting is on', () => {
    const env = process.env as Record<string, string | undefined>;
    const savedNodeEnv = env.NODE_ENV;
    try {
      env.NODE_ENV = 'production';
      setEnv(undefined);
      expect(demoLoginsVisible()).toBe(false);
      env.NODE_ENV = 'development';
      expect(demoLoginsVisible()).toBe(false);
    } finally {
      env.NODE_ENV = savedNodeEnv;
    }
  });
});
