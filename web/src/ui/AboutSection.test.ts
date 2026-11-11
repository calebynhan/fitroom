import { describe, expect, it } from 'vitest';
import { chatgptPluginUrl } from './AboutSection';

describe('the ChatGPT link', () => {
  it('appears only for an https listing URL', () => {
    expect(chatgptPluginUrl(undefined)).toBeNull();
    expect(chatgptPluginUrl('  ')).toBeNull();
    expect(chatgptPluginUrl('javascript:alert(1)')).toBeNull();
    expect(chatgptPluginUrl('http://chatgpt.com/x')).toBeNull();
    expect(chatgptPluginUrl(' https://chatgpt.com/plugins/fitroom ')).toBe('https://chatgpt.com/plugins/fitroom');
  });
});
