// A look's id: SHA-256 of what makes it (the photo and the garments), base64url. Shared by the website's gate and the
// ChatGPT panel; it is all the server ever learns about the photo.
export async function lookId(parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
