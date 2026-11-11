import { describe, expect, it } from 'vitest';
import { lookId } from './gate';
import { leftText } from './store';

describe('leftText', () => {
  const user = { email: 'a@b.c', exempt: false, freeUsed: 2, credits: 0, left: 3 };
  it('says what is left, free or paid', () => {
    expect(leftText(user, 5)).toBe('3 of 5 free try-ons left');
    expect(leftText(user, 5, true)).toBe('3 free left');
    expect(leftText({ ...user, freeUsed: 5, left: 0 }, 5)).toBe('All 5 free try-ons used');
    expect(leftText({ ...user, freeUsed: 1, left: 0 }, 1)).toBe('Free try-on used');
    expect(leftText({ ...user, freeUsed: 0, left: 1 }, 1)).toBe('1 of 1 free try-on left');
    expect(leftText({ ...user, freeUsed: 5, credits: 1, left: 1 }, 5)).toBe('1 try-on left');
    expect(leftText({ ...user, freeUsed: 5, credits: 20, left: 20 }, 5, true)).toBe('20 left');
    expect(leftText({ ...user, exempt: true, left: null }, 5)).toBe('Unlimited try-ons');
  });
});

describe('lookId', () => {
  it('is a stable base64url SHA-256 of the parts', async () => {
    const a = await lookId(['photo', 'top.jpg', 'pants.jpg']);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await lookId(['photo', 'top.jpg', 'pants.jpg'])).toBe(a);
    expect(await lookId(['photo', 'top.jpg', 'other.jpg'])).not.toBe(a);
    expect(await lookId(['phototop.jpg', 'pants.jpg'])).not.toBe(a);
  });
});
