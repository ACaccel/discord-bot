/**
 * IoC barrel. Composition roots and tests import from here:
 *   import { createContainer, TOKENS } from '@core/ioc';
 *
 * Layered code (`application/`, `domain/`, `interface/`, `persistence/`,
 * `infra/`) must not import from this module — see the
 * `no-restricted-imports` rule in eslint.config.mjs. Dependencies are
 * delivered via constructor parameters from the composition root, not
 * pulled from a global container (service-locator anti-pattern).
 */
export {
  createContainer,
  token,
  DefaultServiceContainer,
  ServiceResolutionError,
  DuplicateRegistrationError,
  type ServiceToken,
  type Resolver,
  type ScopedContainer,
  type ServiceContainer,
  type ServiceFactory,
} from './container';

export { TOKENS, type Tokens, type RepoFactory, type ReposFactory } from './tokens';
