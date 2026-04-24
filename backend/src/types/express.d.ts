import type { User } from '../services/users-service';
import type { RenderJobRow } from './render-job';

// Module augmentation so that express `Request.user` is typed instead of
// reaching into `(req as any).user`. Set by `requireAuth` middleware.
declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    /** Set by `requireJobOwner` for render / history download routes. */
    renderJob?: RenderJobRow;
  }
}
export {};
