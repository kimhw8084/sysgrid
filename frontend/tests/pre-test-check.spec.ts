import { expect, test } from '@playwright/test';

test('verify backend and frontend are up', async ({ request }) => {
  const backendBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1';
  const frontendBase = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173';

  // Check backend
  const backendResponse = await request.get(`${backendBase}/health`);
  expect(backendResponse.status()).toBe(200);
  
  // Check frontend (just by fetching the root)
  const frontendResponse = await request.get(`${frontendBase}/`);
  expect(frontendResponse.status()).toBe(200);
});
