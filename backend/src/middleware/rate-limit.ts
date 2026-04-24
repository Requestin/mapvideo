import rateLimit from 'express-rate-limit';

// 5 failed login attempts per IP per 10 minutes. Successful logins (2xx)
// do not count toward the limit, so a legitimate user who mistypes once and
// then logs in successfully is not locked out.
export const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток, попробуйте через 10 минут' },
});

export const routeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов маршрутов, попробуйте позже' },
});

export const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});
