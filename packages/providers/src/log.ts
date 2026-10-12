/** What the adapters log through: the app plugs its redacting logger in, the worker its pino child. */
export interface ProviderLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

const silent: ProviderLogger = { info() {}, warn() {} };
let factory: (scope: string) => ProviderLogger = () => silent;

/** Installs the runtime's logger factory. Messages never contain credentials, images or prompts. */
export function setProviderLoggerFactory(create: (scope: string) => ProviderLogger): void {
  factory = create;
}

/** A logger that resolves the factory at call time, so adapters can create it at module load. */
export function createLogger(scope: string): ProviderLogger {
  return {
    info: (...args) => factory(scope).info(...args),
    warn: (...args) => factory(scope).warn(...args),
  };
}
