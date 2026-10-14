// The registered webhook handlers (ADR 010 decision 7). The worker (services/stravaWebhookWorker.ts) looks an event up here by
// webhookHandlerKey(object_type, aspect_type); the contract a handler follows is described at the top of that module.
//
// Each of the stories that build a handler adds its own entry here and nothing else:
//   webhookHandlerKey('activity', 'create')  - import a new activity
//   webhookHandlerKey('activity', 'update')  - privacy, type and data changes
//   webhookHandlerKey('activity', 'delete')  - verify, then delete the run
//   webhookHandlerKey('athlete', 'update')   - deauthorize
// An event whose handler is not registered finishes as done / noop with a warning, so until an entry exists the worker only
// drains the queue.
import { webhookHandlerKey, type HandlerRegistry } from '../stravaWebhookWorker.js';
import { createActivityCreateHandler } from './handlers/activityCreate.js';
import { createActivityDeleteHandler } from './handlers/activityDelete.js';

export const STRAVA_WEBHOOK_HANDLERS: HandlerRegistry = {
  [webhookHandlerKey('activity', 'create')]: createActivityCreateHandler(),
  [webhookHandlerKey('activity', 'delete')]: createActivityDeleteHandler(),
};
