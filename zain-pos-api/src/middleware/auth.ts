import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
    userId?: string;
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
        if (typeof decoded.userId !== 'string' || !decoded.userId) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { isActive: true } });
        if (!user?.isActive) return res.status(401).json({ error: 'Account is unavailable' });
        req.userId = decoded.userId;
        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) return res.status(401).json({ error: 'Invalid token' });
        next(error);
    }
};
