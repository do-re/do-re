import { describe, expect, it } from 'vitest';
import { isWellFormedEmail } from './validation';

describe('isWellFormedEmail', () => {
  it.each(['a@b.co', 'first.last@uni.ubc.ca', '  padded@x.io  '])('R_ACC_07 accepts %s', (email) => {
    expect(isWellFormedEmail(email)).toBe(true);
  });

  it.each(['', 'plain', 'no-at.com', 'a@b', '@b.com', 'a b@c.com', 'a@b .com'])('R_ACC_07 rejects "%s"', (email) => {
    expect(isWellFormedEmail(email)).toBe(false);
  });
});
