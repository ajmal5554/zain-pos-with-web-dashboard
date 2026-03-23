/**
 * Structured logger for the Electron main process.
 * - In production: only WARN and ERROR are shown.
 * - In development: all levels are shown.
 */

const isDev = process.env.NODE_ENV === 'development';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function formatMessage(level: LogLevel, context: string, message: string): string {
    const ts = new Date().toISOString();
    return `[${ts}] [${level}] [${context}] ${message}`;
}

export const logger = {
    debug(context: string, message: string, ...args: unknown[]) {
        if (!isDev) return;
        console.debug(formatMessage('DEBUG', context, message), ...args);
    },

    info(context: string, message: string, ...args: unknown[]) {
        if (!isDev) return;
        console.info(formatMessage('INFO', context, message), ...args);
    },

    warn(context: string, message: string, ...args: unknown[]) {
        console.warn(formatMessage('WARN', context, message), ...args);
    },

    error(context: string, message: string, error?: unknown) {
        const errMsg = error instanceof Error
            ? `${error.message}\n${error.stack}`
            : String(error ?? '');
        console.error(formatMessage('ERROR', context, message), errMsg);
    },
};
