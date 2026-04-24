import axios from 'axios';
import { readCookie } from '../utils/cookies';

// withCredentials: true — browser sends the httpOnly `session` cookie and
// the non-httpOnly `csrf_token` cookie. The request interceptor copies the
// CSRF cookie to the X-CSRF-Token header on mutating verbs; backend's
// requireCsrf middleware compares them.
export const http = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

http.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCookie('csrf_token');
    if (csrf) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRF-Token'] = csrf;
    }
  }
  return config;
});
