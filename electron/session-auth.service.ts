/** Sessions are established only after password verification, never from renderer user IDs. */
export class SessionAuthStore<Key extends string | number> {
    private readonly sessions = new Map<Key, { userId: string; expiresAt: number }>();

    constructor(private readonly options: { now?: () => number; ttlMs?: number } = {}) {}

    bind(key: Key, userId: string): void {
        if (!userId) throw new Error('Authentication required');
        this.sessions.set(key, {
            userId,
            expiresAt: this.now() + (this.options.ttlMs ?? 12 * 60 * 60 * 1000),
        });
    }

    getUserId(key: Key): string | null {
        const session = this.sessions.get(key);
        if (!session) return null;
        if (session.expiresAt <= this.now()) {
            this.clear(key);
            return null;
        }
        return session.userId;
    }

    clear(key: Key): void {
        this.sessions.delete(key);
    }

    private now(): number {
        return this.options.now ? this.options.now() : Date.now();
    }
}

export async function resolveAuthenticatedSessionUser<Key extends string | number>(
    prisma: any,
    sessions: SessionAuthStore<Key>,
    key: Key,
): Promise<any> {
    const userId = sessions.getUserId(key);
    if (!userId) throw new Error('Authentication required');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
        sessions.clear(key);
        throw new Error('User account is disabled or unavailable');
    }
    const { password: _password, ...safeUser } = user;
    return safeUser;
}

export function containsSensitiveQueryField(value: any, field: string): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(item => containsSensitiveQueryField(item, field));
    return Object.entries(value).some(([key, nested]) =>
        key === field ||
        ((key === 'by' || key === 'distinct') &&
            (nested === field || (Array.isArray(nested) && nested.includes(field)))) ||
        containsSensitiveQueryField(nested, field),
    );
}

/** Apply to every relation/include result, not only top-level variant reads. */
export function maskSessionResult(value: any, user: any): any {
    if (value === null || typeof value !== 'object' || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(item => maskSessionResult(item, user));
    const canViewCost = user?.role === 'ADMIN' || user?.permViewCostPrice === true;
    const result: Record<string, any> = {};
    for (const [key, nested] of Object.entries(value)) {
        if (key === 'password') continue;
        result[key] = key === 'costPrice' && !canViewCost ? null : maskSessionResult(nested, user);
    }
    return result;
}

export const electronSessions = new SessionAuthStore<number>();
const watchedSenders = new WeakSet<object>();

export function bindElectronSession(sender: any, userId: string): void {
    const senderId = sender.id;
    electronSessions.bind(senderId, userId);
    if (watchedSenders.has(sender)) return;
    watchedSenders.add(sender);
    sender.once('destroyed', () => electronSessions.clear(senderId));
    sender.on('did-start-navigation', (_event: any, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
        if (!isInPlace && isMainFrame !== false) electronSessions.clear(senderId);
    });
}

export function clearElectronSession(senderId: number): void {
    electronSessions.clear(senderId);
}

export async function resolveElectronSessionUser(prisma: any, event: any): Promise<any> {
    if (!event?.sender || event.sender.isDestroyed?.()) throw new Error('Authentication required');
    if (event.senderFrame && event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Authentication required');
    }
    return resolveAuthenticatedSessionUser(prisma, electronSessions, event.sender.id);
}
