export function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const name = 'mc_panel_csrf=';
  const item = document.cookie.split('; ').find((part) => part.startsWith(name));
  return item ? decodeURIComponent(item.slice(name.length)) : undefined;
}

export function secureHeaders(init?: RequestInit): HeadersInit {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const method = (init?.method ?? 'GET').toUpperCase();
  if (['POST','PUT','PATCH','DELETE'].includes(method)) {
    const token = csrfToken();
    if (token) headers.set('x-csrf-token', token);
  }
  return headers;
}
